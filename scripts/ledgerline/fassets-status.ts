// Where is our FXRP, and can anyone actually redeem it?
//   yarn hardhat run scripts/ledgerline/fassets-status.ts --network coston2
import { ethers } from "hardhat";
import { getAssetManagerFXRP } from "../utils/getters";

const MANAGER = "0x1187B737EFef8C1D2563C0001553Bf6E7afe25af";
const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7";

async function main() {
    const [signer] = await ethers.getSigners();
    const fxrp = await ethers.getContractAt(
        ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"],
        FXRP
    );
    const dec = await fxrp.decimals();
    const manager = await ethers.getContractAt("AdvanceManager", MANAGER);

    const wallet = await fxrp.balanceOf(signer.address);
    const treasury = await manager.treasuryBalance();
    console.log("Wallet FXRP    :", ethers.formatUnits(wallet, dec));
    console.log("Treasury FXRP  :", ethers.formatUnits(treasury, dec));
    console.log("Total          :", ethers.formatUnits(wallet + treasury, dec));

    const assetManager = await getAssetManagerFXRP();
    const settings = await assetManager.getSettings();
    const lotSize = BigInt(settings.lotSizeAMG) * BigInt(settings.assetMintingGranularityUBA);
    console.log("\nLot size       :", ethers.formatUnits(lotSize, dec), "XRP");
    console.log("Lots we could redeem in total:", (wallet + treasury) / lotSize);

    const result = await assetManager.getAvailableAgentsDetailedList(0, 20);
    const agents = result[0] ?? result;
    console.log(`\n${agents.length} available agent(s):`);
    for (const a of agents) {
        console.log(
            `  vault=${a[0]}  freeLots=${a[3]}  feeBIPS=${a[4]}  redeemable=${a[3] > 0n ? "yes" : "no"}`
        );
    }

    // Redemption pulls from the redemption queue rather than from the available-agents list.
    const queue = await assetManager.redemptionQueue(0, 10);
    console.log(`\nRedemption queue has ${(queue[0] ?? queue).length} ticket(s)`);
    for (const t of queue[0] ?? queue) {
        console.log(`  ticketId=${t[0]}  agent=${t[1]}  valueUBA=${ethers.formatUnits(t[2], dec)} XRP`);
    }
}

void main().then(() => process.exit(0));
