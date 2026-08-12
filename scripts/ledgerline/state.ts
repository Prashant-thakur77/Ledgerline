import { ethers } from "hardhat";

/**
 * Prints the whole live position in one screen: what the wallet holds, what the treasury holds, every
 * period that has been proven, what can be borrowed against them, and what is owed.
 *
 * Run this before a demo. Every number a judge sees in the interface comes from one of these calls, so if
 * this looks right the interface will too.
 *
 *   npx hardhat run scripts/ledgerline/state.ts --network coston2
 */

const ORACLE = "0x151FDDB3d60B1Cc9AD43e0831495D430b0412906";
const MANAGER = "0xae027AeB3d1FBa24743D1ADE902521641F32f41c";
const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7";
const PLATFORM = "stripe";
const ACCOUNT_REF = process.env.STRIPE_ACCOUNT_REF ?? "acct_1U2HbaRh1zuX9OfD";

const usd = (cents: bigint) => `$${(Number(cents) / 100).toFixed(2)}`;
const day = (unix: bigint) => new Date(Number(unix) * 1000).toISOString().slice(0, 10);

async function main() {
    const [signer] = await ethers.getSigners();
    const provider = ethers.provider;

    const fxrp = new ethers.Contract(
        FXRP,
        ["function balanceOf(address) view returns (uint256)"],
        provider
    );
    const oracle = new ethers.Contract(
        ORACLE,
        [
            "function accountIdFor(string,string) pure returns (bytes32)",
            "function accountOwner(bytes32) view returns (address)",
            "function revenueHistory(bytes32) view returns (tuple(uint256 revenueCents,uint64 periodStart,uint64 periodEnd,uint64 provenAt,uint64 votingRound,bytes32 merkleRoot)[])",
        ],
        provider
    );
    const manager = new ethers.Contract(
        MANAGER,
        [
            "function treasuryBalance() view returns (uint256)",
            "function advanceLimitCents(bytes32) view returns (uint256)",
            "function advanceOf(bytes32) view returns (tuple(uint256 principalCents,uint256 feeCents,uint256 outstandingCents,uint256 fxrpDisbursed,uint64 openedAt,uint64 lastActivityAt,uint64 lastAppliedPeriodEnd,bool open,bool delinquent,uint256 avgRevenueCents,uint256 xrpUsdPrice,uint8 periodsUsed,uint16 factorBps,int8 priceDecimals))",
            "function feeBps() view returns (uint16)",
            "function repaymentShareBps() view returns (uint16)",
            "function lotSize() view returns (uint256)",
            "function currentXrpUsd() returns (uint256,int8)",
        ],
        provider
    );

    console.log("\nwallet");
    console.log("  address        ", signer.address);
    console.log("  C2FLR          ", ethers.formatEther(await provider.getBalance(signer.address)));
    console.log("  FXRP           ", ethers.formatUnits(await fxrp.balanceOf(signer.address), 6));

    console.log("\ntreasury");
    console.log("  AdvanceManager ", MANAGER);
    console.log("  FXRP held      ", ethers.formatUnits(await fxrp.balanceOf(MANAGER), 6));
    console.log("  treasuryBalance", ethers.formatUnits(await manager.treasuryBalance(), 6));

    const accountId = await oracle.accountIdFor(PLATFORM, ACCOUNT_REF);
    const history = await oracle.revenueHistory(accountId);

    console.log("\naccount");
    console.log("  ref            ", `${PLATFORM}/${ACCOUNT_REF}`);
    console.log("  accountId      ", accountId);
    console.log("  bound owner    ", await oracle.accountOwner(accountId));

    console.log(`\nproven periods (${history.length})`);
    for (const r of history) {
        console.log(
            `  ${day(r.periodStart)} — ${day(r.periodEnd)}  ${usd(r.revenueCents).padStart(10)}` +
                `  round ${r.votingRound}  merkle ${r.merkleRoot.slice(0, 10)}…`
        );
    }
    if (history.length === 0) console.log("  none — run attest-revenue.ts");

    console.log("\nunderwriting");
    console.log("  limit          ", usd(await manager.advanceLimitCents(accountId)));
    console.log("  fee            ", `${Number(await manager.feeBps()) / 100}%`);
    console.log("  repayment share", `${Number(await manager.repaymentShareBps()) / 100}% of each new period`);
    console.log("  FAssets lot    ", `${ethers.formatUnits(await manager.lotSize(), 6)} XRP`);

    // Not a view function: a feed read may carry a fee, so it has to be simulated rather than called.
    const [price, decimals] = await manager.currentXrpUsd.staticCall();
    console.log("  XRP/USD (FTSO) ", `$${(Number(price) / 10 ** Number(decimals)).toFixed(6)} (${decimals} decimals)`);

    const a = await manager.advanceOf(accountId);
    console.log("\nadvance");
    if (!a.open) {
        console.log("  none open");
    } else {
        console.log("  principal      ", usd(a.principalCents));
        console.log("  fee            ", usd(a.feeCents));
        console.log("  outstanding    ", usd(a.outstandingCents));
        console.log("  FXRP disbursed ", ethers.formatUnits(a.fxrpDisbursed, 6));
        console.log(
            "  priced at      ",
            `$${(Number(a.xrpUsdPrice) / 10 ** Number(a.priceDecimals)).toFixed(6)} XRP/USD`
        );
        console.log("  underwritten on", `${usd(a.avgRevenueCents)} mean of ${a.periodsUsed} periods × ${Number(a.factorBps) / 10000}x`);
        console.log("  delinquent     ", a.delinquent);
    }
    console.log();
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
