// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title GovernanceTimelock
 * @notice The owner of AdvanceManager and LenderPool: every policy change waits in public first.
 *
 * The tier schedule, the fees, the terms and the write-off pen are the underwriting policy, and a policy
 * that can change silently is not a policy. Behind this contract, every owner action is proposed on chain,
 * waits out the delay in full view, and only then executes — so borrowers and LPs see changes coming
 * instead of discovering them.
 *
 * The delay is demo-scale on Coston2 (an hour) so the mechanism is demonstrable within the hackathon;
 * production would carry days. Changing the delay itself also goes through the timelock.
 */
contract GovernanceTimelock is TimelockController {
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors
    ) TimelockController(minDelay, proposers, executors, address(0)) {}
}
