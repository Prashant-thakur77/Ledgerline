"use client";

import { useEffect, useRef, useState } from "react";
import {
    useAccount,
    useDisconnect,
    useReadContract,
    useSimulateContract,
    useSwitchChain,
    useWriteContract,
} from "wagmi";
import { flareTestnet } from "wagmi/chains";
import {
    ORACLE_ADDRESS,
    MANAGER_ADDRESS,
    EXPLORER,
    oracleAbi,
    managerAbi,
    usd,
    fxrp,
    price,
    day,
} from "@/lib/contracts";
import Link from "next/link";
import { ProofLine, short } from "../components/ProofLine";
import { Mechanism } from "../components/Mechanism";
import { ProveRevenue } from "../components/ProveRevenue";
import { Connect } from "../components/Connect";
import { ProtocolStrip, ActivityFeed } from "../components/Activity";
import { Journey } from "../components/Journey";
import { Lend } from "../components/Lend";
import { AppHeader } from "../components/AppHeader";
import { Grain } from "../components/Chrome";

const STRIPE_ACCOUNT_REF = process.env.NEXT_PUBLIC_ACCOUNT_REF ?? "acct_1U2HbaRh1zuX9OfD";

export default function Page() {
    const { address, isConnected, chainId: walletChainId } = useAccount();
    const { disconnect } = useDisconnect();
    const { switchChain } = useSwitchChain();

    // Which account the page is looking at. The Stripe account is ours and is bound to the wallet that first
    // proved it; the sandbox one belongs to whoever is connected, so a visitor can run the whole loop.
    const [view, setView] = useState<"stripe" | "mine">("stripe");
    const platform = view === "stripe" ? "stripe" : "demo";
    const accountRef = view === "stripe" ? STRIPE_ACCOUNT_REF : (address ?? "");

    const [amount, setAmount] = useState("2.00");
    const [leg, setLeg] = useState<"fxrp" | "xrpl">("fxrp");
    const [xrplAddress, setXrplAddress] = useState("");
    const [lots, setLots] = useState("1");
    const [txByPeriod, setTxByPeriod] = useState<Record<string, string>>({});
    const [freshPeriod, setFreshPeriod] = useState<string | null>(null);
    const seenCount = useRef<number | null>(null);

    const { data: accountId } = useReadContract({
        address: ORACLE_ADDRESS,
        abi: oracleAbi,
        functionName: "accountIdFor",
        args: [platform, accountRef],
        query: { enabled: Boolean(accountRef) },
    });

    // Polls, so an attestation landing while the page is open animates in rather than needing a refresh.
    const on = { query: { enabled: Boolean(accountId), refetchInterval: 12_000 } };
    const { data: history, refetch: refetchHistory } = useReadContract({
        address: ORACLE_ADDRESS,
        abi: oracleAbi,
        functionName: "revenueHistory",
        args: [accountId!],
        ...on,
    });
    const { data: boundOwner } = useReadContract({
        address: ORACLE_ADDRESS,
        abi: oracleAbi,
        functionName: "accountOwner",
        args: [accountId!],
        ...on,
    });
    const { data: limit } = useReadContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "advanceLimitCents",
        args: [accountId!],
        ...on,
    });
    const { data: advance, refetch: refetchAdvance } = useReadContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "advanceOf",
        args: [accountId!],
        ...on,
    });
    const { data: treasury } = useReadContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "availableFunds",
        query: { refetchInterval: 15_000 },
    });
    const { data: factorBps } = useReadContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "accountFactorBps",
        args: [accountId!],
        ...on,
    });
    const { data: cleanCycles } = useReadContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "closedCleanCycles",
        args: [accountId!],
        ...on,
    });
    const { data: credit } = useReadContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "creditCents",
        args: [accountId!],
        ...on,
    });
    const { data: feeBps } = useReadContract({ address: MANAGER_ADDRESS, abi: managerAbi, functionName: "feeBps" });
    // The fee this account actually pays: base plus the risk premium its tier has not yet melted.
    const { data: accountFee } = useReadContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "accountFeeBps",
        args: [accountId!],
        ...on,
    });
    const { data: shareBps } = useReadContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "repaymentShareBps",
    });
    const { data: lot } = useReadContract({ address: MANAGER_ADDRESS, abi: managerAbi, functionName: "lotSize" });
    /*
     * Empty on a deployment that predates the XRPL repayment leg, which is exactly how the interface decides
     * whether to offer that route at all.
     */
    const { data: xrplTreasury } = useReadContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "xrplTreasuryAddress",
    });

    const { data: priceSim } = useSimulateContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "currentXrpUsd",
        query: { refetchInterval: 15_000 },
    });
    const [xrpUsd, priceDecimals] = (priceSim?.result as [bigint, number] | undefined) ?? [undefined, undefined];
    const [rateSeenAt, setRateSeenAt] = useState<string>("");
    useEffect(() => {
        if (xrpUsd) setRateSeenAt(new Date().toLocaleTimeString("en-GB"));
    }, [xrpUsd]);

    const periods = history ?? [];

    /*
     * Map each proven period to the transaction that proved it, so the proof line opens the real thing.
     *
     * Asked of the explorer's log index rather than the node: Coston2's public RPC refuses an `eth_getLogs`
     * spanning more than 30 blocks, so scanning back to the deployment is not possible from the browser.
     */
    useEffect(() => {
        if (!accountId || periods.length === 0) return;
        let cancelled = false;
        void (async () => {
            try {
                const found = await fetch(`/api/proofs?accountId=${accountId}`).then((r) => r.json());
                if (!cancelled && found && !found.error) setTxByPeriod(found);
            } catch {
                /* the link is a nicety; the proof line still shows the round and the root without it */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [accountId, periods.length]);

    // The one motion moment: a period that appears while the page is open resolves in.
    useEffect(() => {
        if (seenCount.current !== null && periods.length > seenCount.current) {
            const newest = periods[periods.length - 1];
            setFreshPeriod(String(newest.periodEnd));
            const t = setTimeout(() => setFreshPeriod(null), 2600);
            return () => clearTimeout(t);
        }
        seenCount.current = periods.length;
    }, [periods.length]);

    // Switching which account is on screen resets the "what have I already seen" baseline.
    useEffect(() => {
        seenCount.current = null;
        setTxByPeriod({});
    }, [accountId]);

    const cents = BigInt(Math.round(parseFloat(amount || "0") * 100));
    const { data: quoted } = useReadContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "usdCentsToFxrp",
        args: [cents, xrpUsd!, priceDecimals!],
        query: { enabled: Boolean(xrpUsd && cents > 0n) },
    });

    const lotsBn = BigInt(parseInt(lots || "0", 10) || 0);
    const { data: xrplCents } = useReadContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "fxrpToUsdCents",
        args: [(lot ?? 0n) * lotsBn, xrpUsd!, priceDecimals!],
        query: { enabled: Boolean(lot && xrpUsd && lotsBn > 0n) },
    });

    const { writeContract, isPending: isWriting, data: txHash } = useWriteContract();

    const averaged = Math.min(3, periods.length);
    const avg = periods.length
        ? periods.slice(-3).reduce((s, r) => s + r.revenueCents, 0n) / BigInt(averaged)
        : 0n;

    const provenTable = (
        <table>
            <thead>
                <tr>
                    <th>Period</th>
                    <th className="right">Proven revenue</th>
                </tr>
            </thead>
            <tbody>
                {periods.map((r, i) => (
                    <tr key={i} className={freshPeriod === String(r.periodEnd) ? "fresh" : undefined}>
                        <td>
                            <span className="mono">
                                {day(r.periodStart)} → {day(r.periodEnd)}
                            </span>
                        </td>
                        <td className="right">
                            <span className="mono amount">{usd(r.revenueCents)}</span>
                            <ProofLine
                                platform={platform}
                                round={r.votingRound}
                                merkleRoot={r.merkleRoot}
                                txHash={txByPeriod[String(r.periodEnd)]}
                            />
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );

    // ------------------------------------------------------------------ before connecting

    if (!isConnected) {
        const newest = periods[periods.length - 1];
        return (
            <>
            <Grain />
            <AppHeader />
            <main className="app-main">
                <h1>Connect a wallet to begin.</h1>
                <p className="lede">
                    Everything below is already live on Coston2 and readable without connecting. A wallet is
                    needed only to sign. This site never signs for you and never holds a key.
                </p>
                <p className="quiet">
                    New here? <Link href="/">The overview explains what this is</Link> before you connect
                    anything.
                </p>

                {/* Shown before connecting too: what the protocol has done is public, and a visitor
                    deciding whether to trust this should not have to connect a wallet to see it. */}
                <ProtocolStrip />

                <Journey
                    connected={false}
                    proven={false}
                    underwritten={false}
                    advanced={false}
                    repaying={false}
                    closed={false}
                />

                {newest && (
                    <>
                        <h2>A real account, right now</h2>
                        <div className="block">
                            <span className="quiet">Proven for the period ending {day(newest.periodEnd)}</span>
                            <span className="figure amount">{usd(newest.revenueCents)}</span>
                            <ProofLine
                                platform={platform}
                                round={newest.votingRound}
                                merkleRoot={newest.merkleRoot}
                                txHash={txByPeriod[String(newest.periodEnd)]}
                            />
                        </div>
                        <p className="quiet" style={{ marginTop: 18 }}>
                            That green line is the whole product. It says which API the figure came from, which FDC
                            voting round agreed on it, and the Merkle root it resolves to. You can check it without
                            asking us anything.
                        </p>
                    </>
                )}

                <h2>How it works</h2>
                <Mechanism />

                <h2>Lend</h2>
                <Lend />

                <h2>What this account has done</h2>
                <ActivityFeed accountId={accountId} />

                <h2>Connect</h2>
                <Connect />
            </main>
            </>
        );
    }

    // ------------------------------------------------------------------ connected

    const open = advance?.open ?? false;
    const wrongChain = walletChainId !== undefined && walletChainId !== flareTestnet.id;
    const isBoundOwner =
        Boolean(boundOwner) &&
        boundOwner !== "0x0000000000000000000000000000000000000000" &&
        boundOwner?.toLowerCase() === address?.toLowerCase();
    const unbound = !boundOwner || boundOwner === "0x0000000000000000000000000000000000000000";

    // What the treasury can actually pay out right now, in dollars.
    const treasuryCents =
        treasury !== undefined && xrpUsd && priceDecimals !== undefined
            ? (treasury * xrpUsd) / 10n ** BigInt(priceDecimals) / 10_000n
            : undefined;
    const treasuryDry = treasury !== undefined && treasury === 0n;

    return (
        <>
        <Grain />
        <AppHeader account={address} onDisconnect={() => disconnect()} />
        <main className="app-main">
            <h1>Ledgerline</h1>
            <div className="row" style={{ padding: 0 }}>
                <span className="mono">
                    {platform}/{view === "stripe" ? accountRef : short(accountRef || "0x")}
                </span>
                <button className="link" onClick={() => disconnect()}>
                    {address?.slice(0, 6)}…{address?.slice(-4)} · disconnect
                </button>
            </div>

            {wrongChain && (
                <div className="block">
                    <p className="alert" style={{ margin: 0 }}>
                        This wallet is on chain {walletChainId}. Ledgerline lives on Coston2, chain id {flareTestnet.id}.
                    </p>
                    <div style={{ marginTop: 12 }}>
                        <button className="wide" onClick={() => switchChain({ chainId: flareTestnet.id })}>
                            Switch to Coston2
                        </button>
                    </div>
                </div>
            )}

            <ProtocolStrip />

            <Journey
                connected={true}
                proven={periods.length > 0}
                underwritten={(limit ?? 0n) > 0n}
                advanced={(advance?.principalCents ?? 0n) > 0n}
                repaying={
                    (advance?.principalCents ?? 0n) > 0n &&
                    (advance?.outstandingCents ?? 0n) <
                        (advance?.principalCents ?? 0n) + (advance?.feeCents ?? 0n)
                }
                closed={(advance?.principalCents ?? 0n) > 0n && !(advance?.open ?? true)}
            />

            <h2>Whose revenue</h2>
            <div className="block">
                <div className="choices">
                    <button className="ghost" aria-pressed={view === "stripe"} onClick={() => setView("stripe")}>
                        Our Stripe account
                    </button>
                    <button className="ghost" aria-pressed={view === "mine"} onClick={() => setView("mine")}>
                        Yours
                    </button>
                </div>
                <p className="quiet" style={{ marginTop: 14, marginBottom: 0 }}>
                    {view === "stripe"
                        ? "A real Stripe sandbox account, bound to the wallet that first proved it. You can read every figure and open every proof."
                        : unbound
                          ? "Nothing proven for your wallet yet. Run an attestation below and this becomes an account you own and can borrow against."
                          : "Proven under your wallet. RevenueOracle bound this account to you the first time you attested for it."}
                </p>
            </div>

            <h2>Proven revenue</h2>
            {periods.length === 0 ? (
                <div className="block">
                    <p style={{ margin: 0 }}>
                        Nothing proven yet for this account. Run an attestation below; the figure appears here the
                        moment the voting round finalises.
                    </p>
                </div>
            ) : (
                provenTable
            )}

            <h2>Prove a period</h2>
            <ProveRevenue
                source={view === "stripe" ? "stripe" : "demo"}
                address={address}
                isBoundOwner={view === "stripe" ? isBoundOwner : true}
                onProven={() => {
                    void refetchHistory();
                }}
            />

            <h2>What you can borrow</h2>
            <div className="block">
                <span className="figure">{usd(limit ?? 0n)}</span>
                <p className="quiet" style={{ marginTop: 16, marginBottom: 0 }}>
                    {periods.length === 0 ? (
                        "Nothing, until a period is proven. There is no other input."
                    ) : (
                        <>
                            The mean of the last {averaged} attested {averaged === 1 ? "period" : "periods"} is{" "}
                            <span className="mono">{usd(avg)}</span>, and this account&apos;s earned factor is{" "}
                            <span className="mono">
                                {factorBps !== undefined ? `${(Number(factorBps) / 100).toFixed(2)}%` : "…"}
                            </span>
                            {cleanCycles !== undefined && Number(cleanCycles) > 0 && (
                                <> after {Number(cleanCycles)} cleanly repaid advance{Number(cleanCycles) === 1 ? "" : "s"}</>
                            )}
                            . New accounts start at 2.5%, deliberately below card-processing fees so faking
                            revenue at yourself costs more than it frees, and every advance repaid in full
                            without delinquency raises it. Every input is on chain.
                        </>
                    )}
                </p>
            </div>

            {!open ? (
                <>
                    <h2>Take an advance</h2>
                    <div className="block">
                        <div className="row">
                            <span>Where the money goes</span>
                            <span className="choices">
                                <button className="ghost" aria-pressed={leg === "fxrp"} onClick={() => setLeg("fxrp")}>
                                    FXRP on Flare
                                </button>
                                <button className="ghost" aria-pressed={leg === "xrpl"} onClick={() => setLeg("xrpl")}>
                                    XRP on the XRP Ledger
                                </button>
                            </span>
                        </div>

                        {leg === "fxrp" ? (
                            <div className="row">
                                <span>Amount in US dollars</span>
                                <input
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    aria-label="Amount in US dollars"
                                />
                            </div>
                        ) : (
                            <>
                                <p className="quiet">
                                    The FXRP is redeemed through FAssets and an agent pays your XRP Ledger account
                                    directly. You never hold FXRP. FAssets redeems whole lots only,{" "}
                                    {lot ? fxrp(lot) : "10"} XRP each, so this route starts at about ten dollars.
                                </p>
                                <div className="row">
                                    <span>Lots</span>
                                    <input value={lots} onChange={(e) => setLots(e.target.value)} aria-label="Lots" />
                                </div>
                                <div className="row">
                                    <span>Your XRP Ledger address</span>
                                    <input
                                        value={xrplAddress}
                                        onChange={(e) => setXrplAddress(e.target.value)}
                                        placeholder="r…"
                                        aria-label="Your XRP Ledger address"
                                    />
                                </div>
                            </>
                        )}

                        <hr className="rule" style={{ margin: "14px 0" }} />

                        <div className="row">
                            <span>You receive</span>
                            <span className="mono">
                                {leg === "fxrp"
                                    ? quoted
                                        ? `${fxrp(quoted)} FXRP`
                                        : "…"
                                    : lot
                                      ? `${fxrp(lot * lotsBn)} XRP less the agent fee`
                                      : "…"}
                            </span>
                        </div>
                        <div className="row">
                            <span>XRP/USD used, from FTSOv2</span>
                            <span className="mono">
                                {xrpUsd ? price(xrpUsd, Number(priceDecimals)) : "…"}{" "}
                                <span className="pending">read {rateSeenAt}</span>
                            </span>
                        </div>
                        <div className="row">
                            <span>You will owe</span>
                            <span className="mono">
                                {(() => {
                                    const base = leg === "fxrp" ? cents : (xrplCents ?? 0n);
                                    const rate = accountFee ?? feeBps;
                                    const fee = rate ? (base * BigInt(rate)) / 10_000n : 0n;
                                    return `${usd(base + fee)} in dollars`;
                                })()}
                            </span>
                        </div>
                        {(credit ?? 0n) > 0n && (
                            <div className="row">
                                <span>Banked credit (XRPL overpayment)</span>
                                <span className="mono">{usd(credit!)} · settles this at origination</span>
                            </div>
                        )}
                        <div className="row">
                            <span>Available to lend now</span>
                            <span className="mono">
                                {treasury === undefined
                                    ? "…"
                                    : `${fxrp(treasury)} FXRP${treasuryCents !== undefined ? ` · ${usd(treasuryCents)}` : ""}`}
                            </span>
                        </div>

                        {/*
                         * Say it plainly rather than letting the button revert. A demo that fails at the last
                         * step in front of a judge is worse than one that explains why it cannot run.
                         */}
                        {treasuryDry && (
                            <p className="alert" style={{ marginTop: 14, marginBottom: 0 }}>
                                No lending liquidity is available right now, so an advance cannot be issued.
                                Everything above is live: the proven revenue, the limit and the price are read
                                from chain. A deposit in the Lend section below reopens originations.
                            </p>
                        )}

                        <div style={{ marginTop: 20 }}>
                            <button
                                className="wide"
                                disabled={
                                    isWriting ||
                                    wrongChain ||
                                    treasuryDry ||
                                    !accountId ||
                                    (leg === "fxrp"
                                        ? cents === 0n || cents > (limit ?? 0n)
                                        : lotsBn === 0n || !xrplAddress || (xrplCents ?? 0n) > (limit ?? 0n))
                                }
                                onClick={() =>
                                    writeContract(
                                        leg === "fxrp"
                                            ? {
                                                  address: MANAGER_ADDRESS,
                                                  abi: managerAbi,
                                                  functionName: "requestAdvance",
                                                  args: [accountId!, cents],
                                              }
                                            : {
                                                  address: MANAGER_ADDRESS,
                                                  abi: managerAbi,
                                                  functionName: "requestAdvanceToXrpl",
                                                  args: [accountId!, lotsBn, xrplAddress],
                                                  // estimateGas comes back short: redemption walks the ticket queue.
                                                  gas: 6_000_000n,
                                              },
                                        { onSuccess: () => setTimeout(() => refetchAdvance(), 4000) }
                                    )
                                }
                            >
                                {isWriting ? "Sending advance…" : "Take advance"}
                            </button>
                            {txHash && (
                                <a
                                    className="proof"
                                    href={`${EXPLORER}/tx/${txHash}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ marginTop: 14 }}
                                >
                                    advance sent<span className="sep">·</span>
                                    {short(txHash)} ↗
                                </a>
                            )}
                        </div>
                    </div>
                </>
            ) : (
                <>
                    <h2>What you owe</h2>
                    <div className="block">
                        <span className="figure">{usd(advance!.outstandingCents)}</span>
                        <p className="quiet" style={{ marginTop: 16 }}>
                            in US dollars. This figure does not move when XRP does.
                        </p>
                        {advance!.delinquent && (
                            <p className="alert" style={{ marginBottom: 0 }}>
                                Marked delinquent. No further advances will be issued to this account.
                            </p>
                        )}
                    </div>

                    <div className="block">
                        <div className="row">
                            <span>Principal</span>
                            <span className="mono">{usd(advance!.principalCents)}</span>
                        </div>
                        <div className="row">
                            <span>Fee</span>
                            <span className="mono">{usd(advance!.feeCents)}</span>
                        </div>
                        <div className="row">
                            <span>Sent to you</span>
                            <span className="mono">{fxrp(advance!.fxrpDisbursed)} FXRP</span>
                        </div>
                        <div className="row">
                            <span>XRP/USD when you borrowed</span>
                            <span className="mono">
                                {price(advance!.xrpUsdPrice, Number(advance!.priceDecimals))}
                            </span>
                        </div>
                        <div className="row">
                            <span>XRP/USD now</span>
                            <span className="mono">{xrpUsd ? price(xrpUsd, Number(priceDecimals)) : "…"}</span>
                        </div>
                        <p className="quiet" style={{ marginTop: 14, marginBottom: 0 }}>
                            Those two rates differ and the amount owed above has not changed. That is what FTSOv2 is
                            doing here. Without it the debt would be denominated in XRP and would move with the
                            price.
                        </p>
                    </div>

                    <h2>Repayment</h2>
                    <div className="block">
                        <p style={{ margin: 0 }}>
                            Each newly proven period repays {shareBps ? Number(shareBps) / 100 : 20}% of that
                            period&apos;s revenue, converted to FXRP at the rate current at that moment. Nobody has to
                            remember to pay; a proven period is the trigger. Prove another period above and watch
                            the figure fall.
                        </p>
                    </div>

                    {/*
                     * Only rendered when the deployed contract actually has an XRPL treasury configured. The
                     * read simply comes back empty on a deployment without it, and the section disappears —
                     * better than describing a route a judge would find reverts.
                     */}
                    {xrplTreasury && (
                        <div className="block">
                            <p style={{ marginTop: 0 }}>
                                Or repay in <strong>real XRP, from the XRP Ledger</strong>. Send an ordinary
                                payment to the account below, carrying this account id as the payment reference,
                                and an FDC <span className="mono">Payment</span> attestation proves it on Flare:
                                a second attestation type, verified the same way the revenue was.
                            </p>
                            <div className="row">
                                <span>Pay to</span>
                                <span className="mono break">{xrplTreasury}</span>
                            </div>
                            <div className="row">
                                <span>Memo, exactly 32 bytes</span>
                                <span className="mono break">{accountId}</span>
                            </div>
                            <p className="quiet" style={{ marginTop: 14, marginBottom: 0 }}>
                                The reference has to be a single memo of exactly that value. The XRP
                                Ledger&apos;s <span className="mono">InvoiceID</span> field looks like the right
                                place and FDC does not read it. Neither leg of this route needs an EVM asset.
                            </p>
                        </div>
                    )}
                </>
            )}

            <h2>Lend</h2>
            <Lend />

            <h2>This account&apos;s history</h2>
            <ActivityFeed accountId={accountId} />

            <h2>How it works</h2>
            <Mechanism />

            <h2>Contracts</h2>
            <div className="block">
                <div className="row">
                    <span>RevenueOracle</span>
                    <a className="mono" href={`${EXPLORER}/address/${ORACLE_ADDRESS}#code`} target="_blank" rel="noreferrer">
                        {short(ORACLE_ADDRESS)} ↗
                    </a>
                </div>
                <div className="row">
                    <span>AdvanceManager</span>
                    <a className="mono" href={`${EXPLORER}/address/${MANAGER_ADDRESS}#code`} target="_blank" rel="noreferrer">
                        {short(MANAGER_ADDRESS)} ↗
                    </a>
                </div>
                <p className="quiet" style={{ marginTop: 12, marginBottom: 0 }}>
                    Both are source-verified on the Coston2 explorer. Every figure on this page is read from them
                    directly; nothing is cached or served from a database.
                </p>
            </div>
        </main>
        </>
    );
}
