// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { LenderPool } from "./LenderPool.sol";
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
contract AdvanceManager is Ownable, Pausable, ReentrancyGuard {
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

    /*
     * The tier schedule. An account's factor starts at `baseFactorBps` and earns `stepFactorBps` more with
     * every advance repaid in full without ever going delinquent, up to `capFactorBps`.
     *
     * The base is deliberately below card-processing fees (~2.9%): the fundamental attack on revenue-based
     * credit is paying yourself through your own processor and defaulting, and a first advance smaller than
     * what the fabrication cost makes that attack lose money before any other signal is consulted.
     * Accounts younger than `minAccountAgeSeconds` (or with no attested age at all) stay at the base
     * regardless of history.
     */
    uint16 public baseFactorBps = 250; // 2.5% of the monthly base for an unproven account
    uint16 public stepFactorBps = 2_000; // +20 points per cleanly repaid advance
    uint16 public capFactorBps = 10_000; // 1.0x, after roughly five honest cycles
    uint64 public minAccountAgeSeconds = 30 days;

    uint16 public feeBps = 500; // 5% origination fee
    uint16 public repaymentShareBps = 2_000; // 20% of each attested period
    uint256 public maxAdvanceCents = 10_000_000; // $100,000 hard cap
    uint64 public gracePeriod = 45 days;

    /// @notice Advances repaid in full without ever being marked delinquent. The account's reputation.
    mapping(bytes32 => uint32) public closedCleanCycles;

    uint256 public treasuryBalance;

    /// @notice FAssets AssetManager for FXRP. Optional: unset simply means the XRPL leg is unavailable.
    IFAssetRedeemer public assetManager;

    /**
     * @notice The lender pool. Optional: unset, the manager funds advances from its owner-filled treasury,
     * which is the mode the first deployments ran in. Set, all funding flows through the pool and the
     * treasury functions refuse to run — one funding source at a time, never a blend of both.
     */
    LenderPool public pool;

    /// @notice Per advance: how much of its disbursed FXRP the pool has already retired via repayments.
    mapping(bytes32 => uint256) public fxrpRetired;

    /**
     * @notice Dollars received beyond what was owed — an XRPL payment cannot be retracted or refunded
     * without custodying an XRPL hot key, so the excess becomes credit and settles the next advance.
     */
    mapping(bytes32 => uint256) public creditCents;

    /// @notice Optional: the only XRPL sender (as a standard address hash) allowed to repay this account.
    mapping(bytes32 => bytes32) public boundRepaymentSource;

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
    event FactorScheduleSet(uint16 baseFactorBps, uint16 stepFactorBps, uint16 capFactorBps, uint64 minAccountAgeSeconds);
    event PoolSet(address pool);
    /// @notice The unrecovered remainder of a delinquent advance, formally taken as the pool's loss.
    event WrittenOff(bytes32 indexed accountId, uint256 outstandingCents, uint256 fxrpWrittenOff);
    event CreditAccrued(bytes32 indexed accountId, uint256 usdCents, uint256 totalCreditCents);
    event CreditApplied(bytes32 indexed accountId, uint256 usdCents, uint256 outstandingCents);
    event RepaymentSourceBound(bytes32 indexed accountId, bytes32 xrplSenderHash);
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
    error TreasuryModeDisabled();
    error PoolAlreadyActive();
    error NotDelinquent();
    error InvalidPaymentProof();
    error WrongPaymentSender(bytes32 expected, bytes32 got);
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
     * @notice The factor this account has earned. Base for everyone; a step per cleanly repaid advance;
     * pinned to the base while the account is young or its age is simply unknown.
     * @dev Every input is on chain, so the tier a borrower is priced at can be checked by hand.
     */
    function accountFactorBps(bytes32 accountId) public view returns (uint16) {
        uint64 createdAt = oracle.accountCreatedAt(accountId);
        if (createdAt == 0 || block.timestamp < uint256(createdAt) + minAccountAgeSeconds) {
            return baseFactorBps;
        }
        uint256 factor = uint256(baseFactorBps) + uint256(stepFactorBps) * closedCleanCycles[accountId];
        return factor >= capFactorBps ? capFactorBps : uint16(factor);
    }

    /**
     * @notice The advance a borrower may take: the smaller of the recent mean and the latest period, times
     * the factor the account has earned, capped. Still explainable in one sentence and checkable by hand.
     * @dev `min(mean, latest)` rather than the mean alone, so a collapsing business is priced on its
     * collapse instead of its history.
     */
    function advanceLimitCents(bytes32 accountId) public view returns (uint256) {
        (uint256 avg, uint8 periodsUsed) = _averageRevenue(accountId);
        if (avg == 0 || periodsUsed == 0) return 0;
        uint256 latest = oracle.latestRevenue(accountId).revenueCents;
        uint256 base = latest < avg ? latest : avg;
        uint256 limit = (base * accountFactorBps(accountId)) / 10_000;
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

    /// @notice Take an advance in FXRP, on Flare. Pausable: originations stop, repayments never do.
    function requestAdvance(bytes32 accountId, uint256 usdCents) external nonReentrant whenNotPaused {
        if (usdCents == 0) revert InvalidAmount();

        (uint256 price, int8 priceDecimals) = _xrpUsd();
        if (price == 0) revert InvalidPrice();

        uint256 fxrpAmount = usdCentsToFxrp(usdCents, price, priceDecimals);
        if (fxrpAmount == 0) revert InvalidAmount();

        address borrower = _openAdvance(accountId, usdCents, fxrpAmount, price, priceDecimals);

        if (address(pool) != address(0)) {
            pool.lend(borrower, fxrpAmount);
        } else {
            treasuryBalance -= fxrpAmount;
            fxrp.safeTransfer(borrower, fxrpAmount);
        }
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
    ) external nonReentrant whenNotPaused {
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

        // The redemption burns FXRP from this contract, so the pool lends to the manager itself here.
        if (address(pool) != address(0)) {
            pool.lend(address(this), fxrpAmount);
        } else {
            treasuryBalance -= fxrpAmount;
        }
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
        uint256 available = availableFunds();
        if (fxrpAmount > available) revert InsufficientTreasury(available, fxrpAmount);

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
        advance.factorBps = accountFactorBps(accountId);
        advance.xrpUsdPrice = price;
        advance.priceDecimals = priceDecimals;
        // A new advance starts its retirement ledger fresh; the old advance's is fully consumed by close.
        fxrpRetired[accountId] = 0;

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

        _applyCredit(accountId, advance);
    }

    /**
     * @dev Banked credit from earlier XRPL overpayments settles the new debt immediately. If it covers the
     * whole obligation the advance opens already closed — the borrower has effectively converted old
     * overpaid XRP into fresh FXRP — but it deliberately does NOT count as a clean cycle: cycles are
     * earned by repaying, and letting credit close them would let five micro-advances farm the tier cap
     * for the price of the fees.
     */
    function _applyCredit(bytes32 accountId, Advance storage advance) internal {
        uint256 credit = creditCents[accountId];
        if (credit == 0) return;

        uint256 applied = credit > advance.outstandingCents ? advance.outstandingCents : credit;
        creditCents[accountId] = credit - applied;
        advance.outstandingCents -= applied;
        emit CreditApplied(accountId, applied, advance.outstandingCents);

        if (advance.outstandingCents == 0) {
            advance.open = false;
            if (address(pool) != address(0)) {
                uint256 retired = _retire(accountId, advance, applied, true);
                pool.onRepayment(0, retired);
            }
            emit AdvanceClosed(accountId);
        }
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

        bool closed = advance.outstandingCents == 0;
        if (closed) {
            advance.open = false;
            // A cycle only counts toward the tier schedule if it was never delinquent along the way.
            if (!advance.delinquent) closedCleanCycles[accountId] += 1;
        }

        if (address(pool) != address(0)) {
            uint256 retired = _retire(accountId, advance, usdCents, closed);
            fxrp.safeTransferFrom(borrower, address(pool), fxrpAmount);
            pool.onRepayment(fxrpAmount, retired);
        } else {
            treasuryBalance += fxrpAmount;
            fxrp.safeTransferFrom(borrower, address(this), fxrpAmount);
        }

        emit Repaid(
            accountId, borrower, usdCents, fxrpAmount, price, priceDecimals, advance.outstandingCents, automatic
        );
        if (closed) emit AdvanceClosed(accountId);
    }

    /**
     * @dev How much of this advance's disbursed FXRP a repayment of `usdCents` retires from the pool's
     * books: the dollar share of the total owed at origination, applied to the FXRP that actually left.
     * The final repayment retires the exact remainder, so rounding can never strand a residue.
     */
    function _retire(
        bytes32 accountId,
        Advance storage advance,
        uint256 usdCents,
        bool closed
    ) internal returns (uint256 retired) {
        uint256 alreadyRetired = fxrpRetired[accountId];
        if (closed) {
            retired = advance.fxrpDisbursed - alreadyRetired;
        } else {
            uint256 totalOwedAtOpen = advance.principalCents + advance.feeCents;
            retired = (advance.fxrpDisbursed * usdCents) / totalOwedAtOpen;
            uint256 remaining = advance.fxrpDisbursed - alreadyRetired;
            if (retired > remaining) retired = remaining;
        }
        fxrpRetired[accountId] = alreadyRetired + retired;
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
     * transaction's payment reference. On the XRP Ledger that means exactly one memo whose `MemoData` is
     * this 32-byte value — not the `InvoiceID` field, which looks like the obvious place for it and is not
     * read by FDC at all. That reference is what ties an otherwise anonymous payment to one obligation.
     *
     * This is a second FDC attestation type: revenue arrives through Web2Json, repayment through Payment.
     * The same Merkle proof machinery verifies both.
     *
     * @dev Check order is deliberate and mirrors Flare's own `PaymentProofs` library in Smart Accounts: the
     * cheap field comparisons run first and the expensive FDC verification runs last.
     */
    function repayFromXrpl(bytes32 accountId, IPayment.Proof calldata proof) external nonReentrant {
        _repayFromXrplOne(accountId, proof);
    }

    /**
     * @notice Settle several XRPL payments against one account in a single transaction.
     * @dev Each payment needs its own FDC attestation — that fee is per request and cannot be amortised —
     * but the gas and the ceremony can be, which is what makes small, frequent repayments economic. If the
     * debt closes mid-batch, the remaining payments land as credit rather than reverting the whole batch.
     */
    function repayFromXrplBatch(bytes32 accountId, IPayment.Proof[] calldata proofs) external nonReentrant {
        if (proofs.length == 0) revert InvalidAmount();
        for (uint256 i = 0; i < proofs.length; i++) {
            _repayFromXrplOne(accountId, proofs[i]);
        }
    }

    /**
     * @notice Restrict repayments to one XRPL sender, or lift the restriction with an empty string.
     *
     * Unset, anyone may settle the account's debt — deliberate, a third party paying on a borrower's
     * behalf is a feature. Set, a payment from anywhere else is rejected even with the right reference,
     * which is the borrower's protection against a stranger's mistaken payment binding to their history.
     */
    function bindRepaymentSource(bytes32 accountId, string calldata xrplAddress) external {
        address owner_ = oracle.accountOwner(accountId);
        if (owner_ != msg.sender) revert NotAccountOwner(owner_, msg.sender);

        bytes32 senderHash = bytes(xrplAddress).length == 0 ? bytes32(0) : keccak256(bytes(xrplAddress));
        boundRepaymentSource[accountId] = senderHash;
        emit RepaymentSourceBound(accountId, senderHash);
    }

    function _repayFromXrplOne(bytes32 accountId, IPayment.Proof calldata proof) internal {
        uint256 drops = _validateXrplPayment(accountId, proof);

        (uint256 price, int8 priceDecimals) = _xrpUsd();
        if (price == 0) revert InvalidPrice();

        uint256 usdValue = xrpDropsToUsdCents(drops, price, priceDecimals);
        if (usdValue == 0) revert InvalidAmount();

        /*
         * Debt first, credit after. An XRPL payment cannot be retracted, so every attested dollar is
         * honoured: what the open advance can absorb settles it, and the remainder becomes credit that
         * the next advance consumes at origination.
         */
        uint256 toDebt = _settleXrplDebt(
            accountId, proof.data.requestBody.transactionId, drops, usdValue, price, priceDecimals
        );

        uint256 toCredit = usdValue - toDebt;
        if (toCredit > 0) {
            creditCents[accountId] += toCredit;
            emit CreditAccrued(accountId, toCredit, creditCents[accountId]);
        }
    }

    /// @dev Every field that ties the payment to this chain, this treasury, this account and (when bound)
    /// this sender — cheap checks first, the FDC proof last. Marks the replay guard on success.
    function _validateXrplPayment(
        bytes32 accountId,
        IPayment.Proof calldata proof
    ) internal returns (uint256 drops) {
        if (xrplTreasuryAddressHash == bytes32(0)) revert XrplRepaymentUnavailable();

        IPayment.ResponseBody calldata body = proof.data.responseBody;

        if (proof.data.sourceId != xrplSourceId) revert WrongPaymentChain(xrplSourceId, proof.data.sourceId);
        if (body.status != 0) revert PaymentNotSuccessful(body.status);
        if (body.receivingAddressHash != xrplTreasuryAddressHash) revert WrongPaymentRecipient();
        if (body.standardPaymentReference != accountId) {
            revert WrongPaymentReference(accountId, body.standardPaymentReference);
        }
        bytes32 bound = boundRepaymentSource[accountId];
        if (bound != bytes32(0) && body.sourceAddressHash != bound) {
            revert WrongPaymentSender(bound, body.sourceAddressHash);
        }

        bytes32 transactionId = proof.data.requestBody.transactionId;
        if (xrplPaymentUsed[transactionId]) revert XrplPaymentAlreadyUsed(transactionId);
        if (body.receivedAmount <= 0) revert InvalidAmount();

        if (!_verifyPayment(proof)) revert InvalidPaymentProof();

        xrplPaymentUsed[transactionId] = true;
        return uint256(body.receivedAmount);
    }

    /// @dev Apply an attested dollar value to the open advance, if any. Returns what the debt absorbed.
    function _settleXrplDebt(
        bytes32 accountId,
        bytes32 transactionId,
        uint256 drops,
        uint256 usdValue,
        uint256 price,
        int8 priceDecimals
    ) internal returns (uint256 toDebt) {
        Advance storage advance = _advances[accountId];
        if (!advance.open) return 0;

        toDebt = usdValue > advance.outstandingCents ? advance.outstandingCents : usdValue;
        advance.outstandingCents -= toDebt;
        advance.lastActivityAt = uint64(block.timestamp);

        bool closed = advance.outstandingCents == 0;
        if (closed) {
            advance.open = false;
            // Same rule as the FXRP path: only a never-delinquent cycle earns tier progress.
            if (!advance.delinquent) closedCleanCycles[accountId] += 1;
        }

        /*
         * Deliberately no FXRP inflow recorded: the XRP landed on the XRP Ledger, not here. With a pool
         * attached, the retired principal books with zero inflow — the share price visibly dips until the
         * operator re-mints that XRP through FAssets and returns it by plain transfer.
         */
        if (address(pool) != address(0)) {
            uint256 retired = _retire(accountId, advance, toDebt, closed);
            pool.onRepayment(0, retired);
        }

        emit RepaidFromXrpl(accountId, transactionId, drops, toDebt, price, priceDecimals, advance.outstandingCents);
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

    /**
     * @notice Take the loss on a delinquent advance, formally. Delinquency is a fact; a write-off is an
     * accounting decision, so it is separate, owner-gated, and only possible after a second full grace
     * period of silence. The advance closes uncollectable; with a pool attached, the unrecovered FXRP
     * leaves its books and every share takes the loss at once, visibly.
     * @dev The account itself stays delinquent, which permanently blocks further advances to it.
     */
    function writeOff(bytes32 accountId) external onlyOwner nonReentrant {
        Advance storage advance = _advances[accountId];
        if (!advance.open) revert NoOpenAdvance();
        if (!advance.delinquent) revert NotDelinquent();
        if (block.timestamp <= advance.lastActivityAt + 2 * uint256(gracePeriod)) {
            revert GracePeriodNotElapsed();
        }

        uint256 lostCents = advance.outstandingCents;
        uint256 lostFxrp = advance.fxrpDisbursed - fxrpRetired[accountId];

        advance.outstandingCents = 0;
        advance.open = false;
        fxrpRetired[accountId] = advance.fxrpDisbursed;

        if (address(pool) != address(0) && lostFxrp > 0) {
            pool.onWriteOff(lostFxrp);
        }

        emit WrittenOff(accountId, lostCents, lostFxrp);
        emit AdvanceClosed(accountId);
    }

    // ---------------------------------------------------------------- treasury

    function depositTreasury(uint256 amount) external onlyOwner nonReentrant {
        if (address(pool) != address(0)) revert TreasuryModeDisabled();
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

    /**
     * @notice Set the tier schedule. Owner-only today; moves behind a timelock with the lender pool,
     * because these four numbers are the underwriting policy.
     * @dev `base > cap` is rejected; `base` above ~290 (card fees) reopens the recycling attack, which is
     * a policy decision the event makes visible rather than a constraint the contract enforces.
     */
    function setFactorSchedule(
        uint16 newBaseFactorBps,
        uint16 newStepFactorBps,
        uint16 newCapFactorBps,
        uint64 newMinAccountAgeSeconds
    ) external onlyOwner {
        if (newBaseFactorBps > newCapFactorBps) revert InvalidAmount();
        baseFactorBps = newBaseFactorBps;
        stepFactorBps = newStepFactorBps;
        capFactorBps = newCapFactorBps;
        minAccountAgeSeconds = newMinAccountAgeSeconds;
        emit FactorScheduleSet(newBaseFactorBps, newStepFactorBps, newCapFactorBps, newMinAccountAgeSeconds);
    }

    function setAssetManager(address newAssetManager) external onlyOwner {
        assetManager = IFAssetRedeemer(newAssetManager);
        emit AssetManagerSet(newAssetManager);
    }

    /**
     * @notice Attach the lender pool. One funding source at a time: the owner treasury must be empty, and
     * once a pool has lent anything it cannot be swapped out from under its own receivables.
     */
    function setPool(address newPool) external onlyOwner {
        if (treasuryBalance != 0) revert TreasuryModeDisabled();
        if (address(pool) != address(0) && pool.lentFxrp() != 0) revert PoolAlreadyActive();
        pool = LenderPool(newPool);
        emit PoolSet(newPool);
    }

    /// @notice Stop originations. Repayments are deliberately unpausable — trapping them would manufacture
    /// delinquencies out of an operational decision.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice What can actually fund an advance right now, whichever mode is active.
    function availableFunds() public view returns (uint256) {
        return address(pool) != address(0) ? pool.availableToLend() : treasuryBalance;
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
