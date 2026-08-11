"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A figure that counts up the first time it is seen.
 *
 * Only ever used on numbers that are already true — test counts, transaction counts, measured seconds. The
 * animation is a way of drawing the eye, never a way of implying something is happening live. Anything
 * genuinely live on this site carries a proof line instead.
 */
export function Stat({
    value,
    label,
    prefix = "",
    suffix = "",
    decimals = 0,
}: {
    value: number;
    label: string;
    prefix?: string;
    suffix?: string;
    decimals?: number;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [shown, setShown] = useState(0);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const settle = () => setShown(value);

        if (
            typeof IntersectionObserver === "undefined" ||
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
            settle();
            return;
        }

        let raf = 0;
        const io = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting) return;
                io.disconnect();
                const DURATION = 900;
                const start = performance.now();
                const step = (now: number) => {
                    const t = Math.min((now - start) / DURATION, 1);
                    // easeOutExpo: quick to near-final, then settles. Reads as decisive rather than slow.
                    const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
                    setShown(value * eased);
                    if (t < 1) raf = requestAnimationFrame(step);
                };
                raf = requestAnimationFrame(step);
            },
            { threshold: 0.4 }
        );
        io.observe(el);
        return () => {
            io.disconnect();
            cancelAnimationFrame(raf);
        };
    }, [value]);

    return (
        <div className="stat" ref={ref}>
            <span className="stat-value">
                {prefix}
                {shown.toLocaleString("en-US", {
                    minimumFractionDigits: decimals,
                    maximumFractionDigits: decimals,
                })}
                {suffix}
            </span>
            <span className="stat-label">{label}</span>
        </div>
    );
}
