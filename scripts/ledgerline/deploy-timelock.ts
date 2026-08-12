/**
 * Put the underwriting policy behind a timelock.
 *
 * Deploys GovernanceTimelock (1 hour on Coston2, demo-scale; production would carry days) with the
 * deployer as sole proposer and executor, then hands it ownership of AdvanceManager and LenderPool.
 * From this transaction on, every policy change waits in public before it lands.
 *
 *   MANAGER_ADDRESS=0x… POOL_ADDRESS=0x… npx hardhat run scripts/ledgerline/deploy-timelock.ts --network coston2
 */
import { ethers, run } from "hardhat";

const MANAGER = process.env.MANAGER_ADDRESS ?? "0x24f2c925679e737174103A5F6715b766E3D5D602";
const POOL = process.env.POOL_ADDRESS ?? "0x38560eE630071846158F639a217E6a0fB2d66Fe2";
const DELAY = Number(process.env.TIMELOCK_DELAY ?? 3600);

async function main() {
    const [deployer] = await ethers.getSigners();

    const Timelock = await ethers.getContractFactory("GovernanceTimelock");
    const timelock = await Timelock.deploy(DELAY, [deployer.address], [deployer.address]);
    await timelock.waitForDeployment();
    const timelockAddr = await timelock.getAddress();
    console.log("GovernanceTimelock:", timelockAddr, `(delay ${DELAY}s)`);

    const manager = await ethers.getContractAt("AdvanceManager", MANAGER);
    await (await manager.transferOwnership(timelockAddr)).wait();
    console.log("AdvanceManager owner ->", await manager.owner());

    const pool = await ethers.getContractAt("LenderPool", POOL);
    await (await pool.transferOwnership(timelockAddr)).wait();
    console.log("LenderPool owner     ->", await pool.owner());

    try {
        await run("verify:verify", { address: timelockAddr, constructorArguments: [DELAY, [deployer.address], [deployer.address]] });
    } catch (e) {
        console.log("verify:", String(e).slice(0, 120));
    }
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
