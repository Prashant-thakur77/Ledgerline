"use client";

import { useEffect, useState } from "react";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { POOL_ADDRESS, FXRP_ADDRESS, MANAGER_ADDRESS, poolAbi, erc20Abi, managerAbi, fxrp as fmtFxrp } from "@/lib/contracts";

/**
 * The protocol's assets, on both chains, right now.
 *
 * A cross-chain product should be able to show its own books across the boundary: the pool's FXRP on
 * Flare, and the repayment treasury's real XRP on the XRP Ledger, each read live from its own chain.
 * When a wallet is connected, its balances join the view, so a visitor sees their own position across
 * the same boundary.
 */

const XRPL_TREASURY = "r9aTnFEPnSceeGjDgcbhqsK3epizmZGC2o";

export function TwoLedgers() {
    const { address, isConnected } = useAccount();
    const [xrplXrp, setXrplXrp] = useState<number | null>(null);

    const every = { query: { refetchInterval: 20_000 } };
    const { data: poolAssets } = useReadContract({
        address: POOL_ADDRESS, abi: poolAbi, functionName: "totalAssets", ...every,
    });
    const { data: reserveHeld } = useReadContract({
        address: MANAGER_ADDRESS, abi: managerAbi, functionName: "keeperReserveFxrp", ...every,
    });
    const { data: myFxrp } = useReadContract({
        address: FXRP_ADDRESS, abi: erc20Abi, functionName: "balanceOf",
        args: [address!], query: { enabled: Boolean(address), refetchInterval: 20_000 },
    });
    const { data: myC2flr } = useBalance({ address, query: { enabled: Boolean(address) } });

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const d = await fetch(`/api/xrpl-balance?account=${XRPL_TREASURY}`).then((r) => r.json());
                if (!cancelled && typeof d.xrp === "number") setXrplXrp(d.xrp);
            } catch {
                /* the row simply stays quiet */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <div className="block">
            <div className="row">
                <span>Lender pool, on Flare</span>
                <span className="mono">{poolAssets !== undefined ? `${fmtFxrp(poolAssets)} FXRP` : "…"}</span>
            </div>
            <div className="row">
                <span>Repayment treasury, on the XRP Ledger</span>
                <span className="mono">
                    {xrplXrp === null ? "…" : `${xrplXrp.toLocaleString("en-US")} XRP`}
                </span>
            </div>
            {reserveHeld !== undefined && reserveHeld > 0n && (
                <div className="row">
                    <span>Keeper tip reserve</span>
                    <span className="mono">{fmtFxrp(reserveHeld)} FXRP</span>
                </div>
            )}
            {isConnected && (
                <>
                    <div className="row">
                        <span>Your FXRP</span>
                        <span className="mono">{myFxrp !== undefined ? `${fmtFxrp(myFxrp)} FXRP` : "…"}</span>
                    </div>
                    <div className="row">
                        <span>Your C2FLR</span>
                        <span className="mono">
                            {myC2flr ? `${(Number(myC2flr.value) / 1e18).toFixed(2)} C2FLR` : "…"}
                        </span>
                    </div>
                </>
            )}
            <p className="quiet" style={{ marginTop: 12, marginBottom: 0 }}>
                Each side is read live from its own chain: Flare through the RPC, the XRP Ledger through
                its own validated ledger. One product, books on both.
            </p>
        </div>
    );
}
