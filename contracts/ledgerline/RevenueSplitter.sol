// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { RevenueOracle } from "./RevenueOracle.sol";
import { AdvanceManager } from "./AdvanceManager.sol";

/**
 * @title RevenueSplitter
 * @notice Deduction at source, without being the processor.
 *
 * The platform lenders' entire loss advantage — Shopify Capital, Stripe Capital, Square Loans — is that
 * repayment is netted out of each settlement before the merchant ever holds the money. A merchant cannot
 * miss a payment they never possessed. This contract is that mechanism one hop downstream: the merchant
 * routes revenue here instead of to their own wallet, and every settlement splits atomically — the agreed
 * share to the debt, the remainder forwarded on, in the same transaction. The one-day delay that makes
 * real-world lockboxes hated does not exist, because there is no banking day.
 *
 * The springing clause is the on-chain DACA: while the account is delinquent or behind its repayment
 * floor, the split becomes 100% withholding. Not acceleration — the balance never grows, no maturity is
 * invoked — the revenue stream simply pays the obligation first until the account cures. That is the
 * strongest response a purchase of receivables can make while remaining a purchase.
 *
 * Enrolment is the account owner's own act, and the split share is fixed at enrolment: this contract can
 * never take more than the merchant agreed to, except by the springing rule they also agreed to.
 */
contract RevenueSplitter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Route {
        /// @notice Where the merchant's remainder goes.
        address payout;
        /// @notice The share of each settlement that services the debt, in basis points.
        uint16 shareBps;
        bool enrolled;
    }

    RevenueOracle public immutable oracle;
    AdvanceManager public immutable manager;
    IERC20 public immutable fxrp;

    mapping(bytes32 => Route) public routes;
    /// @notice FXRP received per account and not yet settled. Anyone may trigger settlement.
    mapping(bytes32 => uint256) public pendingFxrp;

    event Enrolled(bytes32 indexed accountId, address payout, uint16 shareBps);
    event Unenrolled(bytes32 indexed accountId);
    event RevenueReceived(bytes32 indexed accountId, address indexed from, uint256 fxrpAmount);
    event Settled(
        bytes32 indexed accountId,
        uint256 fxrpToDebt,
        uint256 fxrpToMerchant,
        bool sprung
    );

    error NotAccountOwner(address owner, address caller);
    error NotEnrolled(bytes32 accountId);
    error InvalidShare();
    error ZeroAmount();
    error ZeroAddress();
    error DebtStillOpen();

    constructor(address oracleAddress, address managerAddress, address fxrpAddress) {
        oracle = RevenueOracle(oracleAddress);
        manager = AdvanceManager(managerAddress);
        fxrp = IERC20(fxrpAddress);
    }

    // ---------------------------------------------------------------- enrolment

    /**
     * @notice Route this account's revenue through the splitter. Only the bound owner, and the share is
     * capped at half — a split that leaves the merchant nothing by default is a seizure, not a service.
     * The springing rule is the only path to more, and it requires the merchant to already be behind.
     */
    function enroll(bytes32 accountId, address payout, uint16 shareBps) external {
        address owner = oracle.accountOwner(accountId);
        if (owner != msg.sender) revert NotAccountOwner(owner, msg.sender);
        if (payout == address(0)) revert ZeroAddress();
        if (shareBps == 0 || shareBps > 5_000) revert InvalidShare();

        routes[accountId] = Route({ payout: payout, shareBps: shareBps, enrolled: true });
        emit Enrolled(accountId, payout, shareBps);
    }

    /// @notice Leave, once nothing is owed. An enrolled route with an open advance is the collateral.
    function unenroll(bytes32 accountId) external {
        address owner = oracle.accountOwner(accountId);
        if (owner != msg.sender) revert NotAccountOwner(owner, msg.sender);
        if (manager.hasOpenAdvance(accountId)) revert DebtStillOpen();

        // Whatever sits unsettled leaves with the merchant; it was always theirs less the split.
        uint256 pending = pendingFxrp[accountId];
        if (pending > 0) {
            pendingFxrp[accountId] = 0;
            fxrp.safeTransfer(routes[accountId].payout, pending);
        }
        delete routes[accountId];
        emit Unenrolled(accountId);
    }

    // ---------------------------------------------------------------- the money path

    /**
     * @notice Deliver revenue for an account. Called by whoever moves the merchant's settlement — the
     * merchant themselves, an ops bot converting XRPL receipts, or a payer paying the merchant directly
     * through the lockbox.
     */
    function deposit(bytes32 accountId, uint256 fxrpAmount) external nonReentrant {
        if (fxrpAmount == 0) revert ZeroAmount();
        if (!routes[accountId].enrolled) revert NotEnrolled(accountId);

        pendingFxrp[accountId] += fxrpAmount;
        fxrp.safeTransferFrom(msg.sender, address(this), fxrpAmount);
        emit RevenueReceived(accountId, msg.sender, fxrpAmount);
    }

    /**
     * @notice Split everything pending: the share to the debt, the rest to the merchant. Permissionless —
     * settlement only ever moves money where the enrolment already said it goes.
     *
     * The springing rule: delinquent or behind the repayment floor, the whole settlement services the
     * debt. With no open advance at all, everything forwards to the merchant — the splitter takes nothing
     * it has no claim on.
     */
    function settle(bytes32 accountId) external nonReentrant {
        Route memory route = routes[accountId];
        if (!route.enrolled) revert NotEnrolled(accountId);
        uint256 pending = pendingFxrp[accountId];
        if (pending == 0) revert ZeroAmount();
        pendingFxrp[accountId] = 0;

        bool hasDebt = manager.hasOpenAdvance(accountId);
        bool sprung = hasDebt && (manager.floorBreached(accountId) || _isDelinquent(accountId));

        uint256 toDebt;
        if (hasDebt) {
            toDebt = sprung ? pending : (pending * route.shareBps) / 10_000;
        }

        if (toDebt > 0) {
            fxrp.forceApprove(address(manager), toDebt);
            manager.repayFxrpFor(accountId, toDebt);
        }

        uint256 toMerchant = pending - toDebt;
        if (toMerchant > 0) {
            fxrp.safeTransfer(route.payout, toMerchant);
        }

        emit Settled(accountId, toDebt, toMerchant, sprung);
    }

    function _isDelinquent(bytes32 accountId) internal view returns (bool) {
        return manager.advanceOf(accountId).delinquent;
    }
}
