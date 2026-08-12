import { NextResponse } from "next/server";
import { REVENUE_ABI_SIGNATURE, demoSource, stripeBalanceSource, toUtf8HexString } from "@/lib/sources";
import type { SourceConfig, Window } from "@/lib/sources";

/**
 * Step one of an attestation: ask the FDC verifier to turn a request into the ABI-encoded form the FdcHub
 * accepts. The browser cannot call the verifier directly — it is not CORS-open, and the Stripe key must not
 * ship in the JavaScript bundle — so this route stands in front of it.
 *
 * It is deliberately a thin, short-lived proxy. Nothing here waits for a voting round; the browser does that
 * itself, which is what keeps the whole flow inside any host's function timeout.
 */

const VERIFIER_URL = process.env.VERIFIER_URL_TESTNET ?? "https://fdc-verifiers-testnet.flare.network";
/** The documented public testnet key. There is no secret here. */
const VERIFIER_API_KEY = process.env.VERIFIER_API_KEY_TESTNET ?? "00000000-0000-0000-0000-000000000000";

/**
 * The Stripe account this deployment is allowed to attest.
 *
 * Pinned server-side on purpose. The key is ours, so without this a visitor could attest our revenue under
 * an account reference of their choosing and bind the resulting record to their own wallet.
 */
const STRIPE_ACCOUNT_REF = process.env.LEDGERLINE_ACCOUNT_REF ?? "acct_1U2HbaRh1zuX9OfD";

const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY;
/** Mirrors RevenueOracle.MIN_PERIOD_SECONDS / MAX_PERIOD_SECONDS. */
const MIN_PERIOD = 26 * DAY;
const MAX_PERIOD = 32 * DAY;

type Body = {
    source?: "stripe" | "demo";
    accountRef?: string;
    periodStart?: number;
    periodEnd?: number;
    revenueCents?: number;
};

function buildSource(body: Body): { source: SourceConfig; window: Window } {
    const periodEnd = Math.floor(Number(body.periodEnd ?? Date.now() / 1000));
    const periodStart = Math.floor(Number(body.periodStart ?? periodEnd - MONTH));
    if (!Number.isFinite(periodStart) || !Number.isFinite(periodEnd) || periodEnd <= periodStart) {
        throw new Error("periodEnd must be a finite unix time after periodStart");
    }

    /*
     * RevenueOracle only accepts a period that is actually a month, because the underwriting prices each
     * one as a month's takings. Checking it here as well is not redundant: the contract is the enforcement
     * point, but finding out there costs a voting round and an attestation fee, and the error arrives two
     * minutes after the request instead of before it.
     */
    const span = periodEnd - periodStart;
    if (span < MIN_PERIOD || span > MAX_PERIOD) {
        throw new Error(
            `A period has to be about a month: this one is ${Math.round(span / DAY)} days, and the ` +
                `contract accepts ${MIN_PERIOD / DAY}–${MAX_PERIOD / DAY}. Longer history is proven as ` +
                `several monthly periods, which is why they are not allowed to overlap.`
        );
    }

    if (body.source === "stripe") {
        const key = process.env.STRIPE_API_KEY;
        if (!key) {
            throw new Error(
                "This deployment has no STRIPE_API_KEY configured, so the live Stripe source is unavailable. " +
                    "The sandbox source needs no credentials and exercises the same pipeline."
            );
        }
        const window: Window = { accountRef: STRIPE_ACCOUNT_REF, periodStart, periodEnd };
        return { source: stripeBalanceSource(window, key), window };
    }

    // Sandbox path. The account reference is the visitor's own wallet address, so the record binds to them.
    const accountRef = String(body.accountRef ?? "").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(accountRef)) {
        throw new Error("The sandbox source needs accountRef to be the connected wallet address");
    }
    const cents = Math.floor(Number(body.revenueCents ?? 400_000));
    if (!Number.isFinite(cents) || cents <= 0 || cents > 100_000_000) {
        throw new Error("revenueCents must be between 1 and 100,000,000");
    }
    const window: Window = { accountRef, periodStart, periodEnd };
    return { source: demoSource(window, cents), window };
}

export async function POST(request: Request) {
    let body: Body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
    }

    let built: { source: SourceConfig; window: Window };
    try {
        built = buildSource(body);
    } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
    const { source, window } = built;

    const attestationRequest = {
        attestationType: toUtf8HexString("Web2Json"),
        sourceId: toUtf8HexString("PublicWeb2"),
        requestBody: {
            url: source.url,
            httpMethod: source.httpMethod,
            headers: source.headers,
            queryParams: source.queryParams,
            body: source.body,
            postProcessJq: source.postProcessJq,
            abiSignature: REVENUE_ABI_SIGNATURE,
        },
    };

    let response: Response;
    try {
        response = await fetch(`${VERIFIER_URL}/verifier/web2/Web2Json/prepareRequest`, {
            method: "POST",
            headers: { "X-API-KEY": VERIFIER_API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify(attestationRequest),
        });
    } catch (e) {
        return NextResponse.json({ error: `Could not reach the FDC verifier: ${(e as Error).message}` }, { status: 502 });
    }

    if (!response.ok) {
        return NextResponse.json(
            { error: `The FDC verifier returned ${response.status} ${response.statusText}` },
            { status: 502 }
        );
    }

    const data = await response.json();
    if (data.status !== "VALID") {
        return NextResponse.json({ error: `The verifier rejected the request: ${data.status}`, detail: data }, { status: 422 });
    }

    return NextResponse.json({
        abiEncodedRequest: data.abiEncodedRequest,
        // Enough for the page to show exactly what was asked, without echoing the Authorization header.
        request: {
            platform: source.platform,
            url: source.url,
            httpMethod: source.httpMethod,
            postProcessJq: source.postProcessJq,
            authenticated: source.headers !== "{}",
        },
        window,
    });
}
