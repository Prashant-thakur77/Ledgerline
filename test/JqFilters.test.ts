import { expect } from "chai";
import { execFileSync } from "child_process";

import {
    stripeBalanceSource,
    stripeBalanceSourceV2,
    demoSourceV2,
} from "../scripts/ledgerline/revenue-sources";

/**
 * The jq filters, run through real jq.
 *
 * The postProcessJq is executed by the FDC verifiers, not by us — a filter bug is invisible until it
 * has cost a live attestation round. So the filters are tested here the way the verifier runs them:
 * the actual jq binary over a canned Stripe balance_transactions payload, asserting the exact DTO out.
 */

const S = 1_700_000_000;
const E = S + 30 * 24 * 60 * 60;
const W = { accountRef: "acct_1JqTest", periodStart: S, periodEnd: E };
const KEY = "rk_test_readonly";

/** A month with everything in it: charges, a refund, an adjustment, disputes, noise. */
const PAYLOAD = {
    object: "list",
    data: [
        // $500 charge, $480.70 net after Stripe's fee.
        { reporting_category: "charge", currency: "usd", created: S + 100, amount: 50_000, net: 48_070 },
        // $300 charge.
        { reporting_category: "charge", currency: "usd", created: S + 2000, amount: 30_000, net: 28_830 },
        // A $100 refund: negative net, fee partially returned.
        { reporting_category: "refund", currency: "usd", created: S + 3000, amount: -10_000, net: -10_000 },
        // A $2.50 adjustment in the merchant's favour.
        { reporting_category: "adjustment", currency: "usd", created: S + 4000, amount: 250, net: 250 },
        // Two chargebacks — the count matters, the size does not.
        { reporting_category: "dispute", currency: "usd", created: S + 5000, amount: -5_000, net: -6_500 },
        { reporting_category: "dispute", currency: "usd", created: S + 6000, amount: -1_000, net: -2_500 },
        // Noise the filters must ignore: wrong currency, outside the window, a payout sweep.
        { reporting_category: "charge", currency: "eur", created: S + 100, amount: 99_999, net: 99_999 },
        { reporting_category: "charge", currency: "usd", created: S - 100, amount: 77_777, net: 77_777 },
        { reporting_category: "refund", currency: "usd", created: E + 100, amount: -88_888, net: -88_888 },
        { reporting_category: "payout", currency: "usd", created: S + 500, amount: -70_000, net: -70_000 },
    ],
};

function runJq(filter: string, payload: unknown): any {
    const out = execFileSync("jq", ["-c", filter], { input: JSON.stringify(payload), encoding: "utf-8" });
    return JSON.parse(out);
}

describe("The Stripe filters, through real jq", () => {
    it("v1 nets charges, refunds and adjustments into one figure", () => {
        const out = runJq(stripeBalanceSource(W, KEY).postProcessJq, PAYLOAD);
        // 48,070 + 28,830 − 10,000 + 250 = 67,150. Disputes and noise excluded.
        expect(out).to.deep.equal({
            platform: "stripe",
            accountRef: W.accountRef,
            revenueCents: 67_150,
            periodStart: S,
            periodEnd: E,
        });
    });

    it("v2 carries the refunds and the dispute count beside the net", () => {
        const out = runJq(stripeBalanceSourceV2(W, KEY).postProcessJq, PAYLOAD);
        expect(out).to.deep.equal({
            platform: "stripe",
            accountRef: W.accountRef,
            revenueCents: 67_150,
            periodStart: S,
            periodEnd: E,
            refundCents: 10_000, // the refund row's negative net, negated
            disputeCount: 2, // incidents, not cents
        });
    });

    it("an empty month reads zero everywhere, never null", () => {
        const out = runJq(stripeBalanceSourceV2(W, KEY).postProcessJq, { object: "list", data: [] });
        expect(out.revenueCents).to.equal(0);
        expect(out.refundCents).to.equal(0);
        expect(out.disputeCount).to.equal(0);
    });

    it("a month more refunded than earned clamps to zero revenue, not negative collateral", () => {
        const heavy = {
            object: "list",
            data: [
                { reporting_category: "charge", currency: "usd", created: S + 100, amount: 10_000, net: 9_500 },
                { reporting_category: "refund", currency: "usd", created: S + 200, amount: -40_000, net: -40_000 },
            ],
        };
        const out = runJq(stripeBalanceSourceV2(W, KEY).postProcessJq, heavy);
        expect(out.revenueCents).to.equal(0);
        expect(out.refundCents).to.equal(40_000); // the ratio still sees the full refund picture
    });

    it("a refund reversal cannot mint a negative refund figure", () => {
        const reversal = {
            object: "list",
            data: [
                // A prior month's refund reversed this month: a positive-net refund row.
                { reporting_category: "refund", currency: "usd", created: S + 100, amount: 5_000, net: 5_000 },
            ],
        };
        const out = runJq(stripeBalanceSourceV2(W, KEY).postProcessJq, reversal);
        expect(out.refundCents).to.equal(0);
    });

    it("the keyless stand-in reduces to the same v2 shape", () => {
        const out = runJq(demoSourceV2(W, 400_000, 8_000, 1).postProcessJq, { height: "96" });
        expect(out).to.deep.equal({
            platform: "demo",
            accountRef: W.accountRef,
            revenueCents: 400_000,
            periodStart: S,
            periodEnd: E,
            refundCents: 8_000,
            disputeCount: 1,
        });
    });
});
