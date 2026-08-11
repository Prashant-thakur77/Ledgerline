"use client";

import { EXPLORER } from "@/lib/contracts";

/**
 * The signature element. Under every attested figure, and under nothing else.
 *
 * It names where the fact came from, which FDC voting round agreed on it, and the Merkle root it resolves
 * to — then opens the transaction that verified it. A reader who does not trust us can check every one of
 * those against Flare's own explorers without asking us anything, which is the entire claim of the product
 * compressed into one line.
 */

const SOURCE_LABEL: Record<string, string> = {
    stripe: "stripe balance transactions",
    demo: "sandbox source, not revenue",
};

export function short(hash: string) {
    return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

export function ProofLine({
    platform,
    round,
    merkleRoot,
    txHash,
}: {
    platform: string;
    round: bigint;
    merkleRoot: string;
    txHash?: string;
}) {
    const body = (
        <>
            verified<span className="sep">·</span>
            {SOURCE_LABEL[platform] ?? platform}
            <span className="sep">·</span>fdc round {round.toLocaleString("en-US")}
            <span className="sep">·</span>merkle {short(merkleRoot)}
            {txHash ? " ↗" : ""}
        </>
    );

    return txHash ? (
        <a className="proof" href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">
            {body}
        </a>
    ) : (
        <span className="proof">{body}</span>
    );
}
