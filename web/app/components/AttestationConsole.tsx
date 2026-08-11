"use client";

import { useEffect, useRef, useState } from "react";
import type { LogLine, Phase } from "@/lib/useAttestation";

/**
 * The live attestation log.
 *
 * An FDC attestation takes a couple of minutes. Every project that uses FDC hides that behind a spinner;
 * hiding it is what makes an oracle look like a database call. Printing it — the round it landed in, how
 * many rounds have passed since, the Merkle root the moment it is relayed, each with a link a judge can
 * open while it is still happening — turns the latency into the argument. Nothing here is simulated.
 */

const RUNNING: Phase[] = ["composing", "awaiting-request-signature", "in-round", "finalising", "retrieving-proof", "awaiting-store-signature"];

function Countdown({ to }: { to: number }) {
    const [left, setLeft] = useState(() => Math.max(0, to - Math.floor(Date.now() / 1000)));
    useEffect(() => {
        const t = setInterval(() => setLeft(Math.max(0, to - Math.floor(Date.now() / 1000))), 1000);
        return () => clearInterval(t);
    }, [to]);
    return <span>{left > 0 ? `${left}s` : "closed"}</span>;
}

export function AttestationConsole({ log, phase }: { log: LogLine[]; phase: Phase }) {
    const box = useRef<HTMLDivElement>(null);
    const running = RUNNING.includes(phase);

    // Follow the tail, the way a terminal does.
    useEffect(() => {
        const el = box.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [log.length]);

    if (log.length === 0) return null;

    return (
        <>
            <div className="console" ref={box} role="log" aria-live="polite" aria-label="Attestation progress">
                {log.map((line, i) => {
                    const last = i === log.length - 1;
                    const body = (
                        <>
                            {line.text}
                            {line.countdownTo !== undefined && (
                                <>
                                    {" "}
                                    <Countdown to={line.countdownTo} />
                                </>
                            )}
                            {line.href && " ↗"}
                        </>
                    );
                    return (
                        <div key={line.id} className={`console-line tone-${line.tone}`}>
                            <span className="tick" aria-hidden="true">
                                {line.tone === "proof" ? "✓" : "·"}
                            </span>
                            <span className={`said${last && running ? " caret" : ""}`}>
                                {line.href ? (
                                    <a href={line.href} target="_blank" rel="noreferrer">
                                        {body}
                                    </a>
                                ) : (
                                    body
                                )}
                            </span>
                        </div>
                    );
                })}
            </div>
            {running && (
                <div className="progress indeterminate" aria-hidden="true">
                    <i />
                </div>
            )}
        </>
    );
}
