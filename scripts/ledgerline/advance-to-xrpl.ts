/**
 * Take an advance that is paid out as real XRP on the XRP Ledger.
 *   XRPL_ADDRESS=r… LOTS=1 yarn hardhat run scripts/ledgerline/advance-to-xrpl.ts --network coston2
 *
 * The FXRP never reaches the borrower. It is redeemed through FAssets, and an agent pays XRP to the
 * borrower's own XRPL address — so the borrower needs no EVM wallet to be funded.
 */
import { ethers } from "hardhat";

const ORACLE = process.env.ORACLE_ADDRESS ?? "0x4Ef13AC54c1306F2E678e201b9CB4f9e1C1AB4b6";
const MANAGER = process.env.MANAGER_ADDRESS ?? "0xD397f88C6466C0F202b5387454d2897762FDE054";

const PLATFORM = process.env.PLATFORM ?? "stripe";
const ACCOUNT_REF = process.env.ACCOUNT_REF ?? "acct_1U2HbaRh1zuX9OfD";
const LOTS = BigInt(process.env.LOTS ?? 1);
const XRPL_ADDRESS = process.env.XRPL_ADDRESS ?? "rpcBsvdaL4eCkK64nNsQB1PQf4hm2Dq3Sc";

const XRPL_RPC = "https://s.altnet.rippletest.net:51234";

async function xrplBalance(address: string): Promise<number> {
    const res = await fetch(XRPL_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "account_info", params: [{ account: address, ledger_index: "validated" }] }),
    });
    const json: any = await res.json();
    const drops = json?.result?.account_data?.Balance;
    return drops ? Number(drops) / 1e6 : NaN;
}

async function main() {
    const oracle = await ethers.getContractAt("RevenueOracle", ORACLE);
    const manager = await ethers.getContractAt("AdvanceManager", MANAGER);
    const accountId = await oracle.accountIdFor(PLATFORM, ACCOUNT_REF);

    const lot = await manager.lotSize();
    const [price, priceDec] = await manager.currentXrpUsd.staticCall();
    const fxrpAmount = LOTS * lot;
    const usdCents = await manager.fxrpToUsdCents(fxrpAmount, price, priceDec);

    console.log(`Account        : ${PLATFORM}/${ACCOUNT_REF}`);
    console.log(`Limit          : $${Number(await manager.advanceLimitCents(accountId)) / 100}`);
    console.log(`Redeeming      : ${LOTS} lot(s) = ${ethers.formatUnits(fxrpAmount, 6)} XRP`);
    console.log(`XRP/USD        : $${Number(price) / 10 ** Number(priceDec)}`);
    console.log(`Dollar debt    : $${Number(usdCents) / 100} plus fee`);
    console.log(`Destination    : ${XRPL_ADDRESS}`);

    const before = await xrplBalance(XRPL_ADDRESS);
    console.log(`\nXRPL balance before: ${before} XRP`);

    // FAssets redemption walks the redemption ticket queue, and eth_estimateGas comes back well under what
    // the real execution needs — the first attempt reverted having burned exactly its estimate.
    const receipt = await (
        await manager.requestAdvanceToXrpl(accountId, LOTS, XRPL_ADDRESS, { gasLimit: 6_000_000 })
    ).wait();
    console.log("\nRedemption requested. tx:", receipt.hash);
    console.log("Explorer:", `https://coston2-explorer.flare.network/tx/${receipt.hash}`);

    const advance = await manager.advanceOf(accountId);
    console.log(`\nOwed: $${Number(advance.outstandingCents) / 100} (principal $${Number(advance.principalCents) / 100} + fee $${Number(advance.feeCents) / 100})`);
    console.log(`FXRP redeemed: ${ethers.formatUnits(advance.fxrpDisbursed, 6)}`);

    console.log("\nWaiting for the FAssets agent to pay on the XRP Ledger...");
    for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 15_000));
        const now = await xrplBalance(XRPL_ADDRESS);
        if (!Number.isNaN(now) && now > before) {
            console.log(`\nXRP ARRIVED. Balance ${before} -> ${now} (+${(now - before).toFixed(6)} XRP)`);
            console.log(`Explorer: https://testnet.xrpl.org/accounts/${XRPL_ADDRESS}`);
            return;
        }
        process.stdout.write(`  ${(i + 1) * 15}s… balance still ${now}\r`);
    }
    console.log("\nNot paid within 10 minutes. The redemption request stands and the agent still owes it;");
    console.log("check https://testnet.xrpl.org/accounts/" + XRPL_ADDRESS);
}

void main().then(() => process.exit(0));
