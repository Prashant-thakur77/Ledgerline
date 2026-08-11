"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Reveals its children once, when they first scroll into view.
 *
 * Deliberately one-way: elements do not re-hide when scrolled back past. Content that animates every time
 * it crosses the viewport is a nuisance to re-read, and this page expects to be re-read.
 *
 * Starts visible if the browser lacks IntersectionObserver or the visitor asked for reduced motion, so the
 * failure mode is "everything is simply there" rather than a blank page.
 */
export function Reveal({
    children,
    delay = 0,
    as: Tag = "div",
    className,
    id,
}: {
    children: ReactNode;
    /** Milliseconds, for staggering siblings. Kept small — this is punctuation, not choreography. */
    delay?: number;
    as?: "div" | "section" | "li";
    className?: string;
    id?: string;
}) {
    const ref = useRef<HTMLElement>(null);
    const [shown, setShown] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        if (
            typeof IntersectionObserver === "undefined" ||
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
            setShown(true);
            return;
        }

        const io = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setShown(true);
                    io.disconnect();
                }
            },
            // Fire a little before the element arrives, so it has finished by the time it is read.
            { threshold: 0.05, rootMargin: "0px 0px -8% 0px" }
        );
        io.observe(el);
        return () => io.disconnect();
    }, []);

    return (
        <Tag
            ref={ref as never}
            id={id}
            className={`reveal${shown ? " in" : ""}${className ? ` ${className}` : ""}`}
            style={delay ? { transitionDelay: `${delay}ms` } : undefined}
        >
            {children}
        </Tag>
    );
}
