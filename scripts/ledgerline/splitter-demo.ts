/**
 * The deduction-at-source loop, live: enroll, deliver a settlement, watch it split.
 */
import { ethers } from "hardhat";

const ORACLE = "0x4516155F9069205C6EC982214528a62973477767";
const MANAGER = "0x1187B737EFef8C1D2563C0001553Bf6E7afe25af";
const SPLITTER = "0xf7982B48D4005F2aa5b2d7AE030996D1d19eD727";
const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7";

async function main() {
    const [signer] = await ethers.getSigners();
    const oracle = await ethers.getContractAt("RevenueOracle", ORACLE);
    const manager = await ethers.getContractAt("AdvanceManager", MANAGER);
    const splitter = await ethers.getContractAt("RevenueSplitter", SPLITTER);
    const fxrp = await ethers.getContractAt(
        ["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"],
        FXRP
    );

    const accountId = await oracle.accountIdFor("stripe", "acct_1U2HbaRh1zuX9OfD");

    // 1. The merchant (us) routes revenue through the lockbox: 20% of each settlement services the debt.
    let tx = await splitter.enroll(accountId, signer.address, 2_000);
    await tx.wait();
    console.log("enrolled at 20%      :", tx.hash);

    // 2. A settlement arrives: 2 FXRP of revenue, delivered to the splitter.
    tx = await fxrp.approve(SPLITTER, 2_000_000n);
    await tx.wait();
    tx = await splitter.deposit(accountId, 2_000_000n);
    await tx.wait();
    console.log("2 FXRP delivered     :", tx.hash);

    // 3. Anyone settles: the split happens atomically.
    const before = (await manager.advanceOf(accountId)).outstandingCents;
    tx = await splitter.settle(accountId);
    await tx.wait();
    const after = (await manager.advanceOf(accountId)).outstandingCents;
    console.log("settled              :", tx.hash);
    console.log(`debt: $${Number(before) / 100} -> $${Number(after) / 100} (the 20% split, at the FTSO rate)`);
    console.log("reserve still held   :", ethers.formatUnits(await manager.reserveFxrp(accountId), 6), "FXRP");
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
