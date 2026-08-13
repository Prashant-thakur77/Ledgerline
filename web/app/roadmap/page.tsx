import Link from "next/link";
import type { Metadata } from "next";
import { Grain, SiteHeader } from "../components/Chrome";

export const metadata: Metadata = {
    title: "Roadmap · Proofline",
    description:
        "Every shortcoming mapped to the mechanism the incumbent industry uses, in three phases: what is live, what ships next, and what production costs.",
};

const REPO = "https://github.com/Prashant-thakur77/Ledgerline";
const EXPLORER = "https://coston2-explorer.flare.network";

/**
 * The roadmap, as phases with statuses rather than promises.
 *
 * This page exists because the plan behind it is unusual: every item was researched against the industry
 * that already runs this business (processor-lenders, MCA funders, on-chain credit), so each entry names a
 * mechanism that demonstrably works somewhere, not an ambition. Phase A is live and linked to its own
 * evidence; B and C carry their honest costs.
 */

const PHASE_A = [
    {
        h: "Deduction at source",
        p: "A RevenueSplitter lockbox: settlements split atomically on arrival, the share to the debt, the rest forwarded. Springs to 100% withholding while an account is delinquent or behind its floor; relaxes on cure. The mechanism behind Stripe and Shopify Capital's loss rates, without being the processor.",
        tx: "0x3dd05b9d8b1a02bf930cec3a3747f03c1b866e74412df425c23be87f11c0f242",
    },
    {
        h: "The rolling reserve",
        p: "10% of each advance escrowed at disbursement, the way an acquirer holds a merchant's money: released once the 120-day refund window passes or the advance closes clean, consumed first on a write-off so depositors' loss shrinks by exactly the held-back amount.",
        tx: "0x076f1d982f6a59fce956926e0ba4a03d7635c0242fc9173e6cc275cf2e727ed2",
    },
    {
        h: "Age-weighted underwriting",
        p: "Settled card revenue is not final money for ~120 days. A period inside the refund window counts 50 to 100% by age, so revenue proven this morning underwrites at half weight. Visible in the live advance: a fresh $3,916.78 period underwritten as $1,958.39.",
        tx: "0x4744fb8c05d33e9e844b879276c74a4bc62e72ab184d3c94e31e2d96ab5a4e4e",
    },
    {
        h: "The repayment floor",
        p: "Stripe Capital's minimum-payment true-up as a covenant: 30% of the obligation repaid by half-term, or anyone may declare the account behind, which springs the splitter rather than accelerating a balance. Self-cures the moment repayment catches up.",
    },
    {
        h: "Velocity brakes and the keeper's tip",
        p: "Originations capped per epoch, so a coordinated wave of fresh accounts is bounded to one day's quota. Reporting a delinquency pays a flat tip from a fundable reserve, and a checkUpkeep-shaped view lets any bot find the work.",
    },
    {
        h: "The guardian's asymmetry",
        p: "Policy sits behind a public timelock; a guardian can pause originations instantly but can never unpause. An exploit response no longer waits out its own governance delay, and a compromised guardian can only ever stop the protocol, never steer it.",
    },
];

const PHASE_B = [
    {
        h: "Identity as the unit of exposure",
        p: "KYB with beneficial-owner resolution (Middesk-class): one credential per verified entity, and an aggregate cap per owner across all their entities. The direct answer to one person farming many cold-start accounts.",
    },
    {
        h: "The second witness",
        p: "Open-banking cash flow (Plaid-class) as an independently attested source, with the reconciliation rule on chain: underwrite on the minimum of processor revenue and bank inflows. Then the Shopify payouts adapter, the same pattern as Stripe.",
    },
    {
        h: "Hardware attestation",
        p: "The trusted-execution (TEE) path moves from the simulated platform to confidential VMs (~$150 a month, not a data centre). Prerequisite first: a reproducible TypeScript build, so any auditor can confirm the registered code measurement independently.",
    },
    {
        h: "Currency-matched vaults",
        p: "The first rule of bank treasury: never fund an asset in currency A with a liability in currency B. A stablecoin vault funds dollar-denominated advances swapped at execution; the FXRP vault funds XRP-native ones. LPs choose their exposure instead of holding a mixed book.",
    },
];

const PHASE_C = [
    {
        h: "The purchase, on paper",
        p: "Each advance executed as a receivables purchase agreement, hash committed on chain. Mechanical revenue share is a stronger reconciliation fact pattern than the industry's own paper, which courts already uphold.",
    },
    {
        h: "The wrapper",
        p: "A Delaware series LLC per pool (the Centrifuge pattern): the series is the legal purchaser with standing to recover, senior and junior tranches as its two membership classes, LP access gated by verified accreditation in the US and geofenced elsewhere.",
    },
    {
        h: "Disclosure by construction",
        p: "Ten US states require TILA-like commercial financing disclosures. Ours render deterministically from on-chain terms: the estimated APR is computed from the same projection the underwriting already produces, e-signed, hash on chain.",
    },
    {
        h: "The bank partnership",
        p: "The scale path the incumbents use: a sponsor bank originates, the on-chain pool purchases the receivable as a forward-flow buyer, and FDC-attested revenue drives servicing. Months of negotiation and real money, named as such.",
    },
];

function PhaseSection({
    eyebrow,
    title,
    items,
    tone,
}: {
    eyebrow: string;
    title: React.ReactNode;
    items: { h: string; p: string; tx?: string }[];
    tone?: string;
}) {
    return (
        <section>
            <div className="shell">
                <p className="eyebrow">{eyebrow}</p>
                <h2>{title}</h2>
                {tone && <p className="narrow">{tone}</p>}
                <div className="cards" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
                    {items.map((it, i) => (
                        <div className="card" key={it.h}>
                            <span className="card-n">{String(i + 1).padStart(2, "0")}</span>
                            <h3>{it.h}</h3>
                            <p>{it.p}</p>
                            {it.tx && (
                                <p style={{ marginBottom: 0 }}>
                                    <a
                                        className="mono"
                                        href={`${EXPLORER}/tx/${it.tx}`}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        live evidence ↗
                                    </a>
                                </p>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

export default function Roadmap() {
    return (
        <>
            <Grain />
            <SiteHeader />

            <main className="landing">
                <section>
                    <div className="shell">
                        <p className="eyebrow">Roadmap</p>
                        <h1>
                            Nothing here
                            <br />
                            <span className="grad">is invented.</span>
                        </h1>
                        <p className="lede narrow">
                            Every open shortcoming was researched against the industry that already runs
                            this business: the processor-lenders, the merchant-cash-advance funders, the
                            on-chain credit protocols. Each roadmap item names a mechanism that demonstrably
                            works somewhere. The plan is sequencing, not invention, and the full research is{" "}
                            <a
                                href={`${REPO}/blob/main/docs/REALWORLD-PLAN.md`}
                                target="_blank"
                                rel="noreferrer"
                            >
                                in the repository
                            </a>
                            .
                        </p>
                    </div>
                </section>

                <PhaseSection
                    eyebrow="Phase A · live on Coston2 now"
                    title={<>Shipped, and already exercised</>}
                    tone="Protocol code only: no vendors, no partners. Deployed as the current generation and run end to end the same day, each mechanism with its transaction."
                    items={PHASE_A}
                />

                <PhaseSection
                    eyebrow="Phase B · next ninety days"
                    title={<>Vendors and operations</>}
                    tone="Off-the-shelf pieces the incumbents already buy, wired into the attestation pipeline. Low cost, no protocol redesign."
                    items={PHASE_B}
                />

                <PhaseSection
                    eyebrow="Phase C · production"
                    title={<>Legal, and scale</>}
                    tone="The parts no contract can do: paper, wrappers, licensing, and the bank relationship. Real money and real months, priced honestly in the plan."
                    items={PHASE_C}
                />

                <section>
                    <div className="shell">
                        <p className="eyebrow">The through-line</p>
                        <h2>Replicable with less trust, or purchasable off the shelf</h2>
                        <p className="narrow">
                            The research kept confirming one thing: every mechanism the incumbents use to
                            control risk is either replicable on chain with less trust or purchasable off
                            the shelf. Lockboxes without the banking-day delay, lien registries without the
                            filing lag, reconciliation without the lawsuit. What remains is sequencing, and
                            the sequence is above.
                        </p>
                    </div>
                </section>
            </main>
        </>
    );
}
