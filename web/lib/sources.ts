/**
 * Revenue sources, for the copy of the attestation pipeline that runs from the browser.
 *
 * CANONICAL DEFINITION: `scripts/ledgerline/revenue-sources.ts`. This file mirrors it so the web app can
 * compose the same request without importing across the Hardhat project's tsconfig, whose `@types` leak in
 * and break the Next build. The jq filters must stay identical to the ones there — if they drift, the two
 * paths attest different figures for the same period.
 *
 * The jq runs inside the FDC verifier and every data provider executes it independently, so it has to be
 * deterministic. That is why the period boundaries are baked in as literals rather than computed from a
 * clock inside the filter.
 */

/** Must stay in step with RevenueOracle.RevenueDTO. */
export const REVENUE_ABI_SIGNATURE = JSON.stringify({
    components: [
        { internalType: "string", name: "platform", type: "string" },
        { internalType: "string", name: "accountRef", type: "string" },
        { internalType: "uint256", name: "revenueCents", type: "uint256" },
        { internalType: "uint256", name: "periodStart", type: "uint256" },
        { internalType: "uint256", name: "periodEnd", type: "uint256" },
    ],
    name: "task",
    type: "tuple",
});

export interface SourceConfig {
    platform: string;
    url: string;
    httpMethod: string;
    headers: string;
    queryParams: string;
    body: string;
    postProcessJq: string;
}

export interface Window {
    accountRef: string;
    periodStart: number;
    periodEnd: number;
}

/**
 * The key is about to be written into public calldata, permanently. A standard secret key there would
 * publish full read-write access to the account, so refuse it outright rather than trust care.
 */
function assertRestricted(apiKey: string) {
    if (apiKey.startsWith("sk_")) {
        throw new Error(
            "Refusing to attest with a standard secret key: attestation requests are public on chain. " +
                "Use the read-only restricted key (rk_...) in STRIPE_API_KEY."
        );
    }
    if (!apiKey.startsWith("rk_")) {
        throw new Error(`Expected a restricted key (rk_...) in STRIPE_API_KEY, got "${apiKey.slice(0, 6)}..."`);
    }
}

/**
 * Stripe, read from balance transactions rather than payouts.
 *
 * Balance transactions describe money being *earned*, which is what is being underwritten, and they exist
 * the moment a charge settles. `net` is used rather than `amount` because it is the figure after Stripe's
 * fees — the money the business actually keeps.
 */
export function stripeBalanceSource(w: Window, apiKey: string): SourceConfig {
    assertRestricted(apiKey);
    return {
        platform: "stripe",
        url: "https://api.stripe.com/v1/balance_transactions",
        httpMethod: "GET",
        headers: JSON.stringify({ Authorization: `Bearer ${apiKey}` }),
        queryParams: JSON.stringify({ limit: "100" }),
        body: "{}",
        /*
         * Refunds and chargebacks are their own rows with negative `net`, so summing charges alone
         * overstates revenue for any account that refunds. They are counted, and the sum clamps at zero.
         * MUST match scripts/ledgerline/revenue-sources.ts exactly — two pipelines, one figure.
         */
        postProcessJq: [
            `{`,
            `platform: "stripe",`,
            `accountRef: "${w.accountRef}",`,
            `revenueCents: (([.data[]`,
            `| select(.reporting_category == "charge" or .reporting_category == "refund" or .reporting_category == "adjustment")`,
            `| select(.currency == "usd")`,
            `| select(.created >= ${w.periodStart} and .created < ${w.periodEnd})`,
            `| .net] | add // 0) | if . < 0 then 0 else . end),`,
            `periodStart: ${w.periodStart},`,
            `periodEnd: ${w.periodEnd}`,
            `}`,
        ].join(" "),
    };
}

/**
 * A public stand-in used to prove the pipeline end to end without credentials.
 *
 * It is NOT revenue. It reduces a public, keyless endpoint into the identical DTO so that everything
 * downstream — the verifier, the Merkle proof, RevenueOracle's decode and its guards — is exercised against
 * a real attestation. This is the path a visitor can run against their own wallet.
 */
export function demoSource(w: Window, revenueCents: number): SourceConfig {
    return {
        platform: "demo",
        url: "https://swapi.info/api/people/3",
        httpMethod: "GET",
        headers: "{}",
        queryParams: "{}",
        body: "{}",
        postProcessJq: [
            `{`,
            `platform: "demo",`,
            `accountRef: "${w.accountRef}",`,
            `revenueCents: (.height | tonumber | . * 0 + ${revenueCents}),`,
            `periodStart: ${w.periodStart},`,
            `periodEnd: ${w.periodEnd}`,
            `}`,
        ].join(" "),
    };
}

/** Right-pad a short ASCII string into a bytes32 hex string, the encoding FDC uses for type and source ids. */
export function toUtf8HexString(data: string) {
    let hex = "";
    for (let i = 0; i < data.length; i++) hex += data.charCodeAt(i).toString(16).padStart(2, "0");
    return "0x" + hex.padEnd(64, "0");
}
