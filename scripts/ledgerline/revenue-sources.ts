/**
 * Revenue sources.
 *
 * Each source reduces a platform's API response to exactly the five fields RevenueOracle.RevenueDTO expects.
 * The jq runs inside the FDC verifier, and every data provider must agree on its output, so the reduction has
 * to be deterministic — no clocks, no randomness, nothing that varies between providers running it seconds
 * apart. That is why the period boundaries are baked in as literals by the caller rather than computed as
 * "now minus 30 days" inside the filter.
 *
 * Adding Shopify or YouTube means adding an entry here. RevenueOracle does not change: `platform` is a field
 * and `accountRef` is opaque to it.
 */

/** Must stay in step with RevenueOracle.RevenueDTO and with the DTO_TYPE in the tests. */
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
    periodStart: number; // unix seconds, inclusive
    periodEnd: number; // unix seconds, exclusive
}

/**
 * Stripe. Sums the payouts that actually landed in the window.
 *
 * Stripe reports `amount` in the smallest currency unit, so for USD it is already cents and needs no scaling —
 * a currency with a different exponent would need converting, which is why the filter pins currency to usd.
 *
 * The filter, step by step:
 *   .data[]                                  every payout in the page
 *   select(.status == "paid")                only ones that settled; pending and failed are not revenue
 *   select(.currency == "usd")               guard the cents assumption above
 *   select(.arrival_date >= S and < E)       the window, using the date the money landed
 *   [ ... .amount] | add // 0                sum, and yield 0 rather than null for an empty window
 *
 * NOTE: this request carries an Authorization header, and FDC requests are public calldata. Use a read-only
 * restricted key and expect it to be world-readable. See docs/BLOCKERS.md.
 */
export function stripeSource(w: Window, apiKey: string): SourceConfig {
    return {
        platform: "stripe",
        url: "https://api.stripe.com/v1/payouts",
        httpMethod: "GET",
        headers: JSON.stringify({ Authorization: `Bearer ${apiKey}` }),
        queryParams: JSON.stringify({ limit: "100" }),
        body: "{}",
        postProcessJq: [
            `{`,
            `platform: "stripe",`,
            `accountRef: "${w.accountRef}",`,
            `revenueCents: ([.data[]`,
            `| select(.status == "paid")`,
            `| select(.currency == "usd")`,
            `| select(.arrival_date >= ${w.periodStart} and .arrival_date < ${w.periodEnd})`,
            `| .amount] | add // 0),`,
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
 * downstream — the verifier, the Merkle proof, RevenueOracle's decode and its guards — is exercised against a
 * real attestation. Swap in `stripeSource` and nothing else changes.
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
