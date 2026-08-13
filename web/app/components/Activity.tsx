"use client";

import { useEffect, useState } from "react";
import { EXPLORER, XRPL_EXPLORER, usd, fxrp } from "@/lib/contracts";

/**
 * The protocol strip and the account timeline.
 *
 * Both are built entirely from events the contracts emitted — there is no database anywhere in this
 * product, and these are the numbers that would be easiest to fake if there were. Anything shown here can
 * be reproduced by anyone with the contract addresses and a log index.
 *
 * The colour rule holds: green marks the two things a network agreed on — a revenue attestation, and an
 * XRPL repayment proven by FDC. Everything else is an ordinary contract call and stays in ink.
 */

interface Stats {
    accounts: number;
    attestations: number;
    provenCents: number;
    advances: number;
    advancedCents: number;
    repaidCents: number;
    events: number;
}

interface Event {
    kind: string;
    tx: string;
    block: number;
    at: number;
    data: Record<string, string>;
    xrplTx?: string;
}

function useActivity(accountId?: string) {
    const [stats, setStats] = useState<Stats | null>(null);
    const [events, setEvents] = useState<Event[] | null>(null);

    useEffect(() => {
        let cancelled = false;
        const url = accountId ? `/api/activity?accountId=${accountId}` : "/api/activity";
        void (async () => {
            try {
                const d = await fetch(url).then((r) => r.json());
                if (cancelled || d.error) return;
                setStats(d.stats ?? null);
                setEvents(d.events ?? null);
            } catch {
                /* the rest of the page does not depend on this */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [accountId]);

    return { stats, events };
}

/** Four numbers, so the app opens on evidence that it has been used rather than on an empty form. */
export function ProtocolStrip() {
    const { stats } = useActivity();
    if (!stats) return null;

    return (
        <div className="strip">
            <div className="strip-cell">
                <span className="strip-value">{stats.attestations}</span>
                <span className="strip-label">attestations on chain</span>
            </div>
            <div className="strip-cell">
                <span className="strip-value">{usd(stats.provenCents)}</span>
                <span className="strip-label">revenue proven</span>
            </div>
            <div className="strip-cell">
                <span className="strip-value">{usd(stats.advancedCents)}</span>
                <span className="strip-label">advanced</span>
            </div>
            <div className="strip-cell">
                <span className="strip-value">{usd(stats.repaidCents)}</span>
                <span className="strip-label">repaid</span>
            </div>
        </div>
    );
}

function when(at: number) {
    if (!at) return "";
    return new Date(at * 1000).toISOString().slice(0, 10);
}

/** One line of plain English per event, plus whether it is something a network agreed on. */
function describe(e: Event): { text: string; attested: boolean } {
    const d = e.data;
    switch (e.kind) {
        case "bound":
            return {
                text: `Account bound to this wallet · ${d.platform ?? "unknown platform"}`,
                attested: false,
            };
        case "proven":
            return {
                text: `Revenue proven · ${usd(Number(d.revenueCents))} for the period ending ${when(
                    Number(d.periodEnd)
                )} · FDC round ${Number(d.votingRound).toLocaleString("en-US")}`,
                attested: true,
            };
        case "advance":
            return {
                text: `Advance issued · ${usd(Number(d.principalCents))} principal, ${usd(
                    Number(d.feeCents)
                )} fee, ${fxrp(BigInt(d.fxrpAmount ?? "0"))} FXRP`,
                attested: false,
            };
        case "advance-xrpl":
            return {
                text: `Redeemed through FAssets · ${d.lots} lot${d.lots === "1" ? "" : "s"} to ${
                    d.xrplAddress ?? "an XRPL account"
                }`,
                attested: false,
            };
        case "repaid":
            return {
                text: `Repaid ${usd(Number(d.usdCents))} ${
                    d.automatic === "true" ? "automatically, from a newly proven period" : "by hand"
                } · ${usd(Number(d.outstandingCents))} still owed`,
                attested: false,
            };
        case "repaid-xrpl":
            return {
                text: `Repaid from the XRP Ledger · ${
                    Number(d.drops) / 1e6
                } XRP proven by FDC, worth ${usd(Number(d.usdCents))} · ${usd(
                    Number(d.outstandingCents)
                )} still owed`,
                attested: true,
            };
        case "closed":
            return { text: "Advance closed · nothing outstanding", attested: false };
        default:
            return { text: e.kind, attested: false };
    }
}

export function ActivityFeed({ accountId }: { accountId?: string }) {
    const { events } = useActivity(accountId);

    if (!accountId) return null;
    if (events === null) {
        return (
            <div className="block">
                <p className="quiet" style={{ margin: 0 }}>
                    Reading this account&apos;s history from the chain…
                </p>
            </div>
        );
    }
    if (events.length === 0) {
        return (
            <div className="block">
                <p className="quiet" style={{ margin: 0 }}>
                    Nothing yet. Prove a period above and it appears here: every attestation, advance and
                    repayment this account has ever made, read back from the contracts&apos; own events.
                </p>
            </div>
        );
    }

    /*
     * An XRPL advance emits both AdvanceIssued and AdvanceDisbursedToXrpl in one transaction. Showing both
     * would read as two separate advances, so the FAssets line is folded into the one above it.
     */
    const shown = events.filter(
        (e) => !(e.kind === "advance" && events.some((o) => o.kind === "advance-xrpl" && o.tx === e.tx))
    );

    return (
        <ol className="feed">
            {shown.map((e, i) => {
                const { text, attested } = describe(e);
                return (
                    <li key={`${e.tx}-${e.kind}-${i}`} className={attested ? "attested" : undefined}>
                        <span className="feed-node" aria-hidden="true">
                            {attested ? "✓" : "•"}
                        </span>
                        <div className="feed-body">
                            <span className="feed-text">{text}</span>
                            <span className="feed-meta">
                                <span className="mono">{when(e.at)}</span>
                                <a href={`${EXPLORER}/tx/${e.tx}`} target="_blank" rel="noreferrer">
                                    {e.tx.slice(0, 10)}… ↗
                                </a>
                                {e.xrplTx && (
                                    <a
                                        href={`${XRPL_EXPLORER}/transactions/${e.xrplTx.slice(2).toUpperCase()}`}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        on the XRP Ledger ↗
                                    </a>
                                )}
                            </span>
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}
