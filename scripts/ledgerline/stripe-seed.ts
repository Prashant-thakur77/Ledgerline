/**
 * Give a fresh Stripe sandbox a payout history to attest.
 *
 *   npx tsx scripts/ledgerline/stripe-seed.ts        (or: npx hardhat run scripts/ledgerline/stripe-seed.ts)
 *
 * Needs STRIPE_SETUP_KEY in .env — your standard sk_test_ key. It stays on this machine: it is used to
 * create test charges and payouts and is never put in an attestation, because attestation requests are
 * public calldata. The key that goes on chain is the read-only STRIPE_API_KEY.
 *
 * Everything here is test mode. No real money moves and nothing is charged.
 */

const KEY = process.env.STRIPE_SETUP_KEY;
const API = "https://api.stripe.com/v1";

/** How many payouts to create, and for how much (in cents). */
const PAYOUTS = [120_000, 145_000, 138_000]; // $1,200 / $1,450 / $1,380

async function stripe(path: string, params?: Record<string, string>) {
    const res = await fetch(`${API}${path}`, {
        method: params ? "POST" : "GET",
        headers: {
            Authorization: `Bearer ${KEY}`,
            ...(params ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        ...(params ? { body: new URLSearchParams(params).toString() } : {}),
    });
    const json: any = await res.json();
    if (!res.ok) {
        throw new Error(`${path} -> ${res.status}: ${json.error?.message ?? JSON.stringify(json)}`);
    }
    return json;
}

async function availableUsd(): Promise<number> {
    const balance = await stripe("/balance");
    const usd = balance.available.find((b: any) => b.currency === "usd");
    return usd ? usd.amount : 0;
}

async function main() {
    if (!KEY) throw new Error("Set STRIPE_SETUP_KEY in .env to your sk_test_ key");
    if (!KEY.startsWith("sk_test_")) throw new Error("Refusing to run: STRIPE_SETUP_KEY is not a test key");

    const total = PAYOUTS.reduce((a, b) => a + b, 0);
    console.log(`Funding the sandbox balance with $${total / 100} using pm_card_bypassPending...\n`);

    // pm_card_bypassPending lands straight in the available balance instead of sitting pending.
    for (const amount of PAYOUTS) {
        const pi = await stripe("/payment_intents", {
            amount: String(amount),
            currency: "usd",
            payment_method: "pm_card_bypassPending",
            confirm: "true",
            "automatic_payment_methods[enabled]": "true",
            "automatic_payment_methods[allow_redirects]": "never",
        });
        console.log(`  charge ${pi.id}  $${amount / 100}  ${pi.status}`);
    }

    console.log(`\nAvailable balance: $${(await availableUsd()) / 100}\n`);

    console.log("Creating payouts...");
    for (const amount of PAYOUTS) {
        try {
            const payout = await stripe("/payouts", { amount: String(amount), currency: "usd" });
            console.log(
                `  payout ${payout.id}  $${amount / 100}  status=${payout.status}  arrival=${new Date(payout.arrival_date * 1000).toISOString().slice(0, 10)}`
            );
        } catch (e: any) {
            console.error(`\n  FAILED: ${e.message}`);
            console.error(
                "\n  Two things usually cause this:\n" +
                    "   1. No test bank account attached. Add one in the Dashboard under\n" +
                    "      Settings -> Payouts (test routing 110000000, account 000123456789).\n" +
                    "   2. The payout schedule is automatic. Set it to manual in the same place,\n" +
                    "      so payouts are created on demand rather than on a schedule.\n"
            );
            process.exit(1);
        }
    }

    const payouts = await stripe("/payouts?limit=100");
    const paid = payouts.data.filter((p: any) => p.currency === "usd");
    console.log(`\n${paid.length} payouts now exist. Attestable window:`);
    const dates = paid.map((p: any) => p.arrival_date).sort((a: number, b: number) => a - b);
    console.log(`  PERIOD_START=${dates[0]}`);
    console.log(`  PERIOD_END=${dates[dates.length - 1] + 1}`);
    console.log(`  total: $${paid.reduce((s: number, p: any) => s + p.amount, 0) / 100}`);
    console.log(
        `\nStatuses: ${[...new Set(paid.map((p: any) => p.status))].join(", ")}` +
            `\nNote the jq filters on status == "paid"; in test mode payouts often sit at "pending" or "in_transit",` +
            `\nso we may need to widen that filter. Tell me what this prints.`
    );
}

void main();
