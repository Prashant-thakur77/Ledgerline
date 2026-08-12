"use client";

import { useEffect, useRef } from "react";

/**
 * The pulse line behind the hero: a flat trace that spikes, the way revenue does.
 *
 * One graphic, one metaphor. The product turns a payment processor's pulse into an on-chain fact, so the
 * hero's only image is that pulse — quiet baseline, sharp spikes at irregular intervals, drawn as a single
 * white line at low opacity behind the type. The line scrolls slowly leftward and never repeats exactly.
 *
 * Cheap by construction: one path per frame, no per-point objects, device-pixel-ratio clamped, paused when
 * off-screen or the tab is hidden, and absent entirely under prefers-reduced-motion.
 */
export function PulseLine() {
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

        /*
         * The trace is procedural: a deterministic spike function over a scrolling offset, so there is no
         * buffer to maintain and the line is continuous for ever. Each "beat" is a sharp up-down-overshoot
         * like a cardiogram QRS, spaced irregularly via a hash of the beat index.
         */
        function hash(n: number) {
            const s = Math.sin(n * 127.1) * 43758.5453;
            return s - Math.floor(s);
        }

        function traceY(x: number, baseline: number, amp: number) {
            const SPACING = 340; // nominal px between beats
            const beat = Math.floor(x / SPACING);
            const jitter = (hash(beat) - 0.5) * 120;
            const centre = beat * SPACING + SPACING / 2 + jitter;
            const d = x - centre;
            const w = 26; // beat width in px
            if (Math.abs(d) > w * 3) {
                // quiet baseline with a faint wander
                return baseline + Math.sin(x * 0.011) * 1.6;
            }
            const strength = 0.55 + hash(beat * 7 + 3) * 0.45; // beats vary in size
            const t = d / w;
            // A QRS-ish shape: small dip, tall spike, overshoot, recover.
            const spike =
                -Math.exp(-((t + 1.3) ** 2) * 2.2) * 0.28 +
                Math.exp(-(t ** 2) * 3.2) * 1.0 -
                Math.exp(-((t - 1.25) ** 2) * 2.4) * 0.34;
            return baseline - spike * amp * strength + Math.sin(x * 0.011) * 1.6;
        }

        let offset = 0;

        function frame() {
            if (!running) return;
            ctx!.clearRect(0, 0, width, height);

            const baseline = height * 0.56;
            const amp = Math.min(height * 0.34, 150);

            ctx!.beginPath();
            const STEP = 2;
            for (let px = 0; px <= width; px += STEP) {
                const y = traceY(px + offset, baseline, amp);
                if (px === 0) ctx!.moveTo(px, y);
                else ctx!.lineTo(px, y);
            }
            ctx!.strokeStyle = "rgba(255, 255, 255, 0.34)";
            ctx!.lineWidth = 1.5;
            ctx!.stroke();

            offset += 0.55; // slow leftward scroll
            raf = requestAnimationFrame(frame);
        }

        resize();
        frame();

        const ro = new ResizeObserver(resize);
        ro.observe(canvas);

        // Stop when nothing can be seen.
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
