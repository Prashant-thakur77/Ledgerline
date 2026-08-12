"use client";

import Image from "next/image";
import { useEffect } from "react";

/**
 * Small shared furniture: the mark, the Flare attribution, the protocol ticker, and the grain overlay.
 */

/**
 * The Proofline mark: a line that resolves into a check and continues at a higher level.
 *
 * Read left to right it is the product — revenue running flat, the moment it is proven, and the borrowing
 * power that exists afterwards because of it. One stroke, so it survives at favicon size, and monochrome,
 * so it obeys the same palette as everything else.
 */
export function Mark({ size = 22 }: { size?: number }) {
    return (
        <svg
            width={size}
            height={(size * 32) / 48}
            viewBox="0 0 48 32"
            fill="none"
            aria-hidden="true"
            className="mark"
        >
            <path
                d="M2 22 L14 22 L20 28 L31 9 L46 9"
                stroke="currentColor"
                strokeWidth="3.6"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

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

/** A hairline of the brand gradient tracking scroll depth. Passive listener, transform-only. */
export function ScrollProgress() {
    useEffect(() => {
        const onScroll = () => {
            const max = document.documentElement.scrollHeight - window.innerHeight;
            const p = max > 0 ? window.scrollY / max : 0;
            document.documentElement.style.setProperty("--scroll-p", String(Math.min(p, 1)));
        };
        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);
    return <div className="scrollbar-progress" aria-hidden="true" />;
}

/** Two slow washes of the brand gradient drifting behind the hero, under the particles. Pure CSS. */
export function Aurora() {
    return <div className="aurora" aria-hidden="true" />;
}

/** A card grid whose hover spotlight follows the cursor. One delegated handler, CSS does the rest. */
export function CardGrid({ children }: { children: React.ReactNode }) {
    return (
        <div
            className="cards"
            onMouseMove={(e) => {
                const card = (e.target as HTMLElement).closest?.(".card") as HTMLElement | null;
                if (!card) return;
                const r = card.getBoundingClientRect();
                card.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
                card.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
            }}
        >
            {children}
        </div>
    );
}

/** A headline whose words rise out of a clipped line, staggered left to right. */
export function MaskedWords({ text, grad = "" }: { text: string; grad?: string }) {
    const words = text.split(" ");
    const gradWords = grad ? grad.split(" ") : [];
    const gradStart = grad ? words.length - gradWords.length : words.length;
    return (
        <>
            {words.map((w, i) => (
                <span key={i} className="mask">
                    <span
                        className={`mask-in${i >= gradStart ? " grad" : ""}`}
                        style={{ animationDelay: `${80 + i * 70}ms` }}
                    >
                        {w}
                    </span>
                    {i < words.length - 1 ? " " : ""}
                </span>
            ))}
        </>
    );
}
