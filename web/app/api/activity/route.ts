import { NextResponse } from "next/server";
import { decodeAbiParameters } from "viem";
import { ORACLE_ADDRESS, MANAGER_ADDRESS, DEPLOY_BLOCK } from "@/lib/contracts";

/**
 * Everything that has ever happened, as one timeline.
 *
 * Like `/api/proofs`, this asks the explorer's log index rather than the node: Coston2's public RPC caps
 * `eth_getLogs` at 30 blocks per query, so a browser cannot scan back to the deployment.
 *
 * One request set serves two purposes, because the underlying logs are the same. Without `accountId` it
 * returns protocol-wide totals; with one it also returns that account's own timeline.
 *
 *   GET /api/activity                  ->  { stats }
 *   GET /api/activity?accountId=0x…    ->  { stats, events: [...] }
 *
 * Every figure here is derived from events the contracts emitted, never from a database. If the chain says
 * it did not happen, this says it did not happen.
 */

const EXPLORER_API = process.env.COSTON2_EXPLORER_API ?? "https://coston2-explorer.flare.network/api";

type Kind =
    | "proven"
    | "bound"
    | "advance"
    | "advance-xrpl"
    | "repaid"
    | "repaid-xrpl"
    | "closed" | "reserve-escrowed" | "reserve-released" | "credit-applied";

const TOPICS: Record<string, { kind: Kind; address: string; fields: readonly { name: string; type: string }[] }> = {
    "0x578ed25fda9adc5cab8eb8bdfacf85bb29debf54c934f7487ef4d28124a6564e": {
        kind: "proven",
        address: ORACLE_ADDRESS,
        fields: [
            { name: "revenueCents", type: "uint256" },
            { name: "periodStart", type: "uint64" },
            { name: "periodEnd", type: "uint64" },
            { name: "votingRound", type: "uint64" },
            { name: "merkleRoot", type: "bytes32" },
        ],
    },
    "0xd27206581511681c50949f61eda1d2243eb9de4de38ad25ddf075386fdea94d0": {
        kind: "bound",
        address: ORACLE_ADDRESS,
        fields: [{ name: "platform", type: "string" }],
    },
    "0x58f20ae104367bf9ee11296037b8cf0db28497a6ed8f71baffaa6c20f037fd6f": {
        kind: "advance",
        address: MANAGER_ADDRESS,
        fields: [
            { name: "principalCents", type: "uint256" },
            { name: "feeCents", type: "uint256" },
            { name: "fxrpAmount", type: "uint256" },
            { name: "xrpUsdPrice", type: "uint256" },
            { name: "priceDecimals", type: "int8" },
        ],
    },
    "0xf1eb308de08c64044243a5ed6d0a253307487aa9f92240061dcaaa80312e6df6": {
        kind: "advance-xrpl",
        address: MANAGER_ADDRESS,
        fields: [
            { name: "lots", type: "uint256" },
            { name: "fxrpRedeemed", type: "uint256" },
            { name: "xrplAddress", type: "string" },
        ],
    },
    "0x31d8a7fe738e4cb48e5dc19ec2d16e4a58a7a48f41dd386e8c310589ed282319": {
        kind: "repaid",
        address: MANAGER_ADDRESS,
        fields: [
            { name: "usdCents", type: "uint256" },
            { name: "fxrpAmount", type: "uint256" },
            { name: "xrpUsdPrice", type: "uint256" },
            { name: "priceDecimals", type: "int8" },
            { name: "outstandingCents", type: "uint256" },
            { name: "automatic", type: "bool" },
        ],
    },
    "0x11bb8d8386cb9813c6a49845dd98dc6bffa5790bdaca74adeb991b43aae67329": {
        kind: "repaid-xrpl",
        address: MANAGER_ADDRESS,
        fields: [
            { name: "drops", type: "uint256" },
            { name: "usdCents", type: "uint256" },
            { name: "xrpUsdPrice", type: "uint256" },
            { name: "priceDecimals", type: "int8" },
            { name: "outstandingCents", type: "uint256" },
        ],
    },
    "0x106a8c64c5e9c8ad83fdf9fd3e4e05d8f599cca84ef0f0381b5f0208cf88af62": {
        kind: "reserve-escrowed",
        address: MANAGER_ADDRESS,
        fields: [{ name: "fxrpAmount", type: "uint256" }],
    },
    "0x1251bfcedc86b78e263701937474451126677537bc7bdc879eca9548d36a158d": {
        kind: "reserve-released",
        address: MANAGER_ADDRESS,
        fields: [{ name: "fxrpAmount", type: "uint256" }],
    },
    "0xdcf34ec96c28f54662eff7d6dc892f4f4400c63ea6db837aedd792a0f5daf4ed": {
        kind: "credit-applied",
        address: MANAGER_ADDRESS,
        fields: [
            { name: "usdCents", type: "uint256" },
            { name: "outstandingCents", type: "uint256" },
        ],
    },
    "0x40cf4b7d7860663bbe1ca3bc2d142efd21783f4703c6485d0118a61a8a5fa075": {
        kind: "closed",
        address: MANAGER_ADDRESS,
        fields: [],
    },
};

interface Row {
    kind: Kind;
    accountId: string;
    tx: string;
    block: number;
    at: number;
    /** Everything the event carried, stringified — BigInt does not survive JSON. */
    data: Record<string, string>;
    /** Only on repaid-xrpl: the XRP Ledger transaction that paid it. */
    xrplTx?: string;
}

async function logsFor(address: string, topic0: string): Promise<unknown[]> {
    const url =
        `${EXPLORER_API}?module=logs&action=getLogs` +
        `&fromBlock=${DEPLOY_BLOCK}&toBlock=latest&address=${address}&topic0=${topic0}`;
    try {
        const r = await fetch(url, { next: { revalidate: 15 } });
        if (!r.ok) return [];
        const body = await r.json();
        // Blockscout answers "no records found" with status "0". That is not an error.
        return body.status === "1" && Array.isArray(body.result) ? body.result : [];
    } catch {
        return [];
    }
}

export async function GET(request: Request) {
    const accountId = new URL(request.url).searchParams.get("accountId");
    if (accountId && !/^0x[0-9a-fA-F]{64}$/.test(accountId)) {
        return NextResponse.json({ error: "accountId must be a bytes32 hex string" }, { status: 400 });
    }

    const entries = Object.entries(TOPICS);
    const fetched = await Promise.all(entries.map(([topic, spec]) => logsFor(spec.address, topic)));

    const rows: Row[] = [];
    fetched.forEach((logs, i) => {
        const [topic, spec] = entries[i];
        for (const raw of logs as Record<string, string[] | string>[]) {
            const topics = raw.topics as string[] | undefined;
            if (topics?.[0]?.toLowerCase() !== topic) continue;

            const data: Record<string, string> = {};
            if (spec.fields.length) {
                try {
                    const decoded = decodeAbiParameters(spec.fields as never, raw.data as `0x${string}`);
                    spec.fields.forEach((f, k) => {
                        data[f.name] = String(decoded[k]);
                    });
                } catch {
                    continue; // a log we cannot decode is one we will not report
                }
            }

            rows.push({
                kind: spec.kind,
                accountId: (topics?.[1] ?? "").toLowerCase(),
                tx: String(raw.transactionHash),
                block: Number(raw.blockNumber),
                at: Number(raw.timeStamp),
                data,
                // RepaidFromXrpl indexes the XRPL transaction id as its second topic.
                xrplTx: spec.kind === "repaid-xrpl" ? topics?.[2] : undefined,
            });
        }
    });

    rows.sort((a, b) => b.block - a.block);

    // Protocol totals, over everything rather than one account.
    const accounts = new Set(rows.filter((r) => r.kind === "bound").map((r) => r.accountId));
    const proven = rows.filter((r) => r.kind === "proven");
    const advances = rows.filter((r) => r.kind === "advance");
    const provenCents = proven.reduce((s, r) => s + Number(r.data.revenueCents ?? 0), 0);
    const advancedCents = advances.reduce((s, r) => s + Number(r.data.principalCents ?? 0), 0);
    const repaidCents =
        rows.filter((r) => r.kind === "repaid").reduce((s, r) => s + Number(r.data.usdCents ?? 0), 0) +
        rows.filter((r) => r.kind === "repaid-xrpl").reduce((s, r) => s + Number(r.data.usdCents ?? 0), 0);

    const stats = {
        accounts: accounts.size,
        attestations: proven.length,
        provenCents,
        advances: advances.length,
        advancedCents,
        repaidCents,
        events: rows.length,
    };

    if (!accountId) return NextResponse.json({ stats });

    const mine = rows.filter((r) => r.accountId === accountId.toLowerCase());
    return NextResponse.json({ stats, events: mine });
}
