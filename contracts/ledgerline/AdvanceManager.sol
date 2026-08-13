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

    /**
     * @notice History depth as its own tier term: each proven period beyond the first adds this much.
     * Periods cannot overlap, so importing a year of genuine history is a year of card fees to fake —
     * which is what lets a real, established business start above the cold-start floor.
     */
    uint16 public historyStepBps = 0;

    /**
     * @notice Expected loss, priced. The origination fee carries a premium proportional to how far the
     * account sits below the tier cap: tier-0 borrowers pay for the book's risk, proven accounts converge
     * to the base fee. Zero keeps the deployed flat-fee behaviour.
     */
    uint16 public riskPremiumBps = 0;

    uint16 public feeBps = 500; // 5% origination fee
    uint16 public repaymentShareBps = 2_000; // 20% of each attested period
    uint256 public maxAdvanceCents = 10_000_000; // $100,000 hard cap
    uint64 public gracePeriod = 45 days;

    /**
     * @notice The outside date on an advance. Revenue-based finance is not open-ended credit: the money
     * is advanced against a few months of earnings and is expected back on that timescale. This is also
     * what stops a token repayment every grace period from keeping a balance open indefinitely.
     */
    uint64 public maxTermSeconds = 180 days;

    /*
     * Phase A of the real-world plan (docs/REALWORLD-PLAN.md): the mechanisms the incumbent
     * industry uses, adapted on-chain. Each is governable and defaults to the researched value.
     */

    /**
     * @notice Rolling reserve, the acquiring industry's answer to refund lag: settled card revenue
     * is not final money for ~120 days, so a slice of each advance is escrowed and released only
     * once the underwritten revenue has survived the refund window (or the advance closes clean).
     */
    uint16 public reserveBps = 1_000; // 10% of each advance
    uint64 public refundWindowSeconds = 120 days;

    /// @notice Escrowed reserve per advance, in FXRP. Released to the borrower; consumed on write-off.
    mapping(bytes32 => uint256) public reserveFxrp;

    /**
     * @notice The repayment floor curve, copied from Stripe Capital's minimum-payment true-up:
     * revenue share must have returned at least `floorBps` of the obligation by each fraction of
     * the term, or anyone may declare the account behind schedule — which springs the splitter to
     * full withholding rather than accelerating a balance (the true-sale-compatible response).
     */
    uint16 public floorBpsAtHalfTerm = 3_000; // 30% repaid by half-term
    mapping(bytes32 => bool) public floorBreached;

    /**
     * @notice Velocity brakes, the BNPL ladder at protocol level: a cap on originations per epoch,
     * so a coordinated wave of fresh accounts cannot drain the pool inside one governance delay.
     */
    uint32 public maxOriginationsPerEpoch = 50;
    uint64 public constant ORIGINATION_EPOCH = 1 days;
    mapping(uint256 => uint32) public originationsInEpoch;

    /**
     * @notice The keeper's tip for reporting a delinquency, in FXRP, funded by anyone (typically
     * from protocol fees). Flat rather than proportional: the StableSims result is that keepers'
     * costs are fixed, so the flat component is what actually moves them. If the reserve is empty
     * the mark still succeeds; the tip is an incentive, not a precondition.
     */
    uint256 public keeperTipFxrp = 5_000_000; // 5 FXRP
    uint256 public keeperReserveFxrp;

    /**
     * @notice The guardian: an address that can pause instantly but can never unpause — Compound's
     * asymmetry. With ownership behind a timelock, an owner-only pause would announce an exploit
     * response an hour before making it; the guardian closes that window. Repayments stay
     * unpausable either way.
     */
    address public guardian;

    /**
     * @notice How stale the XRP/USD feed may be before this contract refuses to price anything.
     * FTSOv2 publishes roughly every 90 seconds, so an hour is ~40 missed updates: comfortably wide enough
     * never to fire in normal operation, narrow enough that a genuinely broken feed cannot mis-size an
     * advance. Repayments refuse too — pricing a repayment off a stale feed cheats whichever side the
     * price moved against.
     */
    uint64 public maxPriceAge = 1 hours;

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
    event RiskTermsSet(uint16 historyStepBps, uint16 riskPremiumBps);
    event PoolSet(address pool);
    /// @notice The unrecovered remainder of a delinquent advance, formally taken as the pool's loss.
    event WrittenOff(bytes32 indexed accountId, uint256 outstandingCents, uint256 fxrpWrittenOff);
    event CreditAccrued(bytes32 indexed accountId, uint256 usdCents, uint256 totalCreditCents);
    event CreditApplied(bytes32 indexed accountId, uint256 usdCents, uint256 outstandingCents);
    event RepaymentSourceBound(bytes32 indexed accountId, bytes32 xrplSenderHash);
    event XrplTreasurySet(string xrplAddress, bytes32 xrplAddressHash, bytes32 sourceId);
    event MaxPriceAgeSet(uint64 maxPriceAge);
    event MaxTermSet(uint64 maxTermSeconds);
    event ReserveEscrowed(bytes32 indexed accountId, uint256 fxrpAmount);
    event ReserveReleased(bytes32 indexed accountId, address indexed to, uint256 fxrpAmount);
    event ReserveConsumed(bytes32 indexed accountId, uint256 fxrpAmount);
    event FloorBreached(bytes32 indexed accountId, uint256 repaidCents, uint256 requiredCents);
    event KeeperTipped(address indexed keeper, bytes32 indexed accountId, uint256 fxrpAmount);
    event KeeperReserveFunded(address indexed from, uint256 fxrpAmount);
    event GuardianSet(address guardian);
    event ReserveTermsSet(uint16 reserveBps, uint64 refundWindowSeconds);
    event VelocitySet(uint32 maxOriginationsPerEpoch);
    event FloorSet(uint16 floorBpsAtHalfTerm);
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
    error StalePrice(uint64 feedTimestamp, uint256 blockTimestamp);
    error RedemptionShortfall(uint256 requested, uint256 redeemed);
    error ReserveNotReleasable();
    error FloorNotBreached();
    error OriginationRateExceeded(uint32 inEpoch, uint32 cap);
    error NotGuardianOrOwner();

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
        uint256 periods = oracle.attestationCount(accountId);
        if (periods > 1) {
            factor += uint256(historyStepBps) * (periods - 1);
        }
        return factor >= capFactorBps ? capFactorBps : uint16(factor);
    }

    /// @notice The fee this account pays: the base plus a premium that shrinks as the earned factor rises.
    function accountFeeBps(bytes32 accountId) public view returns (uint16) {
        if (riskPremiumBps == 0) return feeBps;
        uint256 shortfall = uint256(capFactorBps) - accountFactorBps(accountId);
        return uint16(uint256(feeBps) + (uint256(riskPremiumBps) * shortfall) / capFactorBps);
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
            total += _ageWeighted(history[i].revenueCents, history[i].periodEnd);
        }
        return (total / count, uint8(count));
    }

    /**
     * @dev The acquiring industry's discount on recent settlement, in underwriting form. Card revenue can
     * be refunded or disputed for roughly `refundWindowSeconds` after it settles, so a period that ended
     * yesterday is provisional in a way a five-month-old period is not. Weight runs linearly from 50% for
     * revenue proven this instant to 100% once the window has fully passed — the same shape as a rolling
     * reserve, applied to the limit rather than the payout.
     */
    function _ageWeighted(uint256 revenueCents, uint64 periodEnd) internal view returns (uint256) {
        if (block.timestamp <= periodEnd) return revenueCents / 2;
        uint256 age = block.timestamp - periodEnd;
        if (age >= refundWindowSeconds) return revenueCents;
        // 50% at age 0 rising linearly to 100% at the window's edge.
        return (revenueCents * (5_000 + (5_000 * age) / refundWindowSeconds)) / 10_000;
    }

    // ---------------------------------------------------------------- advances

    /// @notice Take an advance in FXRP, on Flare. Pausable: originations stop, repayments never do.
    function requestAdvance(bytes32 accountId, uint256 usdCents) external nonReentrant whenNotPaused {
        if (usdCents == 0) revert InvalidAmount();

        (uint256 price, int8 priceDecimals) = _xrpUsdFresh();

        uint256 fxrpAmount = usdCentsToFxrp(usdCents, price, priceDecimals);
        if (fxrpAmount == 0) revert InvalidAmount();

        address borrower = _openAdvance(accountId, usdCents, fxrpAmount, price, priceDecimals);

        /*
         * The rolling reserve: a slice of the advance stays here in escrow instead of reaching the
         * borrower, released once the underwritten revenue has outlived the refund window (or the
         * advance closes clean). The debt is still the full amount — the reserve is the borrower's
         * money held back, exactly as an acquirer holds a merchant's.
         */
        uint256 reserved = (fxrpAmount * reserveBps) / 10_000;
        if (address(pool) != address(0)) {
            if (reserved > 0) pool.lend(address(this), reserved);
            pool.lend(borrower, fxrpAmount - reserved);
        } else {
            treasuryBalance -= fxrpAmount;
            fxrp.safeTransfer(borrower, fxrpAmount - reserved);
        }
        if (reserved > 0) {
            reserveFxrp[accountId] = reserved;
            emit ReserveEscrowed(accountId, reserved);
        }

        // Only once the FXRP is actually out can credit retire it: settling the debt before the pool has
        // booked the loan would retire principal that had not been lent yet.
        _applyCredit(accountId, _advances[accountId]);
    }

    /**
     * @notice Release an advance's escrowed reserve to the borrower. Permissionless, because the
     * conditions are on-chain facts: the advance closed without ever going delinquent, or the refund
     * window has fully passed on an advance that is still current.
     */
    function releaseReserve(bytes32 accountId) external nonReentrant {
        uint256 amount = reserveFxrp[accountId];
        if (amount == 0) revert InvalidAmount();
        Advance storage advance = _advances[accountId];

        bool closedClean = !advance.open && !advance.delinquent;
        bool windowPassed = !advance.delinquent
            && block.timestamp > uint256(advance.openedAt) + refundWindowSeconds;
        if (!closedClean && !windowPassed) revert ReserveNotReleasable();

        reserveFxrp[accountId] = 0;
        address borrower = oracle.accountOwner(accountId);
        fxrp.safeTransfer(borrower, amount);
        emit ReserveReleased(accountId, borrower, amount);
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

        (uint256 price, int8 priceDecimals) = _xrpUsdFresh();

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
        /*
         * The debt was computed from the lots asked for, so anything less actually redeemed would leave
         * the borrower owing dollars against XRP that was never sent. FAssets fills from whatever agents
         * have capacity and returns what it managed; a short fill is a reason to refuse the advance, not
         * to book it and reconcile later.
         */
        uint256 redeemed = redeemer.redeem(lots, xrplAddress, payable(address(0)));
        if (redeemed < fxrpAmount) revert RedemptionShortfall(fxrpAmount, redeemed);

        emit AdvanceDisbursedToXrpl(accountId, borrower, lots, fxrpAmount, xrplAddress);

        // As in the FXRP leg: the loan has to be on the pool's books before credit can retire it.
        _applyCredit(accountId, _advances[accountId]);
    }

    /**
     * @dev The velocity brake. A coordinated wave of fresh accounts should not be able to drain the pool
     * faster than governance can react; the per-epoch cap bounds the blast radius of any origination
     * attack to one day's quota regardless of how many identities it wears. Its own function because
     * `_openAdvance`'s frame is already at the stack limit.
     */
    function _takeOriginationSlot() internal {
        uint256 epoch = block.timestamp / ORIGINATION_EPOCH;
        uint32 inEpoch = originationsInEpoch[epoch] + 1;
        if (inEpoch > maxOriginationsPerEpoch) {
            revert OriginationRateExceeded(inEpoch, maxOriginationsPerEpoch);
        }
        originationsInEpoch[epoch] = inEpoch;
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

        _takeOriginationSlot();

        uint256 limit = advanceLimitCents(accountId);
        if (usdCents > limit) revert ExceedsLimit(limit, usdCents);
        uint256 available = availableFunds();
        if (fxrpAmount > available) revert InsufficientTreasury(available, fxrpAmount);

        uint256 fee = (usdCents * accountFeeBps(accountId)) / 10_000;

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
     * @notice Repay with FXRP the caller already holds, on the account's behalf.
     *
     * This is the splitter's rail: revenue routed through a lockbox arrives as FXRP in the
     * splitter's hands, not the borrower's, so the pull-from-borrower path cannot serve it. The
     * caller pays; the account is credited; anything beyond the outstanding balance banks as
     * credit, mirroring the XRPL overpayment rule — a lockbox cannot bounce the excess back
     * mid-split any more than an XRPL payment can be retracted.
     */
    function repayFxrpFor(bytes32 accountId, uint256 fxrpAmount) external nonReentrant {
        if (fxrpAmount == 0) revert InvalidAmount();

        Advance storage advance = _advances[accountId];
        if (!advance.open) revert NoOpenAdvance();

        (uint256 price, int8 priceDecimals) = _xrpUsdFresh();
        uint256 usdValue = fxrpToUsdCents(fxrpAmount, price, priceDecimals);
        if (usdValue == 0) revert InvalidAmount();

        uint256 toDebt = usdValue > advance.outstandingCents ? advance.outstandingCents : usdValue;
        advance.outstandingCents -= toDebt;
        advance.lastActivityAt = uint64(block.timestamp);

        bool closed = advance.outstandingCents == 0;
        if (closed) {
            advance.open = false;
            if (!advance.delinquent) closedCleanCycles[accountId] += 1;
        }

        if (address(pool) != address(0)) {
            uint256 retired = _retire(accountId, advance, toDebt, closed);
            fxrp.safeTransferFrom(msg.sender, address(pool), fxrpAmount);
            pool.onRepayment(fxrpAmount, retired);
        } else {
            treasuryBalance += fxrpAmount;
            fxrp.safeTransferFrom(msg.sender, address(this), fxrpAmount);
        }

        uint256 toCredit = usdValue - toDebt;
        if (toCredit > 0) {
            creditCents[accountId] += toCredit;
            emit CreditAccrued(accountId, toCredit, creditCents[accountId]);
        }

        emit Repaid(accountId, msg.sender, toDebt, fxrpAmount, price, priceDecimals, advance.outstandingCents, true);
        if (closed) emit AdvanceClosed(accountId);
        _maybeCureFloor(accountId);
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

        (uint256 price, int8 priceDecimals) = _xrpUsdFresh();

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
        _maybeCureFloor(accountId);
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

        (uint256 price, int8 priceDecimals) = _xrpUsdFresh();

        uint256 usdValue = xrpDropsToUsdCents(drops, price, priceDecimals);
        if (usdValue == 0) revert InvalidAmount();

        /*
         * Debt first, credit after. An XRPL payment cannot be retracted, so every attested dollar is
         * honoured: what the open advance can absorb settles it, and the remainder becomes credit that
         * the next advance consumes at origination.
         */
        (uint256 toDebt, uint256 retired) = _settleXrplDebt(
            accountId, proof.data.requestBody.transactionId, drops, usdValue, price, priceDecimals
        );

        /*
         * Book the claim for the whole payment, whether or not a debt absorbed it. The XRP is in the
         * operator's XRPL treasury either way, and the part that becomes credit is precisely the part that
         * will later fund an advance out of this pool — so a payment that booked nothing would let credit
         * spend FXRP the pool was never credited for.
         */
        if (address(pool) != address(0)) {
            pool.onXrplRepayment(drops, retired);
        }

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

    /// @dev Apply an attested dollar value to the open advance, if any. Returns what the debt absorbed and
    /// how much lent principal that retires — the caller books both against the pool in one place.
    function _settleXrplDebt(
        bytes32 accountId,
        bytes32 transactionId,
        uint256 drops,
        uint256 usdValue,
        uint256 price,
        int8 priceDecimals
    ) internal returns (uint256 toDebt, uint256 retired) {
        Advance storage advance = _advances[accountId];
        if (!advance.open) return (0, 0);

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
         * No FXRP arrived here — the XRP landed on the XRP Ledger. With a pool attached, the received
         * amount books as a receivable (drops and FXRP base units are both millionths, so the mapping is
         * 1:1), which keeps the share price whole while stating the claim, until the operator re-mints
         * the XRP through FAssets and settles it. The caller makes that booking.
         */
        if (address(pool) != address(0)) {
            retired = _retire(accountId, advance, toDebt, closed);
        }

        emit RepaidFromXrpl(accountId, transactionId, drops, toDebt, price, priceDecimals, advance.outstandingCents);
        if (closed) emit AdvanceClosed(accountId);
    }

    /**
     * @notice How far behind its floor an advance is. The floor is linear-by-parts: `floorBpsAtHalfTerm`
     * of the obligation by half the term, the whole obligation by the term's end. Returns zero shortfall
     * while the account is on schedule.
     */
    function floorShortfallCents(bytes32 accountId) public view returns (uint256 shortfall, uint256 required) {
        Advance storage advance = _advances[accountId];
        if (!advance.open) return (0, 0);

        uint256 elapsed = block.timestamp - advance.openedAt;
        uint256 owedAtOpen = advance.principalCents + advance.feeCents;
        if (elapsed <= uint256(maxTermSeconds) / 2) {
            required = (owedAtOpen * floorBpsAtHalfTerm * elapsed * 2) / (uint256(maxTermSeconds) * 10_000);
        } else if (elapsed < maxTermSeconds) {
            uint256 half = (owedAtOpen * floorBpsAtHalfTerm) / 10_000;
            required = half + ((owedAtOpen - half) * (elapsed - uint256(maxTermSeconds) / 2)) / (uint256(maxTermSeconds) / 2);
        } else {
            required = owedAtOpen;
        }
        uint256 repaid = owedAtOpen - advance.outstandingCents;
        shortfall = repaid >= required ? 0 : required - repaid;
    }

    /**
     * @notice Declare an account behind its repayment floor. Permissionless; the shortfall is an on-chain
     * fact. The consequence is springing withholding at the splitter, not acceleration — an advance behind
     * schedule surrenders its whole revenue stream until it catches up, which is the strongest response a
     * purchase of receivables can make without becoming a loan.
     */
    function declareFloorBreach(bytes32 accountId) external {
        (uint256 shortfall, uint256 required) = floorShortfallCents(accountId);
        if (shortfall == 0) revert FloorNotBreached();
        floorBreached[accountId] = true;
        Advance storage advance = _advances[accountId];
        uint256 repaid = advance.principalCents + advance.feeCents - advance.outstandingCents;
        emit FloorBreached(accountId, repaid, required);
    }

    /// @dev A repayment that brings the account back over its floor clears the breach automatically.
    function _maybeCureFloor(bytes32 accountId) internal {
        if (!floorBreached[accountId]) return;
        (uint256 shortfall, ) = floorShortfallCents(accountId);
        if (shortfall == 0) {
            floorBreached[accountId] = false;
        }
    }

    /**
     * @notice Record that an advance has gone unserviced, either way it can.
     *
     * Two independent triggers, because one alone is gameable. Silence past the grace period is the
     * obvious one. The other is the term: every repayment refreshes `lastActivityAt`, so a borrower
     * paying a single cent every forty-four days could hold a six-figure balance open forever and never
     * be delinquent. An advance therefore also has an outside date — repay within `maxTermSeconds` of
     * opening or the account is delinquent regardless of how diligently it has been dripping.
     */
    function markDelinquent(bytes32 accountId) external {
        Advance storage advance = _advances[accountId];
        if (!advance.open) revert NoOpenAdvance();

        bool wentQuiet = block.timestamp > advance.lastActivityAt + gracePeriod;
        bool termExpired = block.timestamp > advance.openedAt + maxTermSeconds;
        if (!wentQuiet && !termExpired) revert GracePeriodNotElapsed();

        advance.delinquent = true;
        emit MarkedDelinquent(accountId, advance.outstandingCents);

        /*
         * The watchman's tip. Flat, because keepers' costs are flat (gas plus monitoring), and paid only
         * if the reserve can cover it — an empty reserve degrades the incentive, never the function.
         */
        uint256 tip = keeperTipFxrp;
        if (tip > 0 && keeperReserveFxrp >= tip) {
            keeperReserveFxrp -= tip;
            fxrp.safeTransfer(msg.sender, tip);
            emit KeeperTipped(msg.sender, accountId, tip);
        }
    }

    /// @notice Fund the keeper tip reserve. Anyone may; protocol fees are the intended source.
    function fundKeeperReserve(uint256 fxrpAmount) external nonReentrant {
        if (fxrpAmount == 0) revert InvalidAmount();
        keeperReserveFxrp += fxrpAmount;
        fxrp.safeTransferFrom(msg.sender, address(this), fxrpAmount);
        emit KeeperReserveFunded(msg.sender, fxrpAmount);
    }

    /**
     * @notice checkUpkeep-shaped: which of these accounts can be marked delinquent right now. Any bot,
     * automation network, or curious wallet can consume it; candidates come from event indexing because
     * the contract deliberately keeps no account enumeration.
     */
    function delinquencyDue(bytes32[] calldata accountIds) external view returns (bool[] memory due) {
        due = new bool[](accountIds.length);
        for (uint256 i = 0; i < accountIds.length; i++) {
            Advance storage advance = _advances[accountIds[i]];
            if (!advance.open || advance.delinquent) continue;
            due[i] =
                block.timestamp > advance.lastActivityAt + gracePeriod ||
                block.timestamp > advance.openedAt + maxTermSeconds;
        }
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

        /*
         * The reserve is consumed before the loss is booked: it is the borrower's held-back money,
         * and absorbing the write-off is precisely what it was held back for. It returns to the
         * pool as recovered principal, shrinking what the junior tranche and the share price bear.
         */
        uint256 recovered = reserveFxrp[accountId];
        if (recovered > 0) {
            reserveFxrp[accountId] = 0;
            if (recovered > lostFxrp) recovered = lostFxrp;
            emit ReserveConsumed(accountId, recovered);
        }

        if (address(pool) != address(0)) {
            if (recovered > 0) {
                fxrp.safeTransfer(address(pool), recovered);
                pool.onRepayment(recovered, recovered);
            }
            uint256 netLost = lostFxrp - recovered;
            if (netLost > 0) pool.onWriteOff(netLost);
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

    /// @notice The two cold-start levers: history-depth tier growth and the risk premium on young accounts.
    function setRiskTerms(uint16 newHistoryStepBps, uint16 newRiskPremiumBps) external onlyOwner {
        historyStepBps = newHistoryStepBps;
        riskPremiumBps = newRiskPremiumBps;
        emit RiskTermsSet(newHistoryStepBps, newRiskPremiumBps);
    }

    /// @notice Reserve share and the refund window it must outlive.
    function setReserveTerms(uint16 newReserveBps, uint64 newRefundWindowSeconds) external onlyOwner {
        if (newReserveBps > 5_000 || newRefundWindowSeconds == 0) revert InvalidAmount();
        reserveBps = newReserveBps;
        refundWindowSeconds = newRefundWindowSeconds;
        emit ReserveTermsSet(newReserveBps, newRefundWindowSeconds);
    }

    /// @notice The origination velocity cap. Zero would halt the protocol; refuse it.
    function setVelocity(uint32 newMaxOriginationsPerEpoch) external onlyOwner {
        if (newMaxOriginationsPerEpoch == 0) revert InvalidAmount();
        maxOriginationsPerEpoch = newMaxOriginationsPerEpoch;
        emit VelocitySet(newMaxOriginationsPerEpoch);
    }

    /// @notice The repayment floor at half-term, and the keeper's flat tip.
    function setFloor(uint16 newFloorBpsAtHalfTerm) external onlyOwner {
        if (newFloorBpsAtHalfTerm > 10_000) revert InvalidAmount();
        floorBpsAtHalfTerm = newFloorBpsAtHalfTerm;
        emit FloorSet(newFloorBpsAtHalfTerm);
    }

    function setKeeperTip(uint256 newKeeperTipFxrp) external onlyOwner {
        keeperTipFxrp = newKeeperTipFxrp;
    }

    /// @notice The outside date on an advance. Zero would mean every advance is delinquent at once.
    function setMaxTerm(uint64 newMaxTermSeconds) external onlyOwner {
        if (newMaxTermSeconds == 0) revert InvalidAmount();
        maxTermSeconds = newMaxTermSeconds;
        emit MaxTermSet(newMaxTermSeconds);
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
    /// delinquencies out of an operational decision. The guardian may pause instantly; only the owner
    /// (the timelock) may unpause — Compound's asymmetry, so a compromised guardian can only ever stop
    /// originations, never steer the protocol, and an exploit response does not wait out its own delay.
    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardianOrOwner();
        _pause();
    }

    function setGuardian(address newGuardian) external onlyOwner {
        guardian = newGuardian;
        emit GuardianSet(newGuardian);
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
    function _xrpUsd() internal virtual returns (uint256 price, int8 decimals, uint64 timestamp) {
        return ContractRegistry.getFtsoV2().getFeedById(XRP_USD_FEED_ID);
    }

    /**
     * @dev Every dollar figure in this contract is converted at this price, so a stale feed does not
     * produce a slightly wrong answer — it produces an advance sized by yesterday's XRP. FTSOv2 updates
     * roughly every 90 seconds; anything older than `maxPriceAge` is treated as no price at all rather
     * than quietly used. A feed timestamp ahead of the block is equally wrong and equally refused.
     */
    function _xrpUsdFresh() internal returns (uint256 price, int8 decimals) {
        uint64 timestamp;
        (price, decimals, timestamp) = _xrpUsd();
        if (price == 0) revert InvalidPrice();
        if (timestamp > block.timestamp) revert StalePrice(timestamp, block.timestamp);
        if (block.timestamp - timestamp > maxPriceAge) revert StalePrice(timestamp, block.timestamp);
    }

    /// @notice The live XRP/USD the contract would use right now, with the age the freshness check sees.
    /// Call it with eth_call from the UI.
    function currentXrpUsd() external returns (uint256 price, int8 decimals, uint64 timestamp) {
        return _xrpUsd();
    }

    /// @notice How old the XRP/USD feed may be before advances and repayments refuse to price.
    function setMaxPriceAge(uint64 newMaxPriceAge) external onlyOwner {
        if (newMaxPriceAge == 0) revert InvalidAmount();
        maxPriceAge = newMaxPriceAge;
        emit MaxPriceAgeSet(newMaxPriceAge);
    }

    /**
     * @dev Production path is Flare's own verification contract, the same one RevenueOracle uses for
     * Web2Json. Overridden in tests, where no FDC exists to attest against.
     */
    function _verifyPayment(IPayment.Proof calldata proof) internal view virtual returns (bool) {
        return ContractRegistry.getFdcVerification().verifyPayment(proof);
    }
}
