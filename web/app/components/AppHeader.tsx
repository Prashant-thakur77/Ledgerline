"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mark } from "./Chrome";

/**
 * The bar across the top of the application.
 *
 * Deliberately not the landing page's header: someone inside the app wants to know where they are, reach
 * the other two rooms, and see their account. The app has exactly three rooms, one per thing a visitor can
 * be: a borrower, a lender, or an auditor. The tabs are the map.
 */
const TABS = [
    { href: "/app", label: "Borrow" },
    { href: "/app/lend", label: "Lend" },
    { href: "/app/activity", label: "Activity" },
    { href: "/app/account", label: "Account" },
];

export function AppHeader({
    account,
    onDisconnect,
}: {
    account?: string;
    onDisconnect?: () => void;
}) {
    const pathname = usePathname();

    return (
        <header className="appheader">
            <div className="appheader-in">
                <Link href="/" className="brand">
                    <Mark />
                    Proofline
                </Link>

                <nav className="apptabs" aria-label="Application">
                    {TABS.map((t) => (
                        <Link
                            key={t.href}
                            href={t.href}
                            className={pathname === t.href ? "apptab active" : "apptab"}
                            aria-current={pathname === t.href ? "page" : undefined}
                        >
                            {t.label}
                        </Link>
                    ))}
                </nav>

                <div className="appheader-right">
                    {account ? (
                        <>
                            <span className="mono quiet">
                                {account.slice(0, 6)}…{account.slice(-4)}
                            </span>
                            <button className="link" onClick={onDisconnect}>
                                disconnect
                            </button>
                        </>
                    ) : (
                        <span className="quiet">Coston2 · chain id 114</span>
                    )}
                </div>
            </div>
        </header>
    );
}
