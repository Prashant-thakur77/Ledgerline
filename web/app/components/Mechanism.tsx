"use client";

import { useEffect, useRef, useState } from "react";

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
        detail: "FXRP on Flare, or real XRP on the XRP Ledger, redeemed through FAssets so an agent pays the borrower's XRPL account directly.",
        flare: "FAssets · FXRP",
    },
    {
        title: "Revenue repays it",
        detail: "Each newly proven period repays a fixed share of itself. Nobody has to remember to pay; a proven period is the trigger.",
        flare: "FDC · FTSOv2",
    },
    {
        title: "Or the borrower repays in XRP",
        detail: "A plain XRP payment, carrying the account id in its memo, proven on Flare by a second FDC attestation type. Funded in real XRP, repaid in real XRP. The obligation never leaves Flare, and the borrower never needs an EVM asset in either direction.",
        flare: "FDC · Payment",
        attested: true,
    },
];

export function Mechanism() {
    const ref = useRef<HTMLOListElement>(null);
    const [current, setCurrent] = useState(-1);

    /*
     * Scroll-telling: the step nearest the reader's centre wakes, the rest sleep. IntersectionObserver
     * with a narrow band around the viewport middle, so exactly one step is "current" at a time.
     */
    useEffect(() => {
        const root = ref.current;
        if (!root) return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            setCurrent(-2); // sentinel: everything stays fully visible
            return;
        }
        const items = Array.from(root.querySelectorAll("li"));
        const io = new IntersectionObserver(
            (entries) => {
                for (const e of entries) {
                    if (e.isIntersecting) setCurrent(items.indexOf(e.target as HTMLLIElement));
                }
            },
            { rootMargin: "-42% 0px -42% 0px", threshold: 0 }
        );
        items.forEach((li) => io.observe(li));
        return () => io.disconnect();
    }, []);

    return (
        <ol className="mechanism" ref={ref}>
            {STAGES.map((s, i) => (
                <li key={s.title} className={[s.attested ? "attested" : "", current === -2 || current === i ? "current" : ""].filter(Boolean).join(" ") || undefined}>
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
