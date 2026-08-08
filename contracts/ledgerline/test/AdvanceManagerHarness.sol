// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { AdvanceManager } from "../AdvanceManager.sol";

/// @dev Test-only. Replaces the FTSOv2 read with a settable price so a price move can be simulated.
contract AdvanceManagerHarness is AdvanceManager {
    uint256 private _price;
    int8 private _decimals;

    constructor(address oracleAddress, address fxrpAddress) AdvanceManager(oracleAddress, fxrpAddress) {}

    function setXrpUsd(uint256 price, int8 decimals) external {
        _price = price;
        _decimals = decimals;
    }

    function _xrpUsd() internal view override returns (uint256, int8) {
        return (_price, _decimals);
    }
}
