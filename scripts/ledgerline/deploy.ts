/**
 * Deploy Ledgerline to Coston2, wire up FAssets, and fund the treasury with whatever FXRP is on hand.
 *   yarn hardhat run scripts/ledgerline/deploy.ts --network coston2
 *
 * Env:
 *   ORACLE_ADDRESS   reuse an existing RevenueOracle instead of deploying a new one. Set this when only
 *                    AdvanceManager has changed — the proven revenue history lives in the oracle, and
 *                    redeploying it would throw away every period already attested on chain.
 *   XRPL_TREASURY_ADDRESS   the XRPL account borrowers repay to, enabling the XRPL repayment leg.
 */
import { ethers, run } from "hardhat";

const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7"; // FTestXRP on Coston2, 6 decimals
const ASSET_MANAGER = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";

/** FDC's source id for the XRP Ledger testnet. Production would be bytes32("XRP"). */
const XRPL_SOURCE_ID = ethers.encodeBytes32String("testXRP");

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

    /*
     * The oracle holds every period ever proven for every account. Redeploying it silently discards that
     * history, so reusing an existing one is the default whenever an address is supplied.
     */
    let oracleAddr = process.env.ORACLE_ADDRESS;
    if (oracleAddr) {
        console.log("RevenueOracle  :", oracleAddr, "(reused — history preserved)");
    } else {
        const Oracle = await ethers.getContractFactory("RevenueOracle");
        const oracle = await Oracle.deploy();
        await oracle.waitForDeployment();
        oracleAddr = await oracle.getAddress();
        console.log("RevenueOracle  :", oracleAddr, "(new)");
    }

    const Manager = await ethers.getContractFactory("AdvanceManager");
    const manager = await Manager.deploy(oracleAddr, FXRP);
    await manager.waitForDeployment();
    const managerAddr = await manager.getAddress();
    console.log("AdvanceManager :", managerAddr);

    await (await manager.setAssetManager(ASSET_MANAGER)).wait();

    // The XRPL account borrowers repay to. Without it, repayFromXrpl refuses to run at all.
    const xrplTreasury = process.env.XRPL_TREASURY_ADDRESS;
    if (xrplTreasury) {
        await (await manager.setXrplTreasury(xrplTreasury, XRPL_SOURCE_ID)).wait();
        console.log("XRPL treasury  :", xrplTreasury, "(testXRP)");
    } else {
        console.log("XRPL treasury  : unset — the XRPL repayment leg is unavailable");
    }
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
