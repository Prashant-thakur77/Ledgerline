/** Repay the balance and reclaim the rolling reserve: the clean-close release, live. */
import { ethers } from "hardhat";

const ORACLE = "0x4516155F9069205C6EC982214528a62973477767";
const MANAGER = "0x1187B737EFef8C1D2563C0001553Bf6E7afe25af";
const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7";

async function main() {
    const [signer] = await ethers.getSigners();
    const oracle = await ethers.getContractAt("RevenueOracle", ORACLE);
    const manager = await ethers.getContractAt("AdvanceManager", MANAGER);
    const fxrp = await ethers.getContractAt(
        ["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"],
        FXRP
    );

    const accountId = await oracle.accountIdFor("stripe", "acct_1U2HbaRh1zuX9OfD");
    const owed = (await manager.advanceOf(accountId)).outstandingCents;
    console.log("outstanding:", `$${Number(owed) / 100}`);


    await (await fxrp.approve(MANAGER, 100_000_000n)).wait();
    let tx = await manager.repay(accountId, owed, { gasLimit: 2_000_000 });
    await tx.wait();
    console.log("repaid in full       :", tx.hash);

    const before = await fxrp.balanceOf(signer.address);
    tx = await manager.releaseReserve(accountId, { gasLimit: 1_000_000 });
    await tx.wait();
    const got = (await fxrp.balanceOf(signer.address)) - before;
    console.log("reserve released     :", tx.hash);
    console.log("returned to borrower :", ethers.formatUnits(got, 6), "FXRP");
    console.log("clean cycles now     :", (await manager.closedCleanCycles(accountId)).toString());
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
