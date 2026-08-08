/**
 * Deploy Ledgerline to Coston2, wire up FAssets, and fund the treasury with whatever FXRP is on hand.
 *   yarn hardhat run scripts/ledgerline/deploy.ts --network coston2
 */
import { ethers, run } from "hardhat";

const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7"; // FTestXRP on Coston2, 6 decimals
const ASSET_MANAGER = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";

async function verify(address: string, args: any[]) {
    try {
        await run("verify:verify", { address, constructorArguments: args });
        console.log("  verified");
    } catch (e: any) {
        console.log("  verify:", e.message.split("\n")[0]);
    }
}

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    console.log("Balance :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "C2FLR\n");

    const Oracle = await ethers.getContractFactory("RevenueOracle");
    const oracle = await Oracle.deploy();
    await oracle.waitForDeployment();
    const oracleAddr = await oracle.getAddress();
    console.log("RevenueOracle  :", oracleAddr);

    const Manager = await ethers.getContractFactory("AdvanceManager");
    const manager = await Manager.deploy(oracleAddr, FXRP);
    await manager.waitForDeployment();
    const managerAddr = await manager.getAddress();
    console.log("AdvanceManager :", managerAddr);

    await (await manager.setAssetManager(ASSET_MANAGER)).wait();
    const fxrp = await ethers.getContractAt(
        [
            "function approve(address,uint256) returns (bool)",
            "function decimals() view returns (uint8)",
            "function balanceOf(address) view returns (uint256)",
        ],
        FXRP
    );
    const dec = await fxrp.decimals();
    console.log("Lot size       :", ethers.formatUnits(await manager.lotSize(), dec), "XRP");

    const [price, priceDec] = await manager.currentXrpUsd.staticCall();
    console.log("XRP/USD        : $" + Number(price) / 10 ** Number(priceDec));

    const balance = await fxrp.balanceOf(deployer.address);
    if (balance > 0n) {
        console.log(`\nFunding treasury with ${ethers.formatUnits(balance, dec)} FXRP...`);
        await (await fxrp.approve(managerAddr, balance)).wait();
        await (await manager.depositTreasury(balance)).wait();
        console.log("Treasury:", ethers.formatUnits(await manager.treasuryBalance(), dec), "FXRP");
    } else {
        console.log("\nNo FXRP held — treasury left empty. Claim from the faucet, then run fund-treasury.ts.");
    }

    console.log("\nVerifying on the explorer...");
    await verify(oracleAddr, []);
    await verify(managerAddr, [oracleAddr, FXRP]);

    console.log("\n--- deployed ---");
    console.log("ORACLE_ADDRESS=" + oracleAddr);
    console.log("MANAGER_ADDRESS=" + managerAddr);
}

void main().then(() => process.exit(0));
