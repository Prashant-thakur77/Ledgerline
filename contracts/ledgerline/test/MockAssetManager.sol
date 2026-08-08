// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @dev Test-only stand-in for the FAssets AssetManager.
 *
 * The real one burns the redeemer's FXRP and hands the redemption to an agent, who then pays XRP on the XRP
 * Ledger. None of that can happen on a local node, so this records what it was asked to redeem and takes the
 * FXRP, which is enough to test everything on the Flare side of the boundary. The agent actually paying is
 * verified on Coston2 instead, in scripts/ledgerline/advance-to-xrpl.ts.
 */
contract MockAssetManager {
    IERC20 public immutable fasset;
    uint256 public immutable lot;

    uint256 public lastLots;
    string public lastUnderlyingAddress;

    constructor(address _fasset, uint256 _lot) {
        fasset = IERC20(_fasset);
        lot = _lot;
    }

    function lotSize() external view returns (uint256) {
        return lot;
    }

    function redeem(
        uint256 _lots,
        string memory _redeemerUnderlyingAddressString,
        address payable
    ) external payable returns (uint256) {
        lastLots = _lots;
        lastUnderlyingAddress = _redeemerUnderlyingAddressString;
        uint256 amount = _lots * lot;
        fasset.transferFrom(msg.sender, address(this), amount);
        return amount;
    }
}
