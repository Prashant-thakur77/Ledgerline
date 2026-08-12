"use client";

import { useEffect, useRef } from "react";

/**
 * The drifting constellation behind the hero.
 *
 * Flare's own visual language is swarms of particles resolving into shapes, and this is that idea written
 * from scratch rather than lifted: points drift, and a line is drawn between any two close enough to be
 * "in agreement". Which is the product in one image — isolated facts mean nothing, agreement between them
 * is the whole thing.
 *
 * Cheap on purpose. Capped particle count, squared-distance comparisons so there is no sqrt in the inner
 * loop, device-pixel-ratio clamped at 2, and the whole loop stops when the tab is hidden or the element
 * scrolls out of view. It renders nothing at all when the visitor asks for reduced motion.
 */
export function ParticleField() {
    const ref = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;

        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
        if (reduced.matches) return;

        const ctx = canvas.getContext("2d", { alpha: true });
        if (!ctx) return;

        let width = 0;
        let height = 0;
        let raf = 0;
        let running = true;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        // Fewer points on a phone: the link pass is O(n²) and a small screen does not need the density.
        const COUNT = window.innerWidth < 720 ? 34 : 64;
        const LINK = window.innerWidth < 720 ? 110 : 140;
        const LINK_SQ = LINK * LINK;

        /*
         * A genuinely three-dimensional cloud: points live in model space on a loose spherical shell,
         * the whole cloud turns slowly, and a perspective divide projects them to the screen. Depth is
         * legible three ways — nearer points are larger, brighter, and their links stronger — which is
         * what makes it read as a rotating constellation rather than drifting dots.
         */
        type P3 = { x: number; y: number; z: number; r: number };
        let points: P3[] = [];
        let angleY = 0;
        let angleX = 0.35;
        // The pointer steers the rotation a little: attention tilts the cloud.
        let targetTilt = 0;
        let tilt = 0;

        const FOCAL = 720;
        const RADIUS = 340;

        function resize() {
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            width = rect.width;
            height = rect.height;
            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
            ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        function seed() {
            points = Array.from({ length: COUNT }, () => {
                // A shell with jitter, not a solid ball: constellations live on the sky, not in it.
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                const rr = RADIUS * (0.72 + Math.random() * 0.4);
                return {
                    x: rr * Math.sin(phi) * Math.cos(theta),
                    y: rr * Math.cos(phi) * 0.7,
                    z: rr * Math.sin(phi) * Math.sin(theta),
                    r: Math.random() * 1.5 + 0.6,
                };
            });
        }

        const onPointer = (e: PointerEvent) => {
            targetTilt = (e.clientX / window.innerWidth - 0.5) * 0.5;
        };
        window.addEventListener("pointermove", onPointer, { passive: true });

        function frame() {
            if (!running) return;
            ctx!.clearRect(0, 0, width, height);

            angleY += 0.0016;
            tilt += (targetTilt - tilt) * 0.03;
            const cy = Math.cos(angleY + tilt), sy = Math.sin(angleY + tilt);
            const cx = Math.cos(angleX), sx = Math.sin(angleX);

            const cxPix = width * 0.62; // the cloud sits off-centre, behind the copy's right shoulder
            const cyPix = height * 0.44;

            // Rotate and project once per frame; reuse for both passes.
            const proj: { X: number; Y: number; s: number; p: P3 }[] = [];
            for (const p of points) {
                const x1 = p.x * cy - p.z * sy;
                const z1 = p.x * sy + p.z * cy;
                const y1 = p.y * cx - z1 * sx;
                const z2 = p.y * sx + z1 * cx;
                const s = FOCAL / (FOCAL + z2 + RADIUS); // 0.35..1.35 depth scale
                proj.push({ X: cxPix + x1 * s, Y: cyPix + y1 * s, s, p });
            }

            for (let i = 0; i < proj.length; i++) {
                for (let j = i + 1; j < proj.length; j++) {
                    const dx = proj[i].X - proj[j].X;
                    const dy = proj[i].Y - proj[j].Y;
                    const d2 = dx * dx + dy * dy;
                    if (d2 > LINK_SQ) continue;
                    const depth = (proj[i].s + proj[j].s) / 2;
                    const alpha = (1 - d2 / LINK_SQ) * 0.42 * depth;
                    ctx!.strokeStyle = `rgba(230, 32, 88, ${alpha})`;
                    ctx!.lineWidth = 0.7 * depth;
                    ctx!.beginPath();
                    ctx!.moveTo(proj[i].X, proj[i].Y);
                    ctx!.lineTo(proj[j].X, proj[j].Y);
                    ctx!.stroke();
                }
            }

            for (const q of proj) {
                // Far points cool toward the violet field; near ones warm toward ink.
                const a = 0.18 + 0.45 * (q.s - 0.35);
                ctx!.fillStyle = q.s > 0.95 ? `rgba(244, 242, 238, ${a})` : `rgba(170, 150, 255, ${a})`;
                ctx!.beginPath();
                ctx!.arc(q.X, q.Y, q.p.r * q.s, 0, Math.PI * 2);
                ctx!.fill();
            }

            raf = requestAnimationFrame(frame);
        }

        resize();
        seed();
        frame();

        const onResize = () => {
            resize();
            seed();
        };
        window.addEventListener("resize", onResize);

        // Stop burning frames when nobody is looking.
        const onVisibility = () => {
            running = !document.hidden;
            if (running) frame();
            else cancelAnimationFrame(raf);
        };
        document.addEventListener("visibilitychange", onVisibility);

        const io = new IntersectionObserver(
            ([entry]) => {
                running = entry.isIntersecting && !document.hidden;
                if (running) frame();
                else cancelAnimationFrame(raf);
            },
            { threshold: 0 }
        );
        io.observe(canvas);

        return () => {
            running = false;
            cancelAnimationFrame(raf);
            window.removeEventListener("resize", onResize);
            window.removeEventListener("pointermove", onPointer);
            document.removeEventListener("visibilitychange", onVisibility);
            io.disconnect();
        };
    }, []);

    return <canvas ref={ref} className="particles" aria-hidden="true" />;
}
