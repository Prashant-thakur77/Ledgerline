"use client";

import { useEffect, useState } from "react";
import { useConnect } from "wagmi";
import { flareTestnet } from "wagmi/chains";

/**
 * Connecting a wallet, with the failures actually shown.
 *
 * The previous version rendered a button per connector and dropped `useConnect`'s `error` on the floor, so
 * every failure looked identical to nothing happening: no wallet installed, a dismissed prompt, a locked
 * extension. A button that silently does nothing is worse than an error, because the visitor concludes the
 * site is broken rather than that they need to do something.
 *
 * So this checks whether a wallet exists at all before offering to use one, and prints whatever comes back.
 */

/** Any injected provider announces itself on `window.ethereum`. */
function useHasInjectedWallet() {
    // `undefined` means "not established yet" — on the server, and for the first client render, which has to
    // match it. Resolving in an effect keeps hydration consistent.
    const [has, setHas] = useState<boolean | undefined>(undefined);
    useEffect(() => {
        const check = () =>
            setHas(typeof window !== "undefined" && Boolean((window as { ethereum?: unknown }).ethereum));
        check();
        // Some extensions inject late; EIP-6963 announces them as they arrive.
        window.addEventListener("eip6963:announceProvider", check);
        const t = setTimeout(check, 800);
        return () => {
            window.removeEventListener("eip6963:announceProvider", check);
            clearTimeout(t);
        };
    }, []);
    return has;
}

function readable(message: string) {
    if (/User rejected|denied|rejected the request/i.test(message)) {
        return "You dismissed the wallet prompt. Press connect again when you are ready.";
    }
    if (/already pending|Request of type/i.test(message)) {
        return "Your wallet already has a connection request open. Check the extension window.";
    }
    if (/No injected provider|Connector not found|provider is undefined/i.test(message)) {
        return "No wallet extension responded. If you have just installed one, reload the page.";
    }
    return message.split("\n")[0].slice(0, 200);
}

export function Connect({ compact = false }: { compact?: boolean }) {
    const { connect, connectors, isPending, error } = useConnect();
    const hasWallet = useHasInjectedWallet();

    // Prefer a real injected wallet; fall back to whatever wagmi has configured.
    const connector = connectors.find((c) => c.type === "injected") ?? connectors[0];

    if (hasWallet === false) {
        return (
            <div className={compact ? undefined : "block"}>
                <p className="alert" style={{ marginTop: 0 }}>
                    No Ethereum wallet found in this browser.
                </p>
                <p className="quiet" style={{ marginBottom: 0 }}>
                    Ledgerline needs one to sign transactions. It never signs on your behalf. Install{" "}
                    <a href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                        MetaMask
                    </a>{" "}
                    (or any injected wallet), reload this page, and add the <strong>Coston2</strong> testnet.
                    The app will offer to switch you there automatically. Everything on the landing page,
                    including the proven figure and its Merkle root, is readable without a wallet.
                </p>
            </div>
        );
    }

    return (
        <div className={compact ? undefined : "block"}>
            <button
                className="wide"
                // Asking for Coston2 at connect time makes MetaMask offer to add the network itself,
                // so a fresh wallet needs no manual RPC/chain-id form-filling at all.
                onClick={() => connector && connect({ connector, chainId: flareTestnet.id })}
                disabled={isPending || !connector || hasWallet === undefined}
            >
                {hasWallet === undefined
                    ? "Looking for a wallet…"
                    : isPending
                      ? "Check your wallet…"
                      : "Connect wallet"}
            </button>

            {error && (
                <p className="alert" style={{ marginTop: 14, marginBottom: 0 }}>
                    {readable(error.message)}
                </p>
            )}

            <p className="quiet" style={{ marginTop: 14, marginBottom: 0 }}>
                Coston2 testnet, chain id 114. No real money is involved, and this site never holds your keys.
            </p>
        </div>
    );
}
