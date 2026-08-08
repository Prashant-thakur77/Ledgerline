// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ContractRegistry } from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import { RevenueOracle } from "./RevenueOracle.sol";

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

    RevenueOracle public immutable oracle;
    IERC20 public immutable fxrp;
    uint8 public immutable fxrpDecimals;

    uint16 public factorBps = 10_000; // 1.0x the monthly average for a first advance
    uint16 public feeBps = 500; // 5% origination fee
    uint16 public repaymentShareBps = 2_000; // 20% of each attested period
    uint256 public maxAdvanceCents = 10_000_000; // $100,000 hard cap
    uint64 public gracePeriod = 45 days;

    uint256 public treasuryBalance;

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
    event MarkedDelinquent(bytes32 indexed accountId, uint256 outstandingCents);

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

    function requestAdvance(bytes32 accountId, uint256 usdCents) external nonReentrant {
        if (usdCents == 0) revert InvalidAmount();

        (uint256 avg, uint8 periodsUsed) = _averageRevenue(accountId);
        if (periodsUsed == 0) revert NoRevenueProven();

        address borrower = oracle.accountOwner(accountId);
        if (borrower != msg.sender) revert NotAccountOwner(borrower, msg.sender);

        Advance storage advance = _advances[accountId];
        if (advance.delinquent) revert AccountDelinquent();
        if (advance.open) revert AdvanceAlreadyOpen();

        uint256 limit = advanceLimitCents(accountId);
        if (usdCents > limit) revert ExceedsLimit(limit, usdCents);

        (uint256 price, int8 priceDecimals) = _xrpUsd();
        if (price == 0) revert InvalidPrice();

        uint256 fxrpAmount = usdCentsToFxrp(usdCents, price, priceDecimals);
        if (fxrpAmount == 0) revert InvalidAmount();
        if (fxrpAmount > treasuryBalance) revert InsufficientTreasury(treasuryBalance, fxrpAmount);

        uint256 fee = (usdCents * feeBps) / 10_000;

        // Effects before the transfer.
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

        treasuryBalance -= fxrpAmount;
        fxrp.safeTransfer(borrower, fxrpAmount);

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
}
