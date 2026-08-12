"use client";

import { useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { FXRP_ADDRESS, POOL_ADDRESS, EXPLORER, poolAbi, erc20Abi, fxrp } from "@/lib/contracts";

/**
 * The lender side, on screen.
 *
 * Three numbers and two actions, with the two disclosures the pool's accounting makes true printed where
 * the money enters: LPs carry XRP/USD drift between disbursement and repayment, and an XRPL-side repayment
 * dips the share price until the operator returns the re-minted value. A pool that hid either would be
 * lying with arithmetic.
 */
export function Lend() {
    const { address, isConnected } = useAccount();
    const [amount, setAmount] = useState("1.0");
    const { writeContract, isPending, data: txHash } = useWriteContract();

    const every = { query: { refetchInterval: 15_000 } };
    const { data: totalAssets } = useReadContract({
        address: POOL_ADDRESS, abi: poolAbi, functionName: "totalAssets", ...every,
    });
    const { data: lent } = useReadContract({
        address: POOL_ADDRESS, abi: poolAbi, functionName: "lentFxrp", ...every,
    });
    const { data: lendable } = useReadContract({
        address: POOL_ADDRESS, abi: poolAbi, functionName: "availableToLend", ...every,
    });
    const { data: shares, refetch: refetchShares } = useReadContract({
        address: POOL_ADDRESS, abi: poolAbi, functionName: "balanceOf",
        args: [address!], query: { enabled: Boolean(address), refetchInterval: 15_000 },
    });
    const { data: myAssets } = useReadContract({
        address: POOL_ADDRESS, abi: poolAbi, functionName: "convertToAssets",
        args: [shares!], query: { enabled: Boolean(shares && shares > 0n), refetchInterval: 15_000 },
    });
    const { data: maxOut } = useReadContract({
        address: POOL_ADDRESS, abi: poolAbi, functionName: "maxWithdraw",
        args: [address!], query: { enabled: Boolean(address), refetchInterval: 15_000 },
    });
    const { data: allowance, refetch: refetchAllowance } = useReadContract({
        address: FXRP_ADDRESS, abi: erc20Abi, functionName: "allowance",
        args: [address!, POOL_ADDRESS], query: { enabled: Boolean(address) },
    });
    const { data: walletFxrp } = useReadContract({
        address: FXRP_ADDRESS, abi: erc20Abi, functionName: "balanceOf",
        args: [address!], query: { enabled: Boolean(address), refetchInterval: 15_000 },
    });

    const raw = BigInt(Math.round(parseFloat(amount || "0") * 1e6));
    const needsApproval = (allowance ?? 0n) < raw;

    return (
        <div className="block">
            <div className="row">
                <span>Pool holds</span>
                <span className="mono">{totalAssets !== undefined ? `${fxrp(totalAssets)} FXRP` : "…"}</span>
            </div>
            <div className="row">
                <span>Out in advances</span>
                <span className="mono">{lent !== undefined ? `${fxrp(lent)} FXRP` : "…"}</span>
            </div>
            <div className="row">
                <span>Available to lend</span>
                <span className="mono">{lendable !== undefined ? `${fxrp(lendable)} FXRP` : "…"}</span>
            </div>

            {isConnected && (shares ?? 0n) > 0n && (
                <div className="row">
                    <span>Your position</span>
                    <span className="mono">
                        {myAssets !== undefined ? `${fxrp(myAssets)} FXRP` : "…"}
                        {maxOut !== undefined && <span className="pending"> · {fxrp(maxOut)} withdrawable now</span>}
                    </span>
                </div>
            )}

            <p className="quiet" style={{ marginTop: 14 }}>
                Deposits earn the origination fees and repayment flow of every advance, and absorb write-offs
                the same way: in the share price, visibly. Two things to know before depositing: the pool
                holds FXRP against dollar-denominated debts, so <strong>you carry XRP/USD drift</strong>{" "}
                between disbursement and repayment; and a repayment made on the XRP Ledger{" "}
                <strong>dips the share price</strong> until the operator re-mints that XRP and returns it.
                Withdrawals are limited to idle liquidity, because an advance cannot be recalled.
            </p>

            {isConnected ? (
                <>
                    <div className="row">
                        <span>Amount in FXRP</span>
                        <input
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            inputMode="decimal"
                            aria-label="Amount in FXRP"
                        />
                    </div>
                    <div className="cta" style={{ marginTop: 14 }}>
                        {needsApproval ? (
                            <button
                                className="wide"
                                disabled={isPending || raw === 0n || raw > (walletFxrp ?? 0n)}
                                onClick={() =>
                                    writeContract(
                                        {
                                            address: FXRP_ADDRESS, abi: erc20Abi, functionName: "approve",
                                            args: [POOL_ADDRESS, raw],
                                        },
                                        { onSuccess: () => setTimeout(() => refetchAllowance(), 3000) }
                                    )
                                }
                            >
                                {isPending ? "Check your wallet…" : "Approve FXRP"}
                            </button>
                        ) : (
                            <button
                                className="wide"
                                disabled={isPending || raw === 0n || raw > (walletFxrp ?? 0n)}
                                onClick={() =>
                                    writeContract(
                                        {
                                            address: POOL_ADDRESS, abi: poolAbi, functionName: "deposit",
                                            args: [raw, address!],
                                        },
                                        { onSuccess: () => setTimeout(() => refetchShares(), 3000) }
                                    )
                                }
                            >
                                {isPending ? "Check your wallet…" : "Deposit"}
                            </button>
                        )}
                        <button
                            className="wide ghost"
                            disabled={isPending || raw === 0n || raw > (maxOut ?? 0n)}
                            onClick={() =>
                                writeContract(
                                    {
                                        address: POOL_ADDRESS, abi: poolAbi, functionName: "withdraw",
                                        args: [raw, address!, address!],
                                    },
                                    { onSuccess: () => setTimeout(() => refetchShares(), 3000) }
                                )
                            }
                        >
                            Withdraw
                        </button>
                    </div>
                    {txHash && (
                        <a className="proof" href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ marginTop: 12 }}>
                            sent<span className="sep">·</span>{txHash.slice(0, 10)}… ↗
                        </a>
                    )}
                    <p className="quiet" style={{ marginTop: 12, marginBottom: 0 }}>
                        Wallet FXRP: {walletFxrp !== undefined ? fxrp(walletFxrp) : "…"} · claim more at the{" "}
                        <a href="https://faucet.flare.network/coston2" target="_blank" rel="noreferrer">
                            Coston2 faucet
                        </a>
                        .
                    </p>
                </>
            ) : (
                <p className="quiet" style={{ marginBottom: 0 }}>
                    Connect a wallet above to deposit or withdraw. The figures update regardless.
                </p>
            )}
        </div>
    );
}
