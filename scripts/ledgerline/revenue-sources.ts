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
/**
 * The key is about to be written into public calldata, permanently. A standard secret key there would publish
 * full read-write access to the account, so refuse it outright rather than trust care.
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

export function stripeSource(w: Window, apiKey: string): SourceConfig {
    assertRestricted(apiKey);
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
 * Stripe, read from balance transactions rather than payouts. This is the default.
 *
 * Payouts describe money being swept to a bank, which needs a bank account attached and a payout schedule to
 * have run. Balance transactions describe money being *earned*, which is what is actually being underwritten,
 * and they exist the moment a charge settles. For a creator being advanced against revenue, earned is the
 * more honest basis, and it is available months before a new account has any payout history.
 *
 * `net` is used rather than `amount`: it is the figure after Stripe's fees, so it is the money the business
 * actually keeps, and it is what a payout would have contained.
 *
 * The filter, step by step:
 *   .data[]                                   every balance transaction in the page
 *   select(.reporting_category == "charge")   money in from customers; excludes fees, refunds and transfers
 *   select(.currency == "usd")                guard the cents assumption
 *   select(.created >= S and < E)             the window, by when the money was earned
 *   [ ... .net] | add // 0                    sum after fees, and yield 0 rather than null for an empty window
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
         * overstates revenue for any account that refunds. They are counted here, and the sum is clamped
         * at zero — a month more refunded than earned is zero revenue, not negative collateral.
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

/** Must stay in step with RevenueOracle.ProfileDTO. */
export const PROFILE_ABI_SIGNATURE = JSON.stringify({
    components: [
        { internalType: "string", name: "platform", type: "string" },
        { internalType: "string", name: "accountRef", type: "string" },
        { internalType: "uint256", name: "createdAt", type: "uint256" },
    ],
    name: "task",
    type: "tuple",
});

/**
 * Stripe's own record of when the account was created, for the underwriting age gate. Reads `/v1/account`,
 * which the restricted key must be scoped to (read-only, like everything else it can see).
 */
export function stripeProfileSource(accountRef: string, apiKey: string): SourceConfig {
    assertRestricted(apiKey);
    return {
        platform: "stripe",
        url: "https://api.stripe.com/v1/account",
        httpMethod: "GET",
        headers: JSON.stringify({ Authorization: `Bearer ${apiKey}` }),
        queryParams: "{}",
        body: "{}",
        postProcessJq: `{ platform: "stripe", accountRef: "${accountRef}", createdAt: .created }`,
    };
}

/**
 * Shopify, read from the Admin API's orders endpoint. The second real platform, and the proof that the
 * oracle's platform-agnosticism holds: RevenueOracle does not change, this entry is the whole integration.
 *
 * `current_total_price` is the order total after refunds at read time, in the shop's currency — pinned to
 * USD the same way the Stripe filter pins it. Cancelled orders are excluded; partial refunds are already
 * netted into the current total, which keeps this honest the same way `net` does for Stripe.
 *
 * PAGINATION, stated plainly: one page of up to 250 orders. A shop with more orders than that in the window
 * is UNDER-counted, which is conservative in the only direction that matters for lending — it can deny
 * credit that was deserved, never grant credit that was not. Per-page attestation summed on chain is the
 * roadmap fix (docs/ROADMAP.md, phase 5).
 *
 * The access token needs `read_orders` only, and travels in public calldata exactly like the Stripe key —
 * same disclosure, same mitigation, same enclave endgame.
 */
export function shopifyOrdersSource(w: Window, shopDomain: string, accessToken: string): SourceConfig {
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain)) {
        throw new Error(`Expected a myshopify.com domain, got "${shopDomain}"`);
    }
    if (accessToken.startsWith("shpss_") || accessToken.startsWith("shpca_")) {
        throw new Error("Refusing a shared/custom-app secret: use a read-only Admin API access token (shpat_…).");
    }
    return {
        platform: "shopify",
        url: `https://${shopDomain}/admin/api/2024-01/orders.json`,
        httpMethod: "GET",
        headers: JSON.stringify({ "X-Shopify-Access-Token": accessToken }),
        queryParams: JSON.stringify({
            status: "any",
            limit: "250",
            created_at_min: new Date(w.periodStart * 1000).toISOString(),
            created_at_max: new Date(w.periodEnd * 1000).toISOString(),
        }),
        body: "{}",
        postProcessJq: [
            `{`,
            `platform: "shopify",`,
            `accountRef: "${w.accountRef}",`,
            `revenueCents: (([.orders[]`,
            `| select(.cancelled_at == null)`,
            `| select(.currency == "USD")`,
            `| (.current_total_price | tonumber * 100 | floor)] | add // 0)`,
            `| if . < 0 then 0 else . end),`,
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

// ---------------------------------------------------------------- V6 sources
//
// The seven-field DTO: net revenue, refunds and disputes attested side by side, so the covenants
// (refundRatioBps, the warn step-up, the origination freeze) read attested facts rather than trust.
// NOT used against the live V5 oracle — these exist for the V6 deploy and are exercised by tests.

/** Must stay in step with RevenueOracle.RevenueDTO (V6) — refundCents and disputeCount appended. */
export const REVENUE_ABI_SIGNATURE_V2 = JSON.stringify({
    components: [
        { internalType: "string", name: "platform", type: "string" },
        { internalType: "string", name: "accountRef", type: "string" },
        { internalType: "uint256", name: "revenueCents", type: "uint256" },
        { internalType: "uint256", name: "periodStart", type: "uint256" },
        { internalType: "uint256", name: "periodEnd", type: "uint256" },
        { internalType: "uint256", name: "refundCents", type: "uint256" },
        { internalType: "uint256", name: "disputeCount", type: "uint256" },
    ],
    name: "task",
    type: "tuple",
});

/**
 * Stripe balance transactions, reduced to the V6 DTO.
 *
 * The same rows as `stripeBalanceSource`, read three ways:
 *   revenueCents  — net of charges, refunds and adjustments, clamped at zero (as before)
 *   refundCents   — the refunded money on its own, as a positive number: refund rows carry negative
 *                   `net`, so the sum is negated; clamped at zero so a reversal-heavy correction
 *                   month cannot mint a negative
 *   disputeCount  — how many chargebacks landed, regardless of amount: VAMP counts incidents,
 *                   because ten small disputes say more about a merchant than one large refund
 */
export function stripeBalanceSourceV2(w: Window, apiKey: string): SourceConfig {
    assertRestricted(apiKey);
    const inWindow = `select(.currency == "usd") | select(.created >= ${w.periodStart} and .created < ${w.periodEnd})`;
    return {
        platform: "stripe",
        url: "https://api.stripe.com/v1/balance_transactions",
        httpMethod: "GET",
        headers: JSON.stringify({ Authorization: `Bearer ${apiKey}` }),
        queryParams: JSON.stringify({ limit: "100" }),
        body: "{}",
        postProcessJq: [
            `{`,
            `platform: "stripe",`,
            `accountRef: "${w.accountRef}",`,
            `revenueCents: (([.data[]`,
            `| select(.reporting_category == "charge" or .reporting_category == "refund" or .reporting_category == "adjustment")`,
            `| ${inWindow}`,
            `| .net] | add // 0) | if . < 0 then 0 else . end),`,
            `periodStart: ${w.periodStart},`,
            `periodEnd: ${w.periodEnd},`,
            `refundCents: ((0 - ([.data[]`,
            `| select(.reporting_category == "refund")`,
            `| ${inWindow}`,
            `| .net] | add // 0)) | if . < 0 then 0 else . end),`,
            `disputeCount: ([.data[]`,
            `| select(.reporting_category == "dispute")`,
            `| ${inWindow}] | length)`,
            `}`,
        ].join(" "),
    };
}

/** The keyless stand-in, V6-shaped, so the whole v2 pipeline can be proven without credentials. */
export function demoSourceV2(w: Window, revenueCents: number, refundCents = 0, disputeCount = 0): SourceConfig {
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
            `periodEnd: ${w.periodEnd},`,
            `refundCents: ${refundCents},`,
            `disputeCount: ${disputeCount}`,
            `}`,
        ].join(" "),
    };
}
