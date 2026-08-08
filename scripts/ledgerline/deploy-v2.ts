/**
 * Redeploy AdvanceManager with the XRPL disbursement leg, moving the treasury across.
 *   yarn hardhat run scripts/ledgerline/deploy-v2.ts --network coston2
 *
 * RevenueOracle is unchanged and is reused, so every period already proven stays proven and every
 * account stays bound to its wallet.
 */
import { ethers, run } from "hardhat";

const ORACLE = "0x47C6d20206AbD9413d345d45c65aB8a074Ca28a8";
const OLD_MANAGER = "0x5774E51335277893c5f177bb6735b4CF2fE76A63";
const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7";
const ASSET_MANAGER = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";

async function main() {
    const [signer] = await ethers.getSigners();
    const fxrp = await ethers.getContractAt(
        [
            "function balanceOf(address) view returns (uint256)",
            "function approve(address,uint256) returns (bool)",
            "function decimals() view returns (uint8)",
        ],
        FXRP
    );
    const dec = await fxrp.decimals();

    const old = await ethers.getContractAt("AdvanceManager", OLD_MANAGER);
    const stranded = await old.treasuryBalance();
    if (stranded > 0n) {
        console.log(`Withdrawing ${ethers.formatUnits(stranded, dec)} FXRP from the old treasury...`);
        await (await old.withdrawTreasury(stranded)).wait();
    }

    const Manager = await ethers.getContractFactory("AdvanceManager");
    const manager = await Manager.deploy(ORACLE, FXRP);
    await manager.waitForDeployment();
    const addr = await manager.getAddress();
    console.log("AdvanceManager (v2):", addr);

    await (await manager.setAssetManager(ASSET_MANAGER)).wait();
    const lot = await manager.lotSize();
    console.log("Asset manager set. Lot size:", ethers.formatUnits(lot, dec), "XRP");

    const balance = await fxrp.balanceOf(signer.address);
    console.log(`\nDepositing all ${ethers.formatUnits(balance, dec)} FXRP into the treasury...`);
    await (await fxrp.approve(addr, balance)).wait();
    await (await manager.depositTreasury(balance)).wait();
    console.log("Treasury:", ethers.formatUnits(await manager.treasuryBalance(), dec), "FXRP");
    console.log("Lots available:", (await manager.treasuryBalance()) / lot);

    try {
        await run("verify:verify", { address: addr, constructorArguments: [ORACLE, FXRP] });
        console.log("verified");
    } catch (e: any) {
        console.log("verify:", e.message.split("\n")[0]);
    }

    console.log("\nMANAGER_ADDRESS=" + addr);
}

void main().then(() => process.exit(0));
