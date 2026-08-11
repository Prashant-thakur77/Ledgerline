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

        type P = { x: number; y: number; vx: number; vy: number; r: number };
        let points: P[] = [];

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
            points = Array.from({ length: COUNT }, () => ({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 0.22,
                vy: (Math.random() - 0.5) * 0.22,
                r: Math.random() * 1.6 + 0.7,
            }));
        }

        function frame() {
            if (!running) return;
            ctx!.clearRect(0, 0, width, height);

            for (const p of points) {
                p.x += p.vx;
                p.y += p.vy;
                // Wrap rather than bounce: bouncing makes the edges look like walls.
                if (p.x < -20) p.x = width + 20;
                if (p.x > width + 20) p.x = -20;
                if (p.y < -20) p.y = height + 20;
                if (p.y > height + 20) p.y = -20;
            }

            for (let i = 0; i < points.length; i++) {
                for (let j = i + 1; j < points.length; j++) {
                    const dx = points[i].x - points[j].x;
                    const dy = points[i].y - points[j].y;
                    const d2 = dx * dx + dy * dy;
                    if (d2 > LINK_SQ) continue;
                    const alpha = (1 - d2 / LINK_SQ) * 0.5;
                    ctx!.strokeStyle = `rgba(230, 32, 88, ${alpha})`;
                    ctx!.lineWidth = 0.7;
                    ctx!.beginPath();
                    ctx!.moveTo(points[i].x, points[i].y);
                    ctx!.lineTo(points[j].x, points[j].y);
                    ctx!.stroke();
                }
            }

            for (const p of points) {
                ctx!.fillStyle = "rgba(242, 240, 236, 0.55)";
                ctx!.beginPath();
                ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
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
            document.removeEventListener("visibilitychange", onVisibility);
            io.disconnect();
        };
    }, []);

    return <canvas ref={ref} className="particles" aria-hidden="true" />;
}
