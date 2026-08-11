// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ContractRegistry } from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import { IPayment } from "@flarenetwork/flare-periphery-contracts/coston2/IPayment.sol";
import { RevenueOracle } from "./RevenueOracle.sol";

/// @dev The slice of FAssets' AssetManager this contract needs: burn FXRP and have an agent pay XRP out.
interface IFAssetRedeemer {
    function lotSize() external view returns (uint256 _lotSizeUBA);

    function redeem(
        uint256 _lots,
        string memory _redeemerUnderlyingAddressString,
        address payable _executor
    ) external payable returns (uint256 _redeemedAmountUBA);
}

/**
 * @title AdvanceManager
 * @notice Underwrites an FXRP advance against revenue proven by RevenueOracle, and collects repayment.
 *
 * The obligation is denominated in US cents. FXRP is only ever the medium of transfer, converted at the
 * FTSOv2 XRP/USD rate at the moment of each movement. A borrower who takes $1,000 owes $1,000 plus the fee
 * no matter what XRP does afterwards.
 *
 * This is unsecured credit. There is no on-chain recovery if a borrower stops earning; delinquency is
 * recorded and blocks future advances, and that is the whole of the enforcement.
 */
contract AdvanceManager is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Advance {
        uint256 principalCents;
        uint256 feeCents;
        uint256 outstandingCents;
        uint256 fxrpDisbursed;
        uint64 openedAt;
        uint64 lastActivityAt;
        uint64 lastAppliedPeriodEnd;
        bool open;
        bool delinquent;
        // Underwriting inputs, stored so the decision can be audited after the fact.
        uint256 avgRevenueCents;
        uint256 xrpUsdPrice;
        uint8 periodsUsed;
        uint16 factorBps;
        int8 priceDecimals;
    }

    /// @notice XRP/USD, the feed this product's dollar denomination rests on.
    bytes21 public constant XRP_USD_FEED_ID = bytes21(0x015852502f55534400000000000000000000000000);

    /// @notice Months averaged when underwriting.
    uint8 public constant PERIODS_AVERAGED = 3;

    /// @notice The XRP Ledger's minimal unit. One XRP is a million drops.
    uint256 public constant DROPS_PER_XRP = 1_000_000;

    RevenueOracle public immutable oracle;
    IERC20 public immutable fxrp;
    uint8 public immutable fxrpDecimals;

    uint16 public factorBps = 10_000; // 1.0x the monthly average for a first advance
    uint16 public feeBps = 500; // 5% origination fee
    uint16 public repaymentShareBps = 2_000; // 20% of each attested period
    uint256 public maxAdvanceCents = 10_000_000; // $100,000 hard cap
    uint64 public gracePeriod = 45 days;

    uint256 public treasuryBalance;

    /// @notice FAssets AssetManager for FXRP. Optional: unset simply means the XRPL leg is unavailable.
    IFAssetRedeemer public assetManager;

    /**
     * @notice The chain an XRPL repayment must have happened on, as an FDC source id.
     * `bytes32("testXRP")` on Coston2, `bytes32("XRP")` in production. Pinning it stops a payment on one
     * chain being replayed as proof of a payment on another.
     */
    bytes32 public xrplSourceId;

    /// @notice The XRPL account borrowers repay to. Held as a hash because that is what FDC attests.
    bytes32 public xrplTreasuryAddressHash;

    /// @notice Kept alongside the hash purely so the interface can display something a borrower can pay.
    string public xrplTreasuryAddress;

    /// @notice XRPL transaction ids already consumed, so one payment can never be claimed twice.
    mapping(bytes32 => bool) public xrplPaymentUsed;

    mapping(bytes32 => Advance) private _advances;

    event TreasuryDeposited(uint256 amount);
    event TreasuryWithdrawn(uint256 amount);
    event AdvanceIssued(
        bytes32 indexed accountId,
        address indexed borrower,
        uint256 principalCents,
        uint256 feeCents,
        uint256 fxrpAmount,
        uint256 xrpUsdPrice,
        int8 priceDecimals
    );
    /// @notice The inputs the limit was computed from, so the decision is auditable from logs alone.
    event Underwritten(
        bytes32 indexed accountId,
        uint256 avgRevenueCents,
        uint8 periodsUsed,
        uint16 factorBps,
        uint256 limitCents
    );
    event Repaid(
        bytes32 indexed accountId,
        address indexed payer,
        uint256 usdCents,
        uint256 fxrpAmount,
        uint256 xrpUsdPrice,
        int8 priceDecimals,
        uint256 outstandingCents,
        bool automatic
    );
    event AdvanceClosed(bytes32 indexed accountId);
    event AdvanceDisbursedToXrpl(
        bytes32 indexed accountId,
        address indexed borrower,
        uint256 lots,
        uint256 fxrpRedeemed,
        string xrplAddress
    );
    event AssetManagerSet(address assetManager);
    event MarkedDelinquent(bytes32 indexed accountId, uint256 outstandingCents);
    event XrplTreasurySet(string xrplAddress, bytes32 xrplAddressHash, bytes32 sourceId);
    /// @notice A repayment that arrived as real XRP on the XRP Ledger and was proven by FDC.
    event RepaidFromXrpl(
        bytes32 indexed accountId,
        bytes32 indexed xrplTransactionId,
        uint256 drops,
        uint256 usdCents,
        uint256 xrpUsdPrice,
        int8 priceDecimals,
        uint256 outstandingCents
    );

    error NoRevenueProven();
    error NotAccountOwner(address owner, address caller);
    error AccountDelinquent();
    error AdvanceAlreadyOpen();
    error NoOpenAdvance();
    error ExceedsLimit(uint256 limitCents, uint256 requestedCents);
    error InvalidPrice();
    error InsufficientTreasury(uint256 available, uint256 required);
    error InvalidAmount();
    error PeriodAlreadyApplied();
    error GracePeriodNotElapsed();
    error InvalidXrplAddress();
    error XrplDisbursementUnavailable();
    error XrplRepaymentUnavailable();
    error InvalidPaymentProof();
    error WrongPaymentChain(bytes32 expected, bytes32 got);
    error PaymentNotSuccessful(uint8 status);
    error WrongPaymentRecipient();
    error WrongPaymentReference(bytes32 expected, bytes32 got);
    error XrplPaymentAlreadyUsed(bytes32 transactionId);

    constructor(address oracleAddress, address fxrpAddress) Ownable(msg.sender) {
        oracle = RevenueOracle(oracleAddress);
        fxrp = IERC20(fxrpAddress);
        fxrpDecimals = IERC20Metadata(fxrpAddress).decimals();
    }

    // ---------------------------------------------------------------- underwriting

    /**
     * @notice The advance a borrower may take: the mean of the last three attested months, times the factor,
     * capped. Deliberately simple so it can be explained in one sentence and checked by hand.
     */
    function advanceLimitCents(bytes32 accountId) public view returns (uint256) {
        (uint256 avg, ) = _averageRevenue(accountId);
        if (avg == 0) return 0;
        uint256 limit = (avg * factorBps) / 10_000;
        return limit > maxAdvanceCents ? maxAdvanceCents : limit;
    }

    function _averageRevenue(bytes32 accountId) internal view returns (uint256 avg, uint8 periodsUsed) {
        RevenueOracle.RevenueRecord[] memory history = oracle.revenueHistory(accountId);
        if (history.length == 0) return (0, 0);

        uint256 count = history.length < PERIODS_AVERAGED ? history.length : PERIODS_AVERAGED;
        uint256 total;
        for (uint256 i = history.length - count; i < history.length; i++) {
            total += history[i].revenueCents;
        }
        return (total / count, uint8(count));
    }

    // ---------------------------------------------------------------- advances

    /// @notice Take an advance in FXRP, on Flare.
    function requestAdvance(bytes32 accountId, uint256 usdCents) external nonReentrant {
        if (usdCents == 0) revert InvalidAmount();

        (uint256 price, int8 priceDecimals) = _xrpUsd();
        if (price == 0) revert InvalidPrice();

        uint256 fxrpAmount = usdCentsToFxrp(usdCents, price, priceDecimals);
        if (fxrpAmount == 0) revert InvalidAmount();

        address borrower = _openAdvance(accountId, usdCents, fxrpAmount, price, priceDecimals);

        treasuryBalance -= fxrpAmount;
        fxrp.safeTransfer(borrower, fxrpAmount);
    }

    /**
     * @notice Take an advance and receive real XRP on the XRP Ledger, never touching FXRP.
     *
     * The FXRP is redeemed through FAssets and an agent pays the borrower's XRPL address directly, so a
     * borrower can be funded without ever holding an EVM asset or, in principle, an EVM wallet.
     *
     * Denominated in lots rather than dollars because FAssets redeems whole lots only — 10 XRP on Coston2.
     * The dollar obligation is then computed from what was actually redeemed, at the FTSO rate.
     */
    function requestAdvanceToXrpl(
        bytes32 accountId,
        uint256 lots,
        string calldata xrplAddress
    ) external nonReentrant {
        if (lots == 0) revert InvalidAmount();
        if (bytes(xrplAddress).length == 0) revert InvalidXrplAddress();

        IFAssetRedeemer redeemer = assetManager;
        if (address(redeemer) == address(0)) revert XrplDisbursementUnavailable();

        uint256 fxrpAmount = lots * redeemer.lotSize();

        (uint256 price, int8 priceDecimals) = _xrpUsd();
        if (price == 0) revert InvalidPrice();

        uint256 usdCents = fxrpToUsdCents(fxrpAmount, price, priceDecimals);
        if (usdCents == 0) revert InvalidAmount();

        address borrower = _openAdvance(accountId, usdCents, fxrpAmount, price, priceDecimals);

        treasuryBalance -= fxrpAmount;
        fxrp.forceApprove(address(redeemer), fxrpAmount);
        redeemer.redeem(lots, xrplAddress, payable(address(0)));

        emit AdvanceDisbursedToXrpl(accountId, borrower, lots, fxrpAmount, xrplAddress);
    }

    /**
     * @dev Everything both legs share: underwrite, check, and record. Leaves the caller to move the value,
     * so the effects are all written before anything external is touched.
     */
    function _openAdvance(
        bytes32 accountId,
        uint256 usdCents,
        uint256 fxrpAmount,
        uint256 price,
        int8 priceDecimals
    ) internal returns (address borrower) {
        (uint256 avg, uint8 periodsUsed) = _averageRevenue(accountId);
        if (periodsUsed == 0) revert NoRevenueProven();

        borrower = oracle.accountOwner(accountId);
        if (borrower != msg.sender) revert NotAccountOwner(borrower, msg.sender);

        Advance storage advance = _advances[accountId];
        if (advance.delinquent) revert AccountDelinquent();
        if (advance.open) revert AdvanceAlreadyOpen();

        uint256 limit = advanceLimitCents(accountId);
        if (usdCents > limit) revert ExceedsLimit(limit, usdCents);
        if (fxrpAmount > treasuryBalance) revert InsufficientTreasury(treasuryBalance, fxrpAmount);

        uint256 fee = (usdCents * feeBps) / 10_000;

        advance.principalCents = usdCents;
        advance.feeCents = fee;
        advance.outstandingCents = usdCents + fee;
        advance.fxrpDisbursed = fxrpAmount;
        advance.openedAt = uint64(block.timestamp);
        advance.lastActivityAt = uint64(block.timestamp);
        advance.lastAppliedPeriodEnd = oracle.latestRevenue(accountId).periodEnd;
        advance.open = true;
        advance.avgRevenueCents = avg;
        advance.periodsUsed = periodsUsed;
        advance.factorBps = factorBps;
        advance.xrpUsdPrice = price;
        advance.priceDecimals = priceDecimals;

        emit Underwritten(accountId, avg, periodsUsed, advance.factorBps, limit);
        emit AdvanceIssued(
            accountId,
            borrower,
            advance.principalCents,
            advance.feeCents,
            advance.fxrpDisbursed,
            advance.xrpUsdPrice,
            advance.priceDecimals
        );
    }

    /// @notice Repay a dollar amount by hand, priced in FXRP at the current rate.
    function repay(bytes32 accountId, uint256 usdCents) external nonReentrant {
        _repay(accountId, usdCents, false);
    }

    /**
     * @notice Take the agreed share of a newly attested period as repayment.
     * @dev Pulls FXRP from the borrower, so it needs an allowance. The contract cannot reach into Stripe;
     * what makes this "automatic" is that a proven period triggers it, not that funds move without consent.
     */
    function applyRevenueRepayment(bytes32 accountId) external nonReentrant {
        Advance storage advance = _advances[accountId];
        if (!advance.open) revert NoOpenAdvance();

        RevenueOracle.RevenueRecord memory latest = oracle.latestRevenue(accountId);
        if (latest.periodEnd <= advance.lastAppliedPeriodEnd) revert PeriodAlreadyApplied();

        uint256 share = (latest.revenueCents * repaymentShareBps) / 10_000;
        if (share > advance.outstandingCents) share = advance.outstandingCents;

        advance.lastAppliedPeriodEnd = latest.periodEnd;
        _repay(accountId, share, true);
    }

    function _repay(bytes32 accountId, uint256 usdCents, bool automatic) internal {
        if (usdCents == 0) revert InvalidAmount();

        Advance storage advance = _advances[accountId];
        if (!advance.open) revert NoOpenAdvance();
        if (usdCents > advance.outstandingCents) revert InvalidAmount();

        (uint256 price, int8 priceDecimals) = _xrpUsd();
        if (price == 0) revert InvalidPrice();

        uint256 fxrpAmount = usdCentsToFxrp(usdCents, price, priceDecimals);
        if (fxrpAmount == 0) revert InvalidAmount();

        address borrower = oracle.accountOwner(accountId);

        advance.outstandingCents -= usdCents;
        advance.lastActivityAt = uint64(block.timestamp);
        treasuryBalance += fxrpAmount;

        bool closed = advance.outstandingCents == 0;
        if (closed) advance.open = false;

        fxrp.safeTransferFrom(borrower, address(this), fxrpAmount);

        emit Repaid(
            accountId, borrower, usdCents, fxrpAmount, price, priceDecimals, advance.outstandingCents, automatic
        );
        if (closed) emit AdvanceClosed(accountId);
    }

    /**
     * @notice Repay from the XRP Ledger, by proving a plain XRP payment with FDC.
     *
     * This is the return leg of `requestAdvanceToXrpl`, and it closes the loop: the borrower is funded in
     * real XRP on the XRP Ledger and repays in real XRP on the XRP Ledger. Neither direction requires them
     * to hold an EVM asset, and — if the request is placed on their behalf — neither requires an EVM wallet
     * at all. The obligation being settled still lives on Flare and is still denominated in dollars.
     *
     * The borrower sends an ordinary Payment to `xrplTreasuryAddress` carrying `accountId` as the
     * transaction's payment reference, which on the XRP Ledger is the `InvoiceID` field. That reference is
     * what ties an otherwise anonymous payment to a specific obligation.
     *
     * This is a second FDC attestation type: revenue arrives through Web2Json, repayment through Payment.
     * The same Merkle proof machinery verifies both.
     *
     * @dev Check order is deliberate and mirrors Flare's own `PaymentProofs` library in Smart Accounts: the
     * cheap field comparisons run first and the expensive FDC verification runs last.
     */
    function repayFromXrpl(bytes32 accountId, IPayment.Proof calldata proof) external nonReentrant {
        if (xrplTreasuryAddressHash == bytes32(0)) revert XrplRepaymentUnavailable();

        Advance storage advance = _advances[accountId];
        if (!advance.open) revert NoOpenAdvance();

        IPayment.ResponseBody calldata body = proof.data.responseBody;

        if (proof.data.sourceId != xrplSourceId) revert WrongPaymentChain(xrplSourceId, proof.data.sourceId);
        if (body.status != 0) revert PaymentNotSuccessful(body.status);
        if (body.receivingAddressHash != xrplTreasuryAddressHash) revert WrongPaymentRecipient();
        if (body.standardPaymentReference != accountId) {
            revert WrongPaymentReference(accountId, body.standardPaymentReference);
        }

        bytes32 transactionId = proof.data.requestBody.transactionId;
        if (xrplPaymentUsed[transactionId]) revert XrplPaymentAlreadyUsed(transactionId);
        if (body.receivedAmount <= 0) revert InvalidAmount();

        if (!_verifyPayment(proof)) revert InvalidPaymentProof();

        (uint256 price, int8 priceDecimals) = _xrpUsd();
        if (price == 0) revert InvalidPrice();

        uint256 drops = uint256(body.receivedAmount);
        uint256 usdCents = xrpDropsToUsdCents(drops, price, priceDecimals);
        if (usdCents == 0) revert InvalidAmount();

        // Overpaying closes the advance rather than reverting. A borrower cannot retract an XRPL payment,
        // so rejecting it here would take their money and leave the debt standing.
        if (usdCents > advance.outstandingCents) usdCents = advance.outstandingCents;

        xrplPaymentUsed[transactionId] = true;
        advance.outstandingCents -= usdCents;
        advance.lastActivityAt = uint64(block.timestamp);

        bool closed = advance.outstandingCents == 0;
        if (closed) advance.open = false;

        /*
         * Deliberately no change to `treasuryBalance`. The XRP landed in an XRP Ledger account, not as FXRP
         * on Flare, so the Flare-side treasury genuinely did not grow and claiming otherwise would put a
         * number in storage that no balance backs. Returning that value to the treasury means minting FXRP
         * from the received XRP through FAssets, which is the production answer and is not built here.
         */
        emit RepaidFromXrpl(
            accountId, transactionId, drops, usdCents, price, priceDecimals, advance.outstandingCents
        );
        if (closed) emit AdvanceClosed(accountId);
    }

    /// @notice Record that an advance has gone unserviced past the grace period.
    function markDelinquent(bytes32 accountId) external {
        Advance storage advance = _advances[accountId];
        if (!advance.open) revert NoOpenAdvance();
        if (block.timestamp <= advance.lastActivityAt + gracePeriod) revert GracePeriodNotElapsed();

        advance.delinquent = true;
        emit MarkedDelinquent(accountId, advance.outstandingCents);
    }

    // ---------------------------------------------------------------- treasury

    function depositTreasury(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert InvalidAmount();
        treasuryBalance += amount;
        fxrp.safeTransferFrom(msg.sender, address(this), amount);
        emit TreasuryDeposited(amount);
    }

    function withdrawTreasury(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0 || amount > treasuryBalance) revert InvalidAmount();
        treasuryBalance -= amount;
        fxrp.safeTransfer(msg.sender, amount);
        emit TreasuryWithdrawn(amount);
    }

    // ---------------------------------------------------------------- conversion and views

    /**
     * @notice Convert US cents to FXRP at the given price.
     * @dev The feed's own decimals are a parameter, never a constant: XRP/USD reports 6 on Coston2 while
     * FLR/USD reports 8, and FXRP itself is 6, not 18. Assuming any of these is a silent factor-of-10^n bug.
     */
    function usdCentsToFxrp(uint256 usdCents, uint256 price, int8 priceDecimals) public view returns (uint256) {
        if (price == 0) revert InvalidPrice();
        uint256 priceScale = 10 ** uint256(uint8(priceDecimals));
        uint256 tokenScale = 10 ** uint256(fxrpDecimals);
        return (usdCents * priceScale * tokenScale) / (100 * price);
    }

    /// @notice The inverse of usdCentsToFxrp: what a quantity of FXRP is worth in US cents, truncated.
    function fxrpToUsdCents(uint256 fxrpRaw, uint256 price, int8 priceDecimals) public view returns (uint256) {
        if (price == 0) revert InvalidPrice();
        uint256 priceScale = 10 ** uint256(uint8(priceDecimals));
        uint256 tokenScale = 10 ** uint256(fxrpDecimals);
        return (fxrpRaw * price * 100) / (priceScale * tokenScale);
    }

    /**
     * @notice What a quantity of XRP, in drops, is worth in US cents.
     * @dev Deliberately independent of `fxrpDecimals`. A drop is 10^-6 XRP and FXRP also has 6 decimals on
     * Coston2, so the two scales happen to coincide today — but they are unrelated quantities, and writing
     * this in terms of the token's decimals would silently break if either ever changed.
     */
    function xrpDropsToUsdCents(uint256 drops, uint256 price, int8 priceDecimals) public pure returns (uint256) {
        if (price == 0) revert InvalidPrice();
        uint256 priceScale = 10 ** uint256(uint8(priceDecimals));
        return (drops * price * 100) / (priceScale * DROPS_PER_XRP);
    }

    function setAssetManager(address newAssetManager) external onlyOwner {
        assetManager = IFAssetRedeemer(newAssetManager);
        emit AssetManagerSet(newAssetManager);
    }

    /**
     * @notice Set the XRPL account borrowers repay to, and the chain their payment must have happened on.
     * @param newXrplAddress The classic XRPL address, exactly as it will appear in the payment.
     * @param newSourceId The FDC source id — `bytes32("testXRP")` on Coston2, `bytes32("XRP")` in production.
     * @dev The hash is `keccak256` of the address string, which is the standard address hash FDC attests.
     */
    function setXrplTreasury(string calldata newXrplAddress, bytes32 newSourceId) external onlyOwner {
        if (bytes(newXrplAddress).length == 0) revert InvalidXrplAddress();
        xrplTreasuryAddress = newXrplAddress;
        xrplTreasuryAddressHash = keccak256(bytes(newXrplAddress));
        xrplSourceId = newSourceId;
        emit XrplTreasurySet(newXrplAddress, xrplTreasuryAddressHash, newSourceId);
    }

    /// @notice Lot size in FXRP base units, or 0 when the XRPL leg is unavailable.
    function lotSize() external view returns (uint256) {
        return address(assetManager) == address(0) ? 0 : assetManager.lotSize();
    }

    function advanceOf(bytes32 accountId) external view returns (Advance memory) {
        return _advances[accountId];
    }

    function hasOpenAdvance(bytes32 accountId) external view returns (bool) {
        return _advances[accountId].open;
    }

    /**
     * @dev Not a view: FtsoV2.getFeedById is payable because some feeds charge a fee. XRP/USD on Coston2 is
     * free, so this costs nothing today, but the mutability has to match the interface.
     * Overridden in tests so a price move can be simulated.
     */
    function _xrpUsd() internal virtual returns (uint256 price, int8 decimals) {
        (uint256 value, int8 dec, ) = ContractRegistry.getFtsoV2().getFeedById(XRP_USD_FEED_ID);
        return (value, dec);
    }

    /// @notice The live XRP/USD the contract would use right now. Call it with eth_call from the UI.
    function currentXrpUsd() external returns (uint256 price, int8 decimals) {
        return _xrpUsd();
    }

    /**
     * @dev Production path is Flare's own verification contract, the same one RevenueOracle uses for
     * Web2Json. Overridden in tests, where no FDC exists to attest against.
     */
    function _verifyPayment(IPayment.Proof calldata proof) internal view virtual returns (bool) {
        return ContractRegistry.getFdcVerification().verifyPayment(proof);
    }
}
