"use client";

/**
 * The loan's life, as a rail that lights up.
 *
 * Nothing here is stored or guessed: each step is derived from chain state the page already reads, so the
 * rail lights up the moment the fact it describes becomes true — connect, and the first node fills; an
 * attestation lands, and the second follows. The current step pulses in Flare pink.
 *
 * The colour rule survives: completed steps fill in ink, and only "revenue proven" may carry the
 * verification green, because it is the one step a network actually agreed on.
 */

export interface JourneyState {
    connected: boolean;
    /** At least one attested period exists for the account on screen. */
    proven: boolean;
    /** advanceLimitCents > 0 — underwriting has something to work with. */
    underwritten: boolean;
    /** An advance has ever been issued (principal survives after close). */
    advanced: boolean;
    /** Something has been paid back. */
    repaying: boolean;
    /** Nothing outstanding, advance closed. */
    closed: boolean;
}

const STEPS: { key: keyof JourneyState; label: string; detail: string; attested?: boolean }[] = [
    { key: "connected", label: "Connect", detail: "a wallet signs, the site never does" },
    { key: "proven", label: "Prove revenue", detail: "FDC attests the API", attested: true },
    { key: "underwritten", label: "Underwritten", detail: "mean of last 3 periods" },
    { key: "advanced", label: "Advance", detail: "FXRP or real XRP out" },
    { key: "closed", label: "Repaid", detail: "revenue or XRP settles it" },
];

export function Journey(state: JourneyState) {
    // "Repaid" shows progress while repaying and completes when closed.
    const done = (k: keyof JourneyState) => (k === "closed" ? state.closed : state[k]);
    const firstOpen = STEPS.findIndex((s) => !done(s.key));

    return (
        <ol className="journey" aria-label="Where this account is in the loan">
            {STEPS.map((s, i) => {
                const complete = done(s.key);
                const current = i === firstOpen;
                const partial = s.key === "closed" && state.repaying && !state.closed;
                return (
                    <li
                        key={s.key}
                        className={[
                            complete ? "done" : "",
                            current ? "now" : "",
                            complete && s.attested ? "was-attested" : "",
                        ]
                            .filter(Boolean)
                            .join(" ")}
                    >
                        <span className="j-dot" aria-hidden="true">
                            {complete ? "✓" : partial ? "…" : ""}
                        </span>
                        <span className="j-label">{s.label}</span>
                        <span className="j-detail">{s.detail}</span>
                    </li>
                );
            })}
        </ol>
    );
}
