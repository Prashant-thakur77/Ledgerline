"use client";

import { useEffect, useRef } from "react";

/**
 * The hero graphic: a revenue step-line being proven, month by month.
 *
 * This is the product drawn literally. Revenue arrives as monthly steps of varying height — the way it
 * looks on a payment processor's dashboard — and at each period boundary a small check is set above the
 * line: the attestation that seals that month. A flat pulse belongs to a heart monitor; this line belongs
 * to a ledger.
 *
 * Cheap by construction: one path per frame from a deterministic hash (no state to maintain, never
 * repeats), device-pixel-ratio clamped, paused when hidden or off-screen, absent under reduced motion.
 */
export function RevenueLine() {
    const ref = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

        const ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) return;

        let width = 0;
        let height = 0;
        let raf = 0;
        let running = true;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        function resize() {
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            width = rect.width;
            height = rect.height;
            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
            ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        /** Deterministic per-month randomness, so the line is continuous forever without a buffer. */
        function hash(n: number) {
            const s = Math.sin(n * 127.1) * 43758.5453;
            return s - Math.floor(s);
        }

        const MONTH_PX = 220; // one period on screen

        /** The revenue level for a given month index: a plausible business, drifting and seasonal. */
        function level(month: number, baseline: number, amp: number) {
            const trend = Math.sin(month * 0.23) * 0.35; // slow seasons
            const noise = (hash(month) - 0.5) * 0.9; // month-to-month scatter
            return baseline - (0.35 + trend + noise * 0.5) * amp;
        }

        let offset = 0;

        function frame() {
            if (!running) return;
            ctx!.clearRect(0, 0, width, height);

            const baseline = height * 0.72;
            const amp = Math.min(height * 0.38, 170);

            const firstMonth = Math.floor(offset / MONTH_PX);
            const months = Math.ceil(width / MONTH_PX) + 2;

            /*
             * The step line. Horizontal run per month, small vertical riser at each boundary — a step
             * chart, not a heartbeat. Drawn first so the ticks sit on top of it.
             */
            ctx!.beginPath();
            for (let m = firstMonth; m < firstMonth + months; m++) {
                const x0 = m * MONTH_PX - offset;
                const x1 = x0 + MONTH_PX;
                const y = level(m, baseline, amp);
                if (m === firstMonth) ctx!.moveTo(x0, y);
                else ctx!.lineTo(x0, y); // riser from the previous month's level
                ctx!.lineTo(x1, y);
            }
            ctx!.strokeStyle = "rgba(255, 255, 255, 0.30)";
            ctx!.lineWidth = 1.5;
            ctx!.stroke();

            for (let m = firstMonth; m < firstMonth + months; m++) {
                const xEnd = (m + 1) * MONTH_PX - offset;
                if (xEnd < -20 || xEnd > width + 20) continue;
                const y = level(m, baseline, amp);

                // Period boundary: a hairline down to the ground, the way a chart marks its axis.
                ctx!.beginPath();
                ctx!.moveTo(xEnd, y + 6);
                ctx!.lineTo(xEnd, baseline + 26);
                ctx!.strokeStyle = "rgba(255, 255, 255, 0.08)";
                ctx!.lineWidth = 1;
                ctx!.stroke();

                // The attestation: a small check set above the month it seals.
                const cx = xEnd - MONTH_PX / 2;
                const cy = y - 18;
                ctx!.beginPath();
                ctx!.moveTo(cx - 5, cy);
                ctx!.lineTo(cx - 1, cy + 4);
                ctx!.lineTo(cx + 6, cy - 5);
                ctx!.strokeStyle = "rgba(255, 255, 255, 0.5)";
                ctx!.lineWidth = 1.5;
                ctx!.stroke();
            }

            offset += 0.45; // slow leftward drift
            raf = requestAnimationFrame(frame);
        }

        resize();
        frame();

        const ro = new ResizeObserver(resize);
        ro.observe(canvas);

        const io = new IntersectionObserver(([entry]) => {
            const visible = entry.isIntersecting && document.visibilityState === "visible";
            if (visible && !running) {
                running = true;
                frame();
            } else if (!visible) {
                running = false;
                cancelAnimationFrame(raf);
            }
        });
        io.observe(canvas);
        const onVis = () => {
            if (document.visibilityState === "hidden") {
                running = false;
                cancelAnimationFrame(raf);
            } else if (!running) {
                running = true;
                frame();
            }
        };
        document.addEventListener("visibilitychange", onVis);

        return () => {
            running = false;
            cancelAnimationFrame(raf);
            ro.disconnect();
            io.disconnect();
            document.removeEventListener("visibilitychange", onVis);
        };
    }, []);

    return <canvas ref={ref} className="pulseline" aria-hidden="true" />;
}
