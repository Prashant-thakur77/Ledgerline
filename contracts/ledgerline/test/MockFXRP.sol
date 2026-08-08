// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only stand-in for FXRP. Mirrors the real token's 6 decimals, which is the point of it existing.
contract MockFXRP is ERC20 {
    constructor() ERC20("Mock FTestXRP", "FXRP") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
