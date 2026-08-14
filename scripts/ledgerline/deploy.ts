/**
 * Deploy Ledgerline V2 to Coston2: oracle, manager, and the lender pool, wired together.
 *   npx hardhat run scripts/ledgerline/deploy.ts --network coston2
 *
 * Env:
 *   ORACLE_ADDRESS   reuse an existing RevenueOracle instead of deploying. Only valid if that oracle
 *                    already has the V2 surface (accountCreatedAt) — the manager reads it.
 *   XRPL_TREASURY_ADDRESS   the XRPL account borrowers repay to, enabling the XRPL repayment leg.
 *   FLAT_FACTOR=1    demo mode: pin the flat 1.0x factor schedule instead of the production tiers.
 */
import { ethers, run } from "hardhat";

const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7"; // FTestXRP on Coston2, 6 decimals
const ASSET_MANAGER = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";

/** FDC's source id for the XRP Ledger testnet. Production would be bytes32("XRP"). */
const XRPL_SOURCE_ID = ethers.encodeBytes32String("testXRP");

async function verify(address: string, args: unknown[]) {
    try {
        await run("verify:verify", { address, constructorArguments: args });
        console.log("  verified");
    } catch (e) {
        console.log("  verify:", (e as Error).message.split("\n")[0]);
    }
}

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    console.log("Balance :", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "C2FLR\n");

    /*
     * The oracle holds every period ever proven. Reuse preserves that history — but only a V2 oracle can
     * be reused, because the manager reads accountCreatedAt from it.
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

    const Pool = await ethers.getContractFactory("LenderPool");
    const pool = await Pool.deploy(FXRP);
    await pool.waitForDeployment();
    const poolAddr = await pool.getAddress();
    console.log("LenderPool     :", poolAddr);

    await (await pool.setManager(managerAddr)).wait();
    await (await manager.setPool(poolAddr)).wait();
    await (await manager.setAssetManager(ASSET_MANAGER)).wait();

    // V3 economics: +8pts of factor per proven month, and a 4% risk premium at tier 0 melting to
    // zero at the cap — expected loss priced, not hoped away.
    await (await manager.setRiskTerms(800, 400)).wait();
    console.log("Risk terms     : historyStep 800 bps, riskPremium 400 bps");

    // V6 economics ship as contract defaults; read them back so the deploy record names them.
    console.log(
        "Fee split      : junior " + (await manager.juniorFeeBps()) + " bps, keeper " +
        (await manager.keeperFeeBps()) + " bps of each repayment's fee slice, senior the rest"
    );
    console.log(
        "Refund covenant: warn " + (await manager.refundWarnBps()) + " bps (share steps up by half), freeze " +
        (await manager.refundFreezeBps()) + " bps (no origination until a cleaner month)"
    );

    const xrplTreasury = process.env.XRPL_TREASURY_ADDRESS;
    if (xrplTreasury) {
        await (await manager.setXrplTreasury(xrplTreasury, XRPL_SOURCE_ID)).wait();
        console.log("XRPL treasury  :", xrplTreasury, "(testXRP)");
    } else {
        console.log("XRPL treasury  : unset — the XRPL repayment leg is unavailable");
    }

    if (process.env.FLAT_FACTOR === "1") {
        await (await manager.setFactorSchedule(10_000, 0, 10_000, 0)).wait();
        console.log("Factor         : flat 1.0x (demo mode)");
    } else {
        console.log("Factor         : tiered — 2.5% base, +20pts/clean cycle, 1.0x cap, 30d age gate");
    }

    const [price, priceDec] = await manager.currentXrpUsd.staticCall();
    console.log("XRP/USD        : $" + Number(price) / 10 ** Number(priceDec));
    console.log("Lot size       :", ethers.formatUnits(await manager.lotSize(), 6), "XRP");

    console.log("\nVerifying on the explorer...");
    await verify(oracleAddr, []);
    await verify(managerAddr, [oracleAddr, FXRP]);
    await verify(poolAddr, [FXRP]);

    console.log("\nFund the pool as the first LP:");
    console.log("  approve FXRP to the pool, then pool.deposit(amount, you)");
    console.log("  or: POOL_ADDRESS=" + poolAddr + " npx hardhat run scripts/ledgerline/fund-pool.ts --network coston2");

    console.log("\n--- deployed ---");
    console.log("ORACLE_ADDRESS=" + oracleAddr);
    console.log("MANAGER_ADDRESS=" + managerAddr);
    console.log("POOL_ADDRESS=" + poolAddr);
}

void main().then(() => process.exit(0));
