"use client";

/**
 * How the number gets from a payment processor to a payout, in the order it actually happens.
 *
 * Built as a document rather than a picture: it reflows on a phone, it is readable by a screen reader, and
 * it can name the exact Flare protocol doing the work at each stage. A judge reading this should be able to
 * tell within a few seconds which parts are Flare and whether they are load-bearing.
 */

interface Stage {
    title: string;
    detail: string;
    /** The Flare protocol carrying this stage, if any. */
    flare?: string;
    /** True where the network has agreed on something — the only places green is allowed. */
    attested?: boolean;
}

const STAGES: Stage[] = [
    {
        title: "Stripe",
        detail: "The figure that already exists and that no lender can read. Balance transactions, summed after fees.",
    },
    {
        title: "Flare Data Connector",
        detail: "Every data provider calls the same API, runs the same jq reduction, and has to agree on the answer. No single server vouches for it.",
        flare: "FDC · Web2Json",
    },
    {
        title: "A voting round agrees",
        detail: "The round finalises and the Relay publishes a Merkle root. From here the figure is checkable by anyone, without asking us.",
        flare: "FDC · Relay",
        attested: true,
    },
    {
        title: "RevenueOracle",
        detail: "Verifies the proof on chain, derives the account from the attested payload rather than from what the caller claims, and stores the period.",
        flare: "FDC verification",
        attested: true,
    },
    {
        title: "AdvanceManager",
        detail: "Underwrites the mean of the last three proven periods. The debt is denominated in US dollars, so it does not move when XRP does.",
        flare: "FTSOv2 · XRP/USD",
    },
    {
        title: "The money arrives",
        detail: "FXRP on Flare, or real XRP on the XRP Ledger — redeemed through FAssets so an agent pays the borrower's XRPL account directly.",
        flare: "FAssets · FXRP",
    },
    {
        title: "Revenue repays it",
        detail: "Each newly proven period repays a fixed share of itself. Nobody has to remember to pay; a proven period is the trigger.",
        flare: "FDC · FTSOv2",
    },
];

export function Mechanism() {
    return (
        <ol className="mechanism">
            {STAGES.map((s) => (
                <li key={s.title} className={s.attested ? "attested" : undefined}>
                    <span className="node" aria-hidden="true">
                        {s.attested ? "✓" : "•"}
                    </span>
                    <div className="stage">
                        <span className="stage-title">
                            {s.title}
                            {s.flare && <span className="stage-flare">{s.flare}</span>}
                        </span>
                        <span className="stage-detail">{s.detail}</span>
                    </div>
                </li>
            ))}
        </ol>
    );
}
