"use client";

import { useEffect, useRef } from "react";
import { useAttestation } from "@/lib/useAttestation";
import { AttestationConsole } from "./AttestationConsole";

/**
 * Runs a real FDC attestation from the page, and shows it happening.
 *
 * The wait is deliberately not hidden. An attestation takes a couple of minutes because a voting round has
 * to close and be relayed before a proof exists, and that is the one thing about this product a sceptic
 * cannot dismiss: you can fake a number in a database, but you cannot fake a Flare voting round finalising
 * while someone watches the explorer. So the latency is presented as the evidence rather than apologised for.
 *
 * Measured end to end on Coston2: 116 seconds, of which 83 were waiting for the round to be relayed.
 */

/** A month, fixed by the caller rather than computed inside the jq, which has to be deterministic. */
const MONTH = 30 * 24 * 60 * 60;

/** What the sandbox source attests. A stand-in figure, stated as one. */
const SANDBOX_CENTS = 400_000;

export function ProveRevenue({
    source,
    address,
    isBoundOwner,
    onProven,
}: {
    source: "stripe" | "demo";
    address?: string;
    isBoundOwner: boolean;
    onProven?: () => void;
}) {
    const attestation = useAttestation();
    const announced = useRef(false);

    const running =
        attestation.phase !== "idle" && attestation.phase !== "done" && attestation.phase !== "failed";

    // Tell the page once, so the newly proven period animates in rather than waiting for the next poll.
    useEffect(() => {
        if (attestation.phase === "done" && !announced.current) {
            announced.current = true;
            onProven?.();
        }
        if (attestation.phase === "idle") announced.current = false;
    }, [attestation.phase, onProven]);

    function start() {
        const periodEnd = Math.floor(Date.now() / 1000);
        void attestation.run(
            source === "stripe"
                ? { source: "stripe", periodStart: periodEnd - MONTH, periodEnd }
                : {
                      source: "demo",
                      accountRef: address,
                      revenueCents: SANDBOX_CENTS,
                      periodStart: periodEnd - MONTH,
                      periodEnd,
                  }
        );
    }

    const blocked = source === "stripe" && !isBoundOwner;

    return (
        <div className="block">
            <p style={{ marginBottom: 6 }}>
                {source === "stripe" ? (
                    <>
                        This calls Stripe&apos;s balance transactions API through Flare&apos;s Data Connector and
                        sums what the account earned after fees over the last thirty days.
                    </>
                ) : (
                    <>
                        This runs the identical pipeline — same verifier, same voting round, same Merkle proof, same
                        on-chain verification — against a public keyless endpoint standing in for a payment
                        processor. The attestation is entirely real. The figure it carries, $
                        {(SANDBOX_CENTS / 100).toLocaleString("en-US")}, is a stand-in and is{" "}
                        <strong>not revenue</strong>. Proving it binds the account to your wallet, so you can then
                        borrow against it.
                    </>
                )}
            </p>

            <p className="quiet">
                Expect around two minutes, occasionally four. The request has to land in a 90-second voting round,
                that round has to close and be relayed, and then the Data Availability layer builds the Merkle
                proof. Two wallet signatures: one to submit the request, one to store the verified result.
            </p>

            {blocked ? (
                <p className="alert" style={{ marginBottom: 0 }}>
                    This account is already bound to the wallet that first proved it, so only that wallet can store
                    new periods for it — that guard is in RevenueOracle, not in this page. Switch to{" "}
                    <em>Yours</em> above to run the same attestation against an account you own.
                </p>
            ) : (
                <button className="wide" onClick={start} disabled={running || (source === "demo" && !address)}>
                    {running ? "Attestation running…" : "Run an attestation"}
                </button>
            )}

            <AttestationConsole log={attestation.log} phase={attestation.phase} />

            {attestation.phase === "failed" && attestation.error && (
                <p className="alert" style={{ marginTop: 14, marginBottom: 0 }}>
                    {attestation.error}
                </p>
            )}

            {attestation.phase === "done" && (
                <p className="quiet" style={{ marginTop: 14, marginBottom: 0 }}>
                    Stored. The period is now in the table above, with a proof line naming the round that agreed it.
                </p>
            )}
        </div>
    );
}
