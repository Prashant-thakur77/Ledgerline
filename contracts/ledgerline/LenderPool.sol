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

    /// @notice Lending stops when lent/total would exceed this, so withdrawals stay possible.
    uint16 public utilisationCapBps = 8_000; // 80%

    event ManagerSet(address manager);
    event UtilisationCapSet(uint16 capBps);
    event Lent(address indexed recipient, uint256 fxrpAmount);
    event RepaymentReceived(uint256 fxrpIn, uint256 fxrpRetired);
    event WrittenOff(uint256 fxrpRetired);

    error NotManager(address caller);
    error UtilisationCapExceeded(uint256 lentAfter, uint256 totalAfter, uint16 capBps);
    error InvalidCap();
    error ZeroAmount();

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

    /// @notice Idle FXRP plus everything currently out in advances.
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + lentFxrp;
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
     * Withdrawals are honest about illiquidity: only idle FXRP can leave. Advances cannot be recalled, so
     * a `maxWithdraw` that counted them would promise money the vault cannot produce.
     */
    function maxWithdraw(address owner_) public view override returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        uint256 fromShares = super.maxWithdraw(owner_);
        return fromShares < idle ? fromShares : idle;
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        uint256 idleAsShares = _convertToShares(IERC20(asset()).balanceOf(address(this)), Math.Rounding.Floor);
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

    /// @notice Remove written-off principal from the books. The share price takes the loss, visibly.
    function onWriteOff(uint256 fxrpRetired) external onlyManager {
        uint256 retired = fxrpRetired > lentFxrp ? lentFxrp : fxrpRetired;
        lentFxrp -= retired;
        emit WrittenOff(retired);
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
