"use client";

import { useEffect, useRef } from "react";

/**
 * The hero field: a terrain of points, rolling.
 *
 * A perspective grid of a few thousand dots undulating like a surface of revenue — depth-lit, so near
 * points are bright and the horizon dissolves into the black — with a crimson sweep that washes from the
 * horizon to the foreground every few seconds: the proving pass, moving over the ledger. One colour, one
 * accent, no gradients anywhere else.
 *
 * Cheap by construction: ~1,600 points per frame with no allocation in the loop, DPR clamped, paused when
 * hidden or off-screen. Under reduced motion it draws a single static frame instead of animating.
 */
export function WaveField() {
    const ref = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) return;

        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        let width = 0;
        let height = 0;
        let raf = 0;
        let running = true;
        let t = 0;

        /*
         * The cursor as a presence over the landscape. Raw position updates on pointermove; the smoothed
         * position and the influence strength both glide on springs, so the swell arrives and leaves like
         * weather rather than snapping. Idle costs nothing: strength decays to zero and the bump is skipped.
         */
        const hover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
        let mx = -1e4;
        let my = -1e4;
        let smx = -1e4;
        let smy = -1e4;
        let strengthTarget = 0;
        let strength = 0;

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

        /** Deterministic per-point shimmer, so the surface has grain without a noise texture. */
        function hash(n: number) {
            const s = Math.sin(n * 127.1) * 43758.5453;
            return s - Math.floor(s);
        }

        const COLS = 96;
        const ROWS = 24;
        const Z_NEAR = 0.6;
        const Z_FAR = 4.6;
        const SWEEP_PERIOD = 7.5; // seconds per proving pass

        const SIGMA = 150; // screen-px radius of the cursor's influence
        const SIGMA2 = 2 * SIGMA * SIGMA;

        /** How strongly the cursor bears on a screen point: a gaussian of screen distance, times the spring. */
        function influence(sx: number, sy: number) {
            if (strength < 0.01) return 0;
            const dx = sx - smx;
            const dy = sy - smy;
            return Math.exp(-(dx * dx + dy * dy) / SIGMA2) * strength;
        }

        /** Surface height for a model-space (x, z) at time t. */
        function surface(x: number, z: number, grain: number) {
            return (
                (Math.sin(x * 1.35 + t * 0.55 + z * 1.15) * 0.55 +
                    Math.sin(x * 0.55 - t * 0.32 + z * 2.1) * 0.34 +
                    Math.sin(x * 2.7 + t * 0.9 - z * 0.7) * 0.14 +
                    grain * 0.08) *
                (0.5 + 0.55 * (z / Z_FAR))
            );
        }

        function frame() {
            if (!running) return;
            ctx!.clearRect(0, 0, width, height);

            const focal = width * 0.52;
            const horizonY = height * 0.4;
            const cx = width * 0.5;

            /*
             * The crimson pass: a band in depth that travels from the horizon to the viewer, rests, and
             * goes again. Ease-in-out so it arrives like a tide rather than a scanline.
             */
            // The cursor springs: position chases the pointer, strength fades in and out.
            if (hover) {
                if (smx < -9e3) {
                    smx = mx;
                    smy = my;
                } else {
                    smx += (mx - smx) * 0.09;
                    smy += (my - smy) * 0.09;
                }
                strength += (strengthTarget - strength) * 0.06;
            }

            const cycle = (t % SWEEP_PERIOD) / SWEEP_PERIOD;
            const eased = cycle < 0.72 ? (1 - Math.cos((cycle / 0.72) * Math.PI)) / 2 : 1.1;
            const sweepZ = Z_FAR - (Z_FAR - Z_NEAR) * eased;

            /*
             * The terrain is drawn as connected row lines — a wireframe landscape, not scattered dust.
             * Far rows first so near rows paint over them, which is all the occlusion this needs.
             */
            for (let row = ROWS - 1; row >= 0; row--) {
                const z = Z_NEAR * Math.pow(Z_FAR / Z_NEAR, row / (ROWS - 1));
                const depth = 1 / z;

                const dz = Math.abs(z - sweepZ);
                const inSweep = dz < 0.4;
                const glow = inSweep ? 1 - dz / 0.4 : 0;

                const lineAlpha = Math.min(0.62, Math.max(0.07, depth * 0.5)) + glow * 0.3;
                ctx!.strokeStyle = inSweep
                    ? `rgba(214, 40, 82, ${Math.min(0.95, lineAlpha + 0.15)})`
                    : `rgba(255, 255, 255, ${lineAlpha})`;
                ctx!.lineWidth = Math.min(1.7, Math.max(0.5, depth * 1.5)) + glow * 0.7;

                ctx!.beginPath();
                for (let col = 0; col < COLS; col++) {
                    const x = ((col / (COLS - 1)) * 2 - 1) * 2.7;
                    let y = surface(x, z, hash(row * 131 + col) - 0.5);
                    const sx = cx + (x / z) * focal;
                    let sy = horizonY + ((y + 1.2) / z) * focal * 0.6;
                    // The swell: project first, measure the cursor's bearing, lift, re-project.
                    const g = influence(sx, sy);
                    if (g > 0.004) {
                        y -= g * 0.5;
                        sy = horizonY + ((y + 1.2) / z) * focal * 0.6;
                    }
                    if (col === 0) ctx!.moveTo(sx, sy);
                    else ctx!.lineTo(sx, sy);
                }
                ctx!.stroke();

                // Crest markers: a dot where the surface rides high, so the ridges sparkle.
                for (let col = 0; col < COLS; col += 3) {
                    const x = ((col / (COLS - 1)) * 2 - 1) * 2.7;
                    const grain = hash(row * 131 + col) - 0.5;
                    let y = surface(x, z, grain);
                    const sx = cx + (x / z) * focal;
                    let sy = horizonY + ((y + 1.2) / z) * focal * 0.6;
                    const g = influence(sx, sy);
                    if (g > 0.004) {
                        y -= g * 0.5;
                        sy = horizonY + ((y + 1.2) / z) * focal * 0.6;
                    }
                    if (y > -0.25 && g < 0.2) continue; // crests, or anything the cursor has raised
                    const r = Math.min(2.2, Math.max(0.7, depth * 1.9)) + g * 0.8;
                    const a = Math.min(0.9, Math.max(0.1, depth * 0.75)) + glow * 0.4 + g * 0.3;
                    ctx!.fillStyle = inSweep
                        ? `rgba(224, 62, 100, ${Math.min(0.95, a)})`
                        : `rgba(255, 255, 255, ${a})`;
                    ctx!.beginPath();
                    ctx!.arc(sx, sy, r, 0, Math.PI * 2);
                    ctx!.fill();
                }
            }

            if (!reduced) {
                t += 0.016;
                raf = requestAnimationFrame(frame);
            }
        }

        resize();
        frame(); // reduced motion gets exactly this one frame

        const ro = new ResizeObserver(() => {
            resize();
            if (reduced) frame();
        });
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

        const onMove = (e: PointerEvent) => {
            const rect = canvas.getBoundingClientRect();
            mx = e.clientX - rect.left;
            my = e.clientY - rect.top;
            strengthTarget = 1;
        };
        const onLeave = () => {
            strengthTarget = 0;
        };
        if (hover && !reduced) {
            window.addEventListener("pointermove", onMove, { passive: true });
            document.documentElement.addEventListener("pointerleave", onLeave);
        }

        return () => {
            running = false;
            cancelAnimationFrame(raf);
            ro.disconnect();
            io.disconnect();
            document.removeEventListener("visibilitychange", onVis);
            window.removeEventListener("pointermove", onMove);
            document.documentElement.removeEventListener("pointerleave", onLeave);
        };
    }, []);

    return <canvas ref={ref} className="wavefield" aria-hidden="true" />;
}
