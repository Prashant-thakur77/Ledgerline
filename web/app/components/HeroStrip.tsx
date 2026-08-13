"use client";

import { useEffect, useState } from "react";
import { usd } from "@/lib/contracts";

/**
 * The instrument row under the hero: four live readings, label above value, all mono.
 *
 * Everything here is fetched, not typed in — the price from the FTSOv2 feed the contracts convert at, the
 * attestation count and proven total from the contracts' own events, the block from the RPC. The one static
 * figure is the test count, which is checked against the suite by the claims verifier.
 */

const RPC = "https://coston2-api.flare.network/ext/C/rpc";

export function HeroStrip() {
    const [stats, setStats] = useState<{ attestations: number; provenCents: number } | null>(null);
    const [block, setBlock] = useState<number | null>(null);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const d = await fetch("/api/activity").then((r) => r.json());
                if (!cancelled && !d.error && d.stats) setStats(d.stats);
            } catch {
                /* the strip degrades cell by cell */
            }
        })();
        void (async () => {
            try {
                const r = await fetch(RPC, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
                }).then((x) => x.json());
                if (!cancelled && r.result) setBlock(parseInt(r.result, 16));
            } catch {
                /* same */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <div className="herostrip">
            <div>
                <span className="herostrip-label">Attestations on chain</span>
                <span className="herostrip-value">{stats ? stats.attestations : "…"}</span>
            </div>
            <div>
                <span className="herostrip-label">Revenue proven</span>
                <span className="herostrip-value">{stats ? usd(stats.provenCents) : "…"}</span>
            </div>
            <div>
                <span className="herostrip-label">Coston2 block</span>
                <span className="herostrip-value">{block ? block.toLocaleString("en-US") : "…"}</span>
            </div>
            <div>
                <span className="herostrip-label">Test suite</span>
                <span className="herostrip-value">162 passing</span>
            </div>
        </div>
    );
}
