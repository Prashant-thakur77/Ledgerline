"use client";

import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import { ORACLE_ADDRESS, oracleAbi, usd, day } from "@/lib/contracts";
import { ProofLine } from "./ProofLine";

/**
 * The landing page's one live element: a real attested figure, read from chain on load.
 *
 * Everything else on that page is a claim about what the product does. This is the product doing it — and
 * it carries the same proof line as the app itself, so a visitor can check the round and the Merkle root
 * before they have connected anything or trusted anyone.
 */

const PLATFORM = "stripe";
const ACCOUNT_REF = process.env.NEXT_PUBLIC_ACCOUNT_REF ?? "acct_1U2HbaRh1zuX9OfD";

export function LiveProof() {
    const [txHash, setTxHash] = useState<string | undefined>();

    const { data: accountId } = useReadContract({
        address: ORACLE_ADDRESS,
        abi: oracleAbi,
        functionName: "accountIdFor",
        args: [PLATFORM, ACCOUNT_REF],
    });

    const { data: history, isLoading } = useReadContract({
        address: ORACLE_ADDRESS,
        abi: oracleAbi,
        functionName: "revenueHistory",
        args: [accountId!],
        query: { enabled: Boolean(accountId) },
    });

    const newest = history?.[history.length - 1];

    /*
     * Find the transaction that proved it, so the proof line opens the real thing rather than just naming it.
     *
     * Asked of the server route rather than the node directly: Coston2's public RPC refuses an `eth_getLogs`
     * spanning more than 30 blocks, so a browser cannot scan back to the deployment itself.
     */
    useEffect(() => {
        if (!accountId || !newest) return;
        let cancelled = false;
        void (async () => {
            try {
                const found = await fetch(`/api/proofs?accountId=${accountId}`).then((r) => r.json());
                if (!cancelled && found && !found.error) setTxHash(found[String(newest.periodEnd)]);
            } catch {
                /* the proof line still shows the round and root without it */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [accountId, newest]);

    if (isLoading || !newest) {
        return (
            <div className="proofcard">
                <span className="quiet">Reading the latest attested period from Coston2…</span>
                <span className="figure pending">$—</span>
                <span className="unproven">connecting to the contract</span>
            </div>
        );
    }

    return (
        <div className="proofcard">
            <span className="quiet">
                Proven on chain for the period ending {day(newest.periodEnd)} — a real Stripe account, read by
                Flare&apos;s Data Connector
            </span>
            <span className="figure amount">{usd(newest.revenueCents)}</span>
            <ProofLine
                platform={PLATFORM}
                round={newest.votingRound}
                merkleRoot={newest.merkleRoot}
                txHash={txHash}
            />
        </div>
    );
}
