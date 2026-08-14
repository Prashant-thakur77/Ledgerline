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

const ORACLE = process.env.ORACLE_ADDRESS ?? "0x4516155F9069205C6EC982214528a62973477767";
const MANAGER = process.env.MANAGER_ADDRESS ?? "0x1187B737EFef8C1D2563C0001553Bf6E7afe25af";
const POOL = process.env.POOL_ADDRESS ?? "0x85Ad3AcE968Ca06a8f08C928993e4A4D9a5B8296";
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
            "function keeperReserveFxrp() view returns (uint256)",
            "function reserveFxrp(bytes32) view returns (uint256)",
            "function creditCents(bytes32) view returns (uint256)",
            "function juniorFeeBps() view returns (uint16)",
            "function keeperFeeBps() view returns (uint16)",
            "function refundWarnBps() view returns (uint16)",
            "function refundFreezeBps() view returns (uint16)",
            "function repaymentShareBps() view returns (uint16)",
            "function lotSize() view returns (uint256)",
            "function currentXrpUsd() returns (uint256,int8,uint64)",
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

    const pool = new ethers.Contract(
        POOL,
        [
            "function totalAssets() view returns (uint256)",
            "function lentFxrp() view returns (uint256)",
            "function xrplReceivableFxrp() view returns (uint256)",
            "function juniorAssets() view returns (uint256)",
        ],
        provider
    );
    try {
        console.log("\npool");
        console.log("  LenderPool     ", POOL);
        console.log("  totalAssets    ", ethers.formatUnits(await pool.totalAssets(), 6), "FXRP");
        console.log("  lent           ", ethers.formatUnits(await pool.lentFxrp(), 6));
        console.log("  XRPL receivable", ethers.formatUnits(await pool.xrplReceivableFxrp(), 6));
        console.log("  junior buffer  ", ethers.formatUnits(await pool.juniorAssets(), 6));
    } catch {
        console.log("  (no pool at this address)");
    }

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

    // V6 books — absent on a V5 manager, and said so rather than crashing the screen.
    try {
        console.log("  fee split      ", `junior ${Number(await manager.juniorFeeBps()) / 100}% / keeper ${Number(await manager.keeperFeeBps()) / 100}% of the fee slice`);
        console.log("  refund covenant", `warn ${Number(await manager.refundWarnBps()) / 100}%, freeze ${Number(await manager.refundFreezeBps()) / 100}% of gross`);
        console.log("  keeper reserve ", ethers.formatUnits(await manager.keeperReserveFxrp(), 6), "FXRP");
        console.log("  rolling reserve", ethers.formatUnits(await manager.reserveFxrp(accountId), 6), "FXRP escrowed");
        console.log("  banked credit  ", usd(await manager.creditCents(accountId)));
    } catch {
        console.log("  (V5 manager — fee split and refund covenants arrive with V6)");
    }

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
