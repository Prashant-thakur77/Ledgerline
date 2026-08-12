"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A pointer-tracked 3D tilt with a moving glare, for exactly one element per page.
 *
 * Rationed on purpose: tilt everything and nothing reads as special; tilt only the live proof card and
 * the one element that is genuinely alive is the one that responds to you. Transform-only (rotateX/Y on a
 * perspective parent), springs back on leave, and inert on touch devices and under reduced motion —
 * a tilt you cannot control from a phone is just wobble.
 */
export function Tilt({ children, max = 7 }: { children: ReactNode; max?: number }) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

        let raf = 0;
        let targetX = 0, targetY = 0, curX = 0, curY = 0, glareX = 50, glareY = 50;

        const animate = () => {
            curX += (targetX - curX) * 0.12;
            curY += (targetY - curY) * 0.12;
            el.style.transform = `perspective(900px) rotateX(${curY}deg) rotateY(${curX}deg)`;
            el.style.setProperty("--glare-x", `${glareX}%`);
            el.style.setProperty("--glare-y", `${glareY}%`);
            if (Math.abs(targetX - curX) > 0.01 || Math.abs(targetY - curY) > 0.01) {
                raf = requestAnimationFrame(animate);
            }
        };

        const onMove = (e: PointerEvent) => {
            const r = el.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width;
            const py = (e.clientY - r.top) / r.height;
            targetX = (px - 0.5) * 2 * max;
            targetY = -(py - 0.5) * 2 * max;
            glareX = px * 100;
            glareY = py * 100;
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(animate);
        };

        const onLeave = () => {
            targetX = 0;
            targetY = 0;
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(animate);
        };

        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerleave", onLeave);
        return () => {
            el.removeEventListener("pointermove", onMove);
            el.removeEventListener("pointerleave", onLeave);
            cancelAnimationFrame(raf);
        };
    }, [max]);

    return (
        <div ref={ref} className="tilt">
            {children}
        </div>
    );
}
