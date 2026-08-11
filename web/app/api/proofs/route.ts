import { NextResponse } from "next/server";
import { decodeAbiParameters } from "viem";
import { ORACLE_ADDRESS, DEPLOY_BLOCK } from "@/lib/contracts";

/**
 * Finds the transaction that proved each period, so the proof line under a figure can open it.
 *
 * This does not use `eth_getLogs`. Coston2's public RPC caps that at **30 blocks per query**, which makes
 * scanning back to the deployment impossible from the browser — the proof line would silently lose its link
 * on any deployment not pointed at a private archive node. The explorer's log index answers the same
 * question over an unbounded range in one request, so that is what this asks.
 *
 *   GET /api/proofs?accountId=0x…  ->  { "1786440386": "0x8abab9c3…", … }   (periodEnd -> tx hash)
 */

const EXPLORER_API = process.env.COSTON2_EXPLORER_API ?? "https://coston2-explorer.flare.network/api";

/** keccak256("RevenueProven(bytes32,address,uint256,uint64,uint64,uint64,bytes32)") */
const REVENUE_PROVEN_TOPIC = "0x578ed25fda9adc5cab8eb8bdfacf85bb29debf54c934f7487ef4d28124a6564e";

/** The five unindexed fields, in order. Only `periodEnd` is needed, but decoding all of it keeps it honest. */
const PROVEN_FIELDS = [
    { name: "revenueCents", type: "uint256" },
    { name: "periodStart", type: "uint64" },
    { name: "periodEnd", type: "uint64" },
    { name: "votingRound", type: "uint64" },
    { name: "merkleRoot", type: "bytes32" },
] as const;

export async function GET(request: Request) {
    const accountId = new URL(request.url).searchParams.get("accountId");
    if (!accountId || !/^0x[0-9a-fA-F]{64}$/.test(accountId)) {
        return NextResponse.json({ error: "accountId must be a bytes32 hex string" }, { status: 400 });
    }

    const url =
        `${EXPLORER_API}?module=logs&action=getLogs` +
        `&fromBlock=${DEPLOY_BLOCK}&toBlock=latest` +
        `&address=${ORACLE_ADDRESS}` +
        `&topic0=${REVENUE_PROVEN_TOPIC}` +
        `&topic1=${accountId}` +
        `&topic0_1_opr=and`;

    let response: Response;
    try {
        response = await fetch(url, { next: { revalidate: 15 } });
    } catch (e) {
        return NextResponse.json({ error: `Could not reach the explorer: ${(e as Error).message}` }, { status: 502 });
    }
    if (!response.ok) {
        return NextResponse.json({ error: `The explorer returned ${response.status}` }, { status: 502 });
    }

    const body = await response.json();
    // Blockscout answers "no records found" with status "0" and a string result. That is not an error here.
    if (body.status !== "1" || !Array.isArray(body.result)) {
        return NextResponse.json({});
    }

    const byPeriodEnd: Record<string, string> = {};
    for (const log of body.result) {
        // Guard the topic filter too: the explorer's topic matching has been permissive in the past.
        if (log.topics?.[0]?.toLowerCase() !== REVENUE_PROVEN_TOPIC) continue;
        if (log.topics?.[1]?.toLowerCase() !== accountId.toLowerCase()) continue;
        try {
            const [, , periodEnd] = decodeAbiParameters(PROVEN_FIELDS, log.data as `0x${string}`);
            byPeriodEnd[String(periodEnd)] = log.transactionHash;
        } catch {
            /* a log we cannot decode is one we cannot link; the proof line still shows round and root */
        }
    }

    return NextResponse.json(byPeriodEnd);
}
