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
    /// @dev Seconds to subtract from `block.timestamp` when reporting the feed's age, so the staleness
    /// guard can be exercised without waiting. Zero means "the price was published this block".
    uint64 private _priceAge;
    uint64 private _priceTimestamp;

    constructor(address oracleAddress, address fxrpAddress) AdvanceManager(oracleAddress, fxrpAddress) {}

    function setXrpUsd(uint256 price, int8 decimals) external {
        _price = price;
        _decimals = decimals;
    }

    /// @dev Age the feed artificially. `setPriceAge(2 hours)` makes the next read look two hours old.
    function setPriceAge(uint64 age) external {
        _priceAge = age;
    }

    /// @dev Report an exact feed timestamp, so a clock ahead of the block can be tested too. Zero clears.
    function setPriceTimestamp(uint64 timestamp) external {
        _priceTimestamp = timestamp;
    }

    function _xrpUsd() internal view override returns (uint256, int8, uint64) {
        if (_priceTimestamp != 0) return (_price, _decimals, _priceTimestamp);
        return (_price, _decimals, uint64(block.timestamp) - _priceAge);
    }

    /// @dev Lets a test assert that a proof the network rejects is refused even when every field is right.
    function setPaymentVerifies(bool verifies) external {
        _paymentVerifies = verifies;
    }

    function _verifyPayment(IPayment.Proof calldata) internal view override returns (bool) {
        return _paymentVerifies;
    }
}
