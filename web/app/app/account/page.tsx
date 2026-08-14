"use client";

import { useState } from "react";
import { useAccount, useDisconnect, useReadContract, useWriteContract } from "wagmi";
import { AppHeader } from "../../components/AppHeader";
import { Grain } from "../../components/Chrome";
import { Connect } from "../../components/Connect";
import { ORACLE_ADDRESS, MANAGER_ADDRESS, POOL_ADDRESS, FXRP_ADDRESS, oracleAbi, managerAbi, poolAbi, erc20Abi, usd, day, fxrp as fmtFxrp } from "@/lib/contracts";

const STRIPE_ACCOUNT_REF = process.env.NEXT_PUBLIC_ACCOUNT_REF ?? "acct_1U2HbaRh1zuX9OfD";
const ZERO = "0x0000000000000000000000000000000000000000";

/**
 * The account room: standing, and custody.
 *
 * Two things live here that the borrow flow has no space for. The first is standing: the factor this
 * account has earned, the clean cycles behind it, banked credit, and the attested age gating all of it.
 * The second is custody: wallet rotation, which the contracts have carried from the start and no interface
 * exposed. A rotation waits three public days and is cancellable by the owner the whole time, so a stolen
 * key's transfer can be seen and stopped.
 */
export default function AccountPage() {
    const { address, isConnected } = useAccount();
    const { disconnect } = useDisconnect();
    const { writeContract, isPending } = useWriteContract();

    const [view, setView] = useState<"stripe" | "mine">("stripe");
    const [newOwner, setNewOwner] = useState("");

    const platform = view === "stripe" ? "stripe" : "demo";
    const accountRef = view === "stripe" ? STRIPE_ACCOUNT_REF : (address ?? "");

    const { data: accountId } = useReadContract({
        address: ORACLE_ADDRESS,
        abi: oracleAbi,
        functionName: "accountIdFor",
        args: [platform, accountRef],
        query: { enabled: Boolean(accountRef) },
    });
    const on = { query: { enabled: Boolean(accountId), refetchInterval: 15_000 } };
    const { data: owner } = useReadContract({
        address: ORACLE_ADDRESS, abi: oracleAbi, functionName: "accountOwner", args: [accountId!], ...on,
    });
    const { data: createdAt } = useReadContract({
        address: ORACLE_ADDRESS, abi: oracleAbi, functionName: "accountCreatedAt", args: [accountId!], ...on,
    });
    const { data: pendingOwner } = useReadContract({
        address: ORACLE_ADDRESS, abi: oracleAbi, functionName: "pendingNewOwner", args: [accountId!], ...on,
    });
    const { data: readyAt } = useReadContract({
        address: ORACLE_ADDRESS, abi: oracleAbi, functionName: "rebindReadyAt", args: [accountId!], ...on,
    });
    const { data: factorBps } = useReadContract({
        address: MANAGER_ADDRESS, abi: managerAbi, functionName: "accountFactorBps", args: [accountId!], ...on,
    });
    const { data: feeBps } = useReadContract({
        address: MANAGER_ADDRESS, abi: managerAbi, functionName: "accountFeeBps", args: [accountId!], ...on,
    });
    const { data: cycles } = useReadContract({
        address: MANAGER_ADDRESS, abi: managerAbi, functionName: "closedCleanCycles", args: [accountId!], ...on,
    });
    const { data: credit } = useReadContract({
        address: MANAGER_ADDRESS, abi: managerAbi, functionName: "creditCents", args: [accountId!], ...on,
    });
    const { data: limit } = useReadContract({
        address: MANAGER_ADDRESS, abi: managerAbi, functionName: "advanceLimitCents", args: [accountId!], ...on,
    });
    const { data: reserveHeld } = useReadContract({
        address: MANAGER_ADDRESS, abi: managerAbi, functionName: "reserveFxrp", args: [accountId!], ...on,
    });
    const { data: poolShares } = useReadContract({
        address: POOL_ADDRESS, abi: poolAbi, functionName: "balanceOf",
        args: [address!], query: { enabled: Boolean(address), refetchInterval: 15_000 },
    });
    const { data: poolValue } = useReadContract({
        address: POOL_ADDRESS, abi: poolAbi, functionName: "convertToAssets",
        args: [poolShares!], query: { enabled: Boolean(poolShares && poolShares > 0n), refetchInterval: 15_000 },
    });
    const { data: walletFxrp } = useReadContract({
        address: FXRP_ADDRESS, abi: erc20Abi, functionName: "balanceOf",
        args: [address!], query: { enabled: Boolean(address), refetchInterval: 15_000 },
    });

    const isOwner = Boolean(address && owner && owner !== ZERO && owner.toLowerCase() === address.toLowerCase());
    const hasPending = Boolean(pendingOwner && pendingOwner !== ZERO);
    const rotationReady = hasPending && readyAt !== undefined && Date.now() / 1000 >= Number(readyAt);

    return (
        <>
            <Grain />
            <AppHeader account={address} onDisconnect={() => disconnect()} />
            <main className="app-main">
                <h1>
                    Standing,
                    <br />
                    <span className="grad">and custody.</span>
                </h1>
                <p className="lede">
                    What this account has earned under the tier schedule, and the wallet that controls it.
                    Every figure is read from the contracts.
                </p>

                <h2>Whose account</h2>
                <div className="block">
                    <div className="choices">
                        <button className="ghost" aria-pressed={view === "stripe"} onClick={() => setView("stripe")}>
                            Our Stripe account
                        </button>
                        <button className="ghost" aria-pressed={view === "mine"} onClick={() => setView("mine")}>
                            Yours
                        </button>
                    </div>
                    {view === "mine" && !isConnected && (
                        <div style={{ marginTop: 16 }}>
                            <Connect compact />
                        </div>
                    )}
                </div>

                <h2>Standing</h2>
                <div className="block">
                    <div className="row">
                        <span>Advance factor earned</span>
                        <span className="mono">{factorBps !== undefined ? `${(Number(factorBps) / 100).toFixed(2)}%` : "…"}</span>
                    </div>
                    <div className="row">
                        <span>Origination fee this account pays</span>
                        <span className="mono">{feeBps !== undefined ? `${(Number(feeBps) / 100).toFixed(2)}%` : "…"}</span>
                    </div>
                    <div className="row">
                        <span>Cleanly repaid advances</span>
                        <span className="mono">{cycles !== undefined ? String(cycles) : "…"}</span>
                    </div>
                    <div className="row">
                        <span>Banked credit from overpayments</span>
                        <span className="mono">{credit !== undefined ? usd(Number(credit)) : "…"}</span>
                    </div>
                    <div className="row">
                        <span>Current advance limit</span>
                        <span className="mono">{limit !== undefined ? usd(Number(limit)) : "…"}</span>
                    </div>
                    <div className="row">
                        <span>Reserve escrowed on the open advance</span>
                        <span className="mono">{reserveHeld !== undefined ? `${fmtFxrp(reserveHeld)} FXRP` : "…"}</span>
                    </div>
                    <div className="row">
                        <span>Attested account age</span>
                        <span className="mono">
                            {createdAt === undefined ? "…" : Number(createdAt) === 0 ? "not attested" : `since ${day(Number(createdAt))}`}
                        </span>
                    </div>
                    <p className="quiet" style={{ marginTop: 14, marginBottom: 0 }}>
                        The factor starts at 2.5% and earns 20 points per cleanly repaid advance, plus 8 per
                        proven month beyond the first. Until the account has 30 attested days of age it stays
                        at the base regardless of history, which is what makes the tier expensive to fake.
                    </p>
                </div>

                {isConnected && (
                    <>
                        <h2>Your position</h2>
                        <div className="block">
                            <div className="row">
                                <span>FXRP in your wallet</span>
                                <span className="mono">{walletFxrp !== undefined ? `${fmtFxrp(walletFxrp)} FXRP` : "…"}</span>
                            </div>
                            <div className="row">
                                <span>Lender pool shares</span>
                                <span className="mono">{poolShares !== undefined ? poolShares.toString() : "…"}</span>
                            </div>
                            <div className="row">
                                <span>Their value, at the current share price</span>
                                <span className="mono">
                                    {poolShares === 0n ? "0 FXRP" : poolValue !== undefined ? `${fmtFxrp(poolValue)} FXRP` : "…"}
                                </span>
                            </div>
                            <p className="quiet" style={{ marginTop: 12, marginBottom: 0 }}>
                                Both sides of the book in one place: what you owe and hold as a borrower
                                above, what you have staked as a lender here.
                            </p>
                        </div>
                    </>
                )}

                <h2>Custody</h2>
                <div className="block">
                    <div className="row">
                        <span>Bound wallet</span>
                        <span className="mono">
                            {owner === undefined ? "…" : owner === ZERO ? "none yet · first prover binds it" : `${owner.slice(0, 8)}…${owner.slice(-6)}`}
                        </span>
                    </div>

                    {hasPending && (
                        <>
                            <div className="row">
                                <span>Rotation pending, to</span>
                                <span className="mono">{pendingOwner!.slice(0, 8)}…{pendingOwner!.slice(-6)}</span>
                            </div>
                            <div className="row">
                                <span>{rotationReady ? "Ready to finalise" : "Finalisable"}</span>
                                <span className="mono">{rotationReady ? "now" : day(Number(readyAt))}</span>
                            </div>
                            <div className="choices" style={{ marginTop: 16 }}>
                                {isOwner && (
                                    <button
                                        className="ghost"
                                        disabled={isPending}
                                        onClick={() =>
                                            writeContract({
                                                address: ORACLE_ADDRESS, abi: oracleAbi,
                                                functionName: "cancelRebind", args: [accountId!],
                                            })
                                        }
                                    >
                                        Cancel rotation
                                    </button>
                                )}
                                <button
                                    disabled={!rotationReady || isPending}
                                    onClick={() =>
                                        writeContract({
                                            address: ORACLE_ADDRESS, abi: oracleAbi,
                                            functionName: "finalizeRebind", args: [accountId!],
                                        })
                                    }
                                >
                                    Finalise rotation
                                </button>
                            </div>
                        </>
                    )}

                    {!hasPending && isOwner && (
                        <>
                            <label className="quiet" htmlFor="newOwner" style={{ display: "block", marginTop: 16 }}>
                                Rotate this account to a new wallet
                            </label>
                            <input
                                id="newOwner"
                                value={newOwner}
                                onChange={(e) => setNewOwner(e.target.value)}
                                placeholder="0x…"
                                spellCheck={false}
                            />
                            <div style={{ marginTop: 12 }}>
                                <button
                                    disabled={isPending || !/^0x[0-9a-fA-F]{40}$/.test(newOwner)}
                                    onClick={() =>
                                        writeContract({
                                            address: ORACLE_ADDRESS, abi: oracleAbi,
                                            functionName: "requestRebind",
                                            args: [accountId!, newOwner as `0x${string}`],
                                        })
                                    }
                                >
                                    Request rotation
                                </button>
                            </div>
                        </>
                    )}

                    <p className="quiet" style={{ marginTop: 16, marginBottom: 0 }}>
                        A rotation waits three days in public before it can be finalised, and the current
                        owner can cancel it the whole time: a thief&apos;s transfer is visible for three days
                        before it lands. This is rotation, not recovery. A wallet lost outright stays lost,
                        because anything that could recover it could also steal it.
                    </p>
                </div>
            </main>
        </>
    );
}
