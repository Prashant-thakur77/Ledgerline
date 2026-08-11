/**
 * Take the agreed share of the newest attested period as repayment.
 *   PLATFORM=stripe ACCOUNT_REF=acct_… yarn hardhat run scripts/ledgerline/apply-repayment.ts --network coston2
 */
import { ethers } from "hardhat";

const ORACLE = process.env.ORACLE_ADDRESS ?? "0x80D08369E1a34e8c7C43FCF947323e56e6B87Be6";
const MANAGER = process.env.MANAGER_ADDRESS ?? "0x63fC5a5c422D40DcC8FA267384BA5351d8698A58";
const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7";

const PLATFORM = process.env.PLATFORM ?? "stripe";
const ACCOUNT_REF = process.env.ACCOUNT_REF ?? "acct_1U2HbaRh1zuX9OfD";

async function main() {
    const [signer] = await ethers.getSigners();
    const oracle = await ethers.getContractAt("RevenueOracle", ORACLE);
    const manager = await ethers.getContractAt("AdvanceManager", MANAGER);
    const fxrp = await ethers.getContractAt(
        [
            "function approve(address,uint256) returns (bool)",
            "function allowance(address,address) view returns (uint256)",
            "function balanceOf(address) view returns (uint256)",
            "function decimals() view returns (uint8)",
        ],
        FXRP
    );
    const dec = await fxrp.decimals();

    const accountId = await oracle.accountIdFor(PLATFORM, ACCOUNT_REF);
    const latest = await oracle.latestRevenue(accountId);
    const before = await manager.advanceOf(accountId);
    const shareBps = await manager.repaymentShareBps();

    const expected = (latest.revenueCents * shareBps) / 10_000n;
    console.log(`Newest attested period : $${Number(latest.revenueCents) / 100}`);
    console.log(`Repayment share        : ${Number(shareBps) / 100}% = $${Number(expected) / 100}`);
    console.log(`Owed before            : $${Number(before.outstandingCents) / 100}`);

    const [price, priceDec] = await manager.currentXrpUsd.staticCall();
    const needed = await manager.usdCentsToFxrp(expected, price, priceDec);
    console.log(`FXRP needed            : ${ethers.formatUnits(needed, dec)} at $${Number(price) / 10 ** Number(priceDec)}`);

    if ((await fxrp.allowance(signer.address, MANAGER)) < needed) {
        console.log("\nApproving FXRP...");
        await (await fxrp.approve(MANAGER, needed * 4n)).wait();
    }

    const balBefore = await fxrp.balanceOf(signer.address);
    const receipt = await (await manager.applyRevenueRepayment(accountId)).wait();
    const after = await manager.advanceOf(accountId);

    console.log("\n--- repaid from attested revenue ---");
    console.log("tx            :", receipt.hash);
    console.log("FXRP paid     :", ethers.formatUnits(balBefore - (await fxrp.balanceOf(signer.address)), dec));
    console.log(`Owed after    : $${Number(after.outstandingCents) / 100}`);
    console.log(`Reduced by    : $${Number(before.outstandingCents - after.outstandingCents) / 100}`);
    console.log("Advance open  :", after.open);
    console.log("Explorer      :", `https://coston2-explorer.flare.network/tx/${receipt.hash}`);
}

void main().then(() => process.exit(0));
