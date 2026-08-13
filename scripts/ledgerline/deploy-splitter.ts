import { ethers, run } from "hardhat";

const ORACLE = "0x4516155F9069205C6EC982214528a62973477767";
const MANAGER = "0x1187B737EFef8C1D2563C0001553Bf6E7afe25af";
const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7";

async function main() {
    const Splitter = await ethers.getContractFactory("RevenueSplitter");
    const splitter = await Splitter.deploy(ORACLE, MANAGER, FXRP);
    await splitter.waitForDeployment();
    const addr = await splitter.getAddress();
    console.log("RevenueSplitter:", addr);
    try {
        await run("verify:verify", { address: addr, constructorArguments: [ORACLE, MANAGER, FXRP] });
        console.log("verified");
    } catch (e) { console.log("verify:", String(e).slice(0, 100)); }

    // Move liquidity: withdraw everything ours from the V4 pool, deposit into V5.
    const [signer] = await ethers.getSigners();
    const v4 = await ethers.getContractAt("LenderPool", "0x38560eE630071846158F639a217E6a0fB2d66Fe2");
    const max = await v4.maxWithdraw(signer.address);
    console.log("V4 withdrawable:", ethers.formatUnits(max, 6), "FXRP");
    if (max > 0n) await (await v4.withdraw(max, signer.address, signer.address)).wait();

    const fxrp = await ethers.getContractAt(
        ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"], FXRP);
    const bal = await fxrp.balanceOf(signer.address);
    console.log("deployer FXRP:", ethers.formatUnits(bal, 6));

    const v5 = await ethers.getContractAt("LenderPool", "0x85Ad3AcE968Ca06a8f08C928993e4A4D9a5B8296");
    await (await fxrp.approve(await v5.getAddress(), bal)).wait();
    await (await v5.deposit(bal, signer.address)).wait();
    console.log("V5 pool totalAssets:", ethers.formatUnits(await v5.totalAssets(), 6), "FXRP");

    // The guardian: instant pause, timelock-only unpause. Deployer for the demo.
    const manager = await ethers.getContractAt("AdvanceManager", MANAGER);
    await (await manager.setGuardian(signer.address)).wait();
    console.log("guardian set:", signer.address);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
