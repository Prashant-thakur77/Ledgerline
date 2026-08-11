/**
 * Take an advance against proven revenue, and show every number the product claims.
 *   USD_CENTS=200 yarn hardhat run scripts/ledgerline/take-advance.ts --network coston2
 */
import { ethers } from "hardhat";

const ORACLE = process.env.ORACLE_ADDRESS ?? "0x80D08369E1a34e8c7C43FCF947323e56e6B87Be6";
const MANAGER = process.env.MANAGER_ADDRESS ?? "0x63fC5a5c422D40DcC8FA267384BA5351d8698A58";
const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7";

const PLATFORM = process.env.PLATFORM ?? "demo";
const ACCOUNT_REF = process.env.ACCOUNT_REF ?? "acct_1LedgerlineDemo";
const USD_CENTS = BigInt(process.env.USD_CENTS ?? 200);

async function main() {
    const [signer] = await ethers.getSigners();
    const oracle = await ethers.getContractAt("RevenueOracle", ORACLE);
    const manager = await ethers.getContractAt("AdvanceManager", MANAGER);
    const fxrp = await ethers.getContractAt(
        ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"],
        FXRP
    );
    const dec = await fxrp.decimals();

    const accountId = await oracle.accountIdFor(PLATFORM, ACCOUNT_REF);
    const history = await oracle.revenueHistory(accountId);
    console.log(`Account ${PLATFORM}/${ACCOUNT_REF}`);
    console.log("Proven periods:");
    for (const r of history) {
        console.log(
            `  $${Number(r.revenueCents) / 100} for the period ending ${new Date(Number(r.periodEnd) * 1000).toISOString().slice(0, 10)}`
        );
    }

    const limit = await manager.advanceLimitCents(accountId);
    console.log(`\nAdvance limit: $${Number(limit) / 100}`);

    const [price, priceDec] = await manager.currentXrpUsd.staticCall();
    console.log(`XRP/USD from FTSOv2: $${Number(price) / 10 ** Number(priceDec)}`);

    const quoted = await manager.usdCentsToFxrp(USD_CENTS, price, priceDec);
    console.log(`\nRequesting $${Number(USD_CENTS) / 100} -> ${ethers.formatUnits(quoted, dec)} FXRP`);

    const before = await fxrp.balanceOf(signer.address);
    const tx = await manager.requestAdvance(accountId, USD_CENTS);
    const receipt = await tx.wait();
    const after = await fxrp.balanceOf(signer.address);

    const advance = await manager.advanceOf(accountId);
    console.log("\n--- advance issued ---");
    console.log("tx                 :", receipt.hash);
    console.log("FXRP received      :", ethers.formatUnits(after - before, dec));
    console.log("Principal          : $" + Number(advance.principalCents) / 100);
    console.log("Fee                : $" + Number(advance.feeCents) / 100);
    console.log("Owed (US dollars)  : $" + Number(advance.outstandingCents) / 100);
    console.log("Rate used          : $" + Number(advance.xrpUsdPrice) / 10 ** Number(advance.priceDecimals));
    console.log(
        "Underwritten from  : mean of",
        advance.periodsUsed.toString(),
        "period(s) =",
        "$" + Number(advance.avgRevenueCents) / 100,
        "at",
        Number(advance.factorBps) / 10000 + "x"
    );
    console.log("Explorer           :", `https://coston2-explorer.flare.network/tx/${receipt.hash}`);
}

void main().then(() => process.exit(0));
