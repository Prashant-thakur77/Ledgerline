import { NextResponse } from "next/server";

/**
 * The XRPL side of the cross-chain view: an account's XRP balance, read from the XRP Ledger testnet.
 *
 * A thin server proxy because the browser cannot reach the XRPL JSON-RPC endpoint directly (CORS), and
 * because the endpoint is public read-only state: no key, no write, nothing to protect. Cached briefly so
 * a page full of visitors does not hammer the public node.
 */

const XRPL_RPC = "https://s.altnet.rippletest.net:51234";

export const revalidate = 30;

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const account = searchParams.get("account") ?? "";
    if (!/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(account)) {
        return NextResponse.json({ error: "not an XRPL address" }, { status: 400 });
    }

    try {
        const res = await fetch(XRPL_RPC, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ method: "account_info", params: [{ account, ledger_index: "validated" }] }),
            next: { revalidate: 30 },
        });
        const body = await res.json();
        const drops = body?.result?.account_data?.Balance;
        if (!drops) return NextResponse.json({ error: body?.result?.error ?? "no balance" }, { status: 404 });
        return NextResponse.json({ account, drops, xrp: Number(drops) / 1_000_000 });
    } catch {
        return NextResponse.json({ error: "xrpl unreachable" }, { status: 502 });
    }
}
