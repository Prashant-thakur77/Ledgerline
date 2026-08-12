// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title LenderPool
 * @notice The lender side: an ERC-4626 vault of FXRP that funds advances and receives repayments.
 *
 * The vault's assets are the idle FXRP it holds **plus** the FXRP currently out in advances (`lentFxrp`).
 * As repayments arrive, the lent portion retires and yield lands in the share price; when an advance is
 * written off, the unrecovered portion is removed from `lentFxrp` with nothing coming back, so the loss is
 * socialised across every share transparently — a falling share price, not a hidden hole.
 *
 * Two disclosures the interface must make, because the accounting makes them true rather than hiding them:
 *
 * 1. **LPs carry XRP/USD exposure.** Debts are denominated in dollars, pool assets in FXRP, so the FXRP
 *    that returns for a given dollar repaid moves with the price between disbursement and repayment.
 * 2. **XRPL-side repayments arrive off-pool.** A repayment proven from the XRP Ledger settles the debt but
 *    delivers XRP to an XRPL account, not FXRP here. The retired principal drops the share price until the
 *    operator re-mints that XRP through FAssets and returns it via a plain transfer (any donation raises
 *    `totalAssets`, making the pool whole). This is stated, not smoothed over.
 *
 * Withdrawals are limited to idle liquidity — an advance is not recallable, and `maxWithdraw` saying
 * otherwise would be a lie the first stressed LP discovers the hard way.
 */
contract LenderPool is ERC4626, Ownable {
    using SafeERC20 for IERC20;

    /// @notice The one contract allowed to draw funds out and report repayments back.
    address public manager;

    /// @notice FXRP currently out in advances. Part of totalAssets: lent, not gone.
    uint256 public lentFxrp;

    /**
     * @notice Protocol-owned first-loss capital. It sits in the same FXRP balance but is subtracted from
     * `totalAssets`, so it backs no shares — write-offs and impairments consume it before they touch the
     * share price, and its depth is public. This is what makes the LP pitch honest: seniors know exactly
     * how much loss stands between them and the first cent of damage.
     */
    uint256 public juniorAssets;

    /**
     * @notice XRP received on the XRP Ledger as repayment, awaiting re-mint into FXRP. Counted as an asset
     * because the claim is real and attested; settled by the re-mint transfer; impairable by governance if
     * the operator fails to deliver — with the junior tranche absorbing that failure first.
     */
    uint256 public xrplReceivableFxrp;

    /// @notice Lending stops when lent/total would exceed this, so withdrawals stay possible.
    uint16 public utilisationCapBps = 8_000; // 80%

    event ManagerSet(address manager);
    event UtilisationCapSet(uint16 capBps);
    event Lent(address indexed recipient, uint256 fxrpAmount);
    event RepaymentReceived(uint256 fxrpIn, uint256 fxrpRetired);
    event WrittenOff(uint256 fxrpRetired, uint256 juniorAbsorbed);
    event JuniorFunded(uint256 amount, uint256 juniorAssets);
    event JuniorWithdrawn(uint256 amount, uint256 juniorAssets);
    event XrplRepaymentBooked(uint256 receivableFxrp, uint256 fxrpRetired);
    event ReceivableSettled(address indexed by, uint256 fxrpIn, uint256 receivableRemaining);
    event ReceivableImpaired(uint256 amount, uint256 juniorAbsorbed);

    error NotManager(address caller);
    error UtilisationCapExceeded(uint256 lentAfter, uint256 totalAfter, uint16 capBps);
    error InvalidCap();
    error ZeroAmount();
    error ExceedsJunior(uint256 requested, uint256 juniorAssets);
    error ExceedsReceivable(uint256 requested, uint256 receivable);

    modifier onlyManager() {
        if (msg.sender != manager) revert NotManager(msg.sender);
        _;
    }

    constructor(IERC20 fxrp)
        ERC4626(fxrp)
        ERC20("Ledgerline FXRP Pool", "llFXRP")
        Ownable(msg.sender)
    {}

    // ---------------------------------------------------------------- accounting

    /// @notice What backs the shares: idle FXRP, lent principal, and the attested XRPL receivable — minus
    /// the junior buffer, which backs losses instead of shares.
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + lentFxrp + xrplReceivableFxrp - juniorAssets;
    }

    /// @notice What the manager could draw right now: idle liquidity, capped by utilisation.
    function availableToLend() public view returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 total = idle + lentFxrp;
        uint256 maxLent = (total * utilisationCapBps) / 10_000;
        if (lentFxrp >= maxLent) return 0;
        uint256 room = maxLent - lentFxrp;
        return room < idle ? room : idle;
    }

    /*
     * Withdrawals are honest about illiquidity: only idle FXRP can leave, and the junior buffer is not
     * LPs' to take. Advances cannot be recalled and the receivable has not arrived yet, so a `maxWithdraw`
     * that counted either would promise money the vault cannot produce.
     */
    function _idleForLPs() internal view returns (uint256) {
        uint256 balance = IERC20(asset()).balanceOf(address(this));
        return balance > juniorAssets ? balance - juniorAssets : 0;
    }

    function maxWithdraw(address owner_) public view override returns (uint256) {
        uint256 idle = _idleForLPs();
        uint256 fromShares = super.maxWithdraw(owner_);
        return fromShares < idle ? fromShares : idle;
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        uint256 idleAsShares = _convertToShares(_idleForLPs(), Math.Rounding.Floor);
        uint256 shares = super.maxRedeem(owner_);
        return shares < idleAsShares ? shares : idleAsShares;
    }

    // ---------------------------------------------------------------- the manager's side

    /**
     * @notice Send FXRP out for an advance. Only the manager, only within the utilisation cap.
     * @param recipient The borrower for the FXRP leg, or the manager itself for the FAssets redemption leg.
     */
    function lend(address recipient, uint256 fxrpAmount) external onlyManager {
        if (fxrpAmount == 0) revert ZeroAmount();

        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 total = idle + lentFxrp;
        uint256 lentAfter = lentFxrp + fxrpAmount;
        if (lentAfter * 10_000 > total * utilisationCapBps) {
            revert UtilisationCapExceeded(lentAfter, total, utilisationCapBps);
        }

        lentFxrp = lentAfter;
        IERC20(asset()).safeTransfer(recipient, fxrpAmount);
        emit Lent(recipient, fxrpAmount);
    }

    /**
     * @notice Record a repayment. The FXRP (if any) must already have been transferred in by the caller.
     * @param fxrpIn What actually arrived — zero for an XRPL-side repayment, whose value lands off-pool.
     * @param fxrpRetired How much of the lent principal this repayment retires.
     * @dev `fxrpIn > fxrpRetired` is yield; `fxrpIn < fxrpRetired` is FX drift or an off-pool settlement —
     * both flow straight into the share price, which is the point.
     */
    function onRepayment(uint256 fxrpIn, uint256 fxrpRetired) external onlyManager {
        uint256 retired = fxrpRetired > lentFxrp ? lentFxrp : fxrpRetired;
        lentFxrp -= retired;
        emit RepaymentReceived(fxrpIn, retired);
    }

    /// @notice Remove written-off principal from the books. The junior buffer absorbs first; only what it
    /// cannot cover reaches the share price — and both amounts are in the event, so nothing is smoothed.
    function onWriteOff(uint256 fxrpRetired) external onlyManager {
        uint256 retired = fxrpRetired > lentFxrp ? lentFxrp : fxrpRetired;
        lentFxrp -= retired;
        uint256 absorbed = _absorbIntoJunior(retired);
        emit WrittenOff(retired, absorbed);
    }

    /// @dev Consuming junior raises share-backed assets by the same amount the loss removed, so seniors
    /// are whole up to the buffer's depth. Returns what the buffer absorbed.
    function _absorbIntoJunior(uint256 loss) internal returns (uint256 absorbed) {
        absorbed = loss > juniorAssets ? juniorAssets : loss;
        juniorAssets -= absorbed;
    }

    /**
     * @notice Book an XRPL-side repayment: the debt is settled, the XRP is real, and it has not arrived
     * here yet. The received amount becomes a receivable counted in `totalAssets`, so the share price
     * states the claim instead of dipping and recovering.
     */
    function onXrplRepayment(uint256 receivableFxrp, uint256 fxrpRetired) external onlyManager {
        uint256 retired = fxrpRetired > lentFxrp ? lentFxrp : fxrpRetired;
        lentFxrp -= retired;
        xrplReceivableFxrp += receivableFxrp;
        emit XrplRepaymentBooked(receivableFxrp, retired);
    }

    /// @notice Deliver re-minted FXRP against the receivable. Callable by anyone — the ops bot, the owner,
    /// a well-wisher — because the pool only gets richer.
    function settleReceivable(uint256 fxrpAmount) external {
        if (fxrpAmount == 0) revert ZeroAmount();
        if (fxrpAmount > xrplReceivableFxrp) revert ExceedsReceivable(fxrpAmount, xrplReceivableFxrp);
        xrplReceivableFxrp -= fxrpAmount;
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), fxrpAmount);
        emit ReceivableSettled(msg.sender, fxrpAmount, xrplReceivableFxrp);
    }

    /// @notice Admit a receivable will not arrive. The junior buffer absorbs first, then the share price.
    function impairReceivable(uint256 fxrpAmount) external onlyOwner {
        if (fxrpAmount > xrplReceivableFxrp) revert ExceedsReceivable(fxrpAmount, xrplReceivableFxrp);
        xrplReceivableFxrp -= fxrpAmount;
        uint256 absorbed = _absorbIntoJunior(fxrpAmount);
        emit ReceivableImpaired(fxrpAmount, absorbed);
    }

    // ---------------------------------------------------------------- the junior tranche

    /// @notice Add first-loss capital. Anyone may deepen the buffer; only the owner may thin it.
    function fundJunior(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        juniorAssets += amount;
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
        emit JuniorFunded(amount, juniorAssets);
    }

    /// @notice Withdraw junior capital. Thinning the buffer weakens seniors' protection — the event says
    /// so in numbers, and the withdrawal is bounded by idle balance so it can never touch lent funds.
    function withdrawJunior(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        if (amount > juniorAssets) revert ExceedsJunior(amount, juniorAssets);
        uint256 balance = IERC20(asset()).balanceOf(address(this));
        if (amount > balance) revert ExceedsJunior(amount, balance);
        juniorAssets -= amount;
        IERC20(asset()).safeTransfer(msg.sender, amount);
        emit JuniorWithdrawn(amount, juniorAssets);
    }

    // ---------------------------------------------------------------- governance

    function setManager(address newManager) external onlyOwner {
        manager = newManager;
        emit ManagerSet(newManager);
    }

    function setUtilisationCap(uint16 newCapBps) external onlyOwner {
        if (newCapBps > 10_000) revert InvalidCap();
        utilisationCapBps = newCapBps;
        emit UtilisationCapSet(newCapBps);
    }

    /**
     * @dev Shares carry three extra decimals over the 6-decimal asset. The virtual-offset arithmetic this
     * buys makes the classic first-depositor share-price inflation attack economically pointless.
     */
    function _decimalsOffset() internal pure override returns (uint8) {
        return 3;
    }
}
