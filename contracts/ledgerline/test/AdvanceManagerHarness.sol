// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { AdvanceManager } from "../AdvanceManager.sol";
import { IPayment } from "@flarenetwork/flare-periphery-contracts/coston2/IPayment.sol";

/**
 * @dev Test-only. Stubs the two things that only exist on a live Flare network: the FTSOv2 price read,
 * so a price move can be simulated, and FDC's Payment verification, so the XRPL repayment leg can be
 * tested without an attestation.
 */
contract AdvanceManagerHarness is AdvanceManager {
    uint256 private _price;
    int8 private _decimals;
    bool private _paymentVerifies = true;

    constructor(address oracleAddress, address fxrpAddress) AdvanceManager(oracleAddress, fxrpAddress) {}

    function setXrpUsd(uint256 price, int8 decimals) external {
        _price = price;
        _decimals = decimals;
    }

    function _xrpUsd() internal view override returns (uint256, int8) {
        return (_price, _decimals);
    }

    /// @dev Lets a test assert that a proof the network rejects is refused even when every field is right.
    function setPaymentVerifies(bool verifies) external {
        _paymentVerifies = verifies;
    }

    function _verifyPayment(IPayment.Proof calldata) internal view override returns (bool) {
        return _paymentVerifies;
    }
}
