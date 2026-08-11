"use client";

import Link from "next/link";

/**
 * The bar across the top of the application.
 *
 * Deliberately not the landing page's header: someone inside the app wants their account and a way out, not
 * marketing navigation. The one link back exists because a wallet-gated page with no exit is a dead end.
 */
export function AppHeader({
    account,
    onDisconnect,
}: {
    account?: string;
    onDisconnect?: () => void;
}) {
    return (
        <header className="appheader">
            <div className="appheader-in">
                <Link href="/" className="brand">
                    Ledgerline
                </Link>
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
