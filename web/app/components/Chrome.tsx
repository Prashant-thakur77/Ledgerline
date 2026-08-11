"use client";

import Image from "next/image";

/**
 * Small shared furniture: the Flare attribution, the protocol ticker, and the grain overlay.
 */

/**
 * "Built on Flare", using Flare's own logo.
 *
 * Their mark, used to say which network this runs on — which is what it is for. It is not placed anywhere
 * that could imply Flare endorses or audited this; it sits next to our own name, not in place of it.
 */
export function FlareBadge({ compact = false }: { compact?: boolean }) {
    return (
        <a
            className={`flarebadge${compact ? " compact" : ""}`}
            href="https://flare.network"
            target="_blank"
            rel="noreferrer"
        >
            <span className="flarebadge-label">Built on</span>
            <Image src="/flare-logo.svg" alt="Flare" width={72} height={18} priority />
        </a>
    );
}

/**
 * The four protocol calls this product actually makes, scrolling past.
 *
 * Every entry is load-bearing — remove any one and the product stops working — so this is a summary rather
 * than a logo wall. Duplicated once because a marquee needs two copies to loop without a seam.
 */
const RAIL = [
    "FDC · Web2Json",
    "FDC · Payment",
    "FTSOv2 · XRP/USD",
    "FAssets · FXRP",
    "XRP Ledger",
    "Coston2",
];

export function Marquee() {
    return (
        <div className="marquee" aria-hidden="true">
            <div className="marquee-track">
                {[...RAIL, ...RAIL].map((item, i) => (
                    <span key={i} className="marquee-item">
                        {item}
                    </span>
                ))}
            </div>
        </div>
    );
}

/** A film of noise over the whole page, so the large dark areas have texture instead of banding. */
export function Grain() {
    return <div className="grain" aria-hidden="true" />;
}
