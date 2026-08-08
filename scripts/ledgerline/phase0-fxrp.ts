// Phase 0.4 — resolve the FXRP token on Coston2 and read our balance.
//   yarn hardhat run scripts/ledgerline/phase0-fxrp.ts --network coston2
import { ethers } from "hardhat";
import { getAssetManagerFXRP } from "../utils/getters";

async function main() {
    const assetManager = await getAssetManagerFXRP();
    const fAsset: string = await assetManager.fAsset();
    console.log("AssetManager (FXRP) :", assetManager.address ?? (await assetManager.getAddress?.()));
    console.log("FXRP token          :", fAsset);

    const [signer] = await ethers.getSigners();
    const erc20 = await ethers.getContractAt(
        [
            "function balanceOf(address) view returns (uint256)",
            "function decimals() view returns (uint8)",
            "function symbol() view returns (string)",
        ],
        fAsset
    );
    const [bal, dec, sym] = await Promise.all([
        erc20.balanceOf(signer.address),
        erc20.decimals(),
        erc20.symbol(),
    ]);
    console.log("Holder              :", signer.address);
    console.log("Symbol / decimals   :", sym, "/", dec);
    console.log("Balance             :", ethers.formatUnits(bal, dec), sym, `(raw ${bal})`);
}

void main().then(() => process.exit(0));
