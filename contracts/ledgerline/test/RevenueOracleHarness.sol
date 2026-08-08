// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { RevenueOracle } from "../RevenueOracle.sol";
import { IWeb2Json } from "@flarenetwork/flare-periphery-contracts/coston2/IWeb2Json.sol";

/**
 * @dev Test-only. Flare's verification contract is reachable through ContractRegistry on Coston2 but not on
 * a local Hardhat node, so this stubs the one call and leaves every guard in RevenueOracle under test.
 * That the real verifier accepts a real proof was proven on chain in Phase 0.1, not here.
 */
contract RevenueOracleHarness is RevenueOracle {
    bool public proofValid = true;

    function setProofValid(bool value) external {
        proofValid = value;
    }

    function _verifyProof(IWeb2Json.Proof calldata) internal view override returns (bool) {
        return proofValid;
    }
}
