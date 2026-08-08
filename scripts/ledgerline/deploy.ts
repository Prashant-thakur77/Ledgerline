// Deploy Ledgerline to Coston2 and fund the treasury.
//   yarn hardhat run scripts/ledgerline/deploy.ts --network coston2
import { ethers, run } from "hardhat";

const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7"; // FTestXRP on Coston2, 6 decimals
const TREASURY_FXRP = "5"; // of the 10 the faucet gives, leave half for repayments

async function verify(address: string, args: any[]) {
    try {
        await run("verify:verify", { address, constructorArguments: args });
        console.log("  verified");
    } catch (e: any) {
        console.log("  verify skipped:", e.message.split("\n")[0]);
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

    // Prove the production FTSO path works, not just the stubbed one in tests.
    const [price, decimals] = await manager.currentXrpUsd.staticCall();
    console.log(`\nLive XRP/USD from FTSOv2: ${Number(price) / 10 ** Number(decimals)} (raw ${price}, decimals ${decimals})`);

    const fxrp = await ethers.getContractAt(
        ["function approve(address,uint256) returns (bool)", "function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"],
        FXRP
    );
    const dec = await fxrp.decimals();
    const amount = ethers.parseUnits(TREASURY_FXRP, dec);
    console.log(`\nFunding treasury with ${TREASURY_FXRP} FXRP...`);
    await (await fxrp.approve(managerAddr, amount)).wait();
    await (await manager.depositTreasury(amount)).wait();
    console.log("Treasury balance:", ethers.formatUnits(await manager.treasuryBalance(), dec), "FXRP");

    console.log("\nVerifying on the explorer...");
    await verify(oracleAddr, []);
    await verify(managerAddr, [oracleAddr, FXRP]);

    console.log("\n--- deployed ---");
    console.log("RevenueOracle :", oracleAddr);
    console.log("AdvanceManager:", managerAddr);
    console.log("FXRP          :", FXRP);
}

void main().then(() => process.exit(0));
