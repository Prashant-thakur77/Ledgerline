"use client";

import { useEffect, useRef, useState } from "react";
import {
    useAccount,
    useConnect,
    useDisconnect,
    usePublicClient,
    useReadContract,
    useSimulateContract,
    useWriteContract,
} from "wagmi";
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

const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM ?? "stripe";
const ACCOUNT_REF = process.env.NEXT_PUBLIC_ACCOUNT_REF ?? "acct_1U2HbaRh1zuX9OfD";

const SOURCE_LABEL: Record<string, string> = {
    stripe: "stripe balance transactions",
    demo: "public demo endpoint",
};

function short(hash: string) {
    return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

/**
 * The signature element. Under every attested figure, and under nothing else.
 * Names where the fact came from and how it was checked, and opens the transaction that verified it.
 */
function ProofLine({ round, merkleRoot, txHash }: { round: bigint; merkleRoot: string; txHash?: string }) {
    const body = (
        <>
            verified<span className="sep">·</span>
            {SOURCE_LABEL[PLATFORM] ?? PLATFORM}
            <span className="sep">·</span>fdc round {round.toLocaleString("en-US")}
            <span className="sep">·</span>merkle {short(merkleRoot)}
            {txHash ? " ↗" : ""}
        </>
    );
    return txHash ? (
        <a className="proof" href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">
            {body}
        </a>
    ) : (
        <span className="proof">{body}</span>
    );
}

export default function Page() {
    const { address, isConnected } = useAccount();
    const { connect, connectors, isPending } = useConnect();
    const { disconnect } = useDisconnect();
    const client = usePublicClient();

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
        args: [PLATFORM, ACCOUNT_REF],
    });

    // Polls, so an attestation landing while the page is open animates in rather than needing a refresh.
    const on = { query: { enabled: Boolean(accountId), refetchInterval: 12_000 } };
    const { data: history } = useReadContract({
        address: ORACLE_ADDRESS,
        abi: oracleAbi,
        functionName: "revenueHistory",
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
    const { data: feeBps } = useReadContract({ address: MANAGER_ADDRESS, abi: managerAbi, functionName: "feeBps" });
    const { data: shareBps } = useReadContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "repaymentShareBps",
    });
    const { data: lot } = useReadContract({ address: MANAGER_ADDRESS, abi: managerAbi, functionName: "lotSize" });

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

    // Map each proven period to the transaction that proved it, so the proof line opens the real thing.
    useEffect(() => {
        if (!client || !accountId || periods.length === 0) return;
        void (async () => {
            try {
                const logs = await client.getLogs({
                    address: ORACLE_ADDRESS,
                    event: {
                        type: "event",
                        name: "RevenueProven",
                        inputs: [
                            { name: "accountId", type: "bytes32", indexed: true },
                            { name: "owner", type: "address", indexed: true },
                            { name: "revenueCents", type: "uint256" },
                            { name: "periodStart", type: "uint64" },
                            { name: "periodEnd", type: "uint64" },
                            { name: "votingRound", type: "uint64" },
                            { name: "merkleRoot", type: "bytes32" },
                        ],
                    },
                    args: { accountId },
                    fromBlock: "earliest",
                });
                const next: Record<string, string> = {};
                for (const l of logs) {
                    const end = (l as any).args?.periodEnd;
                    if (end !== undefined) next[String(end)] = l.transactionHash!;
                }
                setTxByPeriod(next);
            } catch {
                /* logs are a nicety; the proof line still shows round and root without them */
            }
        })();
    }, [client, accountId, periods.length]);

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
                                {day(r.periodStart)} — {day(r.periodEnd)}
                            </span>
                        </td>
                        <td className="right">
                            <span className="mono amount">{usd(r.revenueCents)}</span>
                            <ProofLine
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
            <main>
                <h1>Borrow against revenue you can prove.</h1>
                <p className="lede">
                    Your payment processor already knows you earn four thousand dollars a month. No lender can read
                    it, so no lender will price it.
                </p>
                <p>
                    Flare&apos;s Data Connector reads it instead. It calls the API, the network&apos;s own data
                    providers agree on the answer, and the figure arrives on chain with a Merkle proof — proven the
                    way a price feed is proven. Nobody vouches for it. There is nobody to bribe.
                </p>

                {newest && (
                    <>
                        <h2>A real account, right now</h2>
                        <div className="block">
                            <span className="quiet">Proven for the period ending {day(newest.periodEnd)}</span>
                            <span className="figure amount">{usd(newest.revenueCents)}</span>
                            <ProofLine
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

                <h2>Connect</h2>
                <div className="block">
                    {connectors.map((c) => (
                        <button key={c.uid} onClick={() => connect({ connector: c })} disabled={isPending}>
                            {isPending ? "Connecting…" : `Connect ${c.name}`}
                        </button>
                    ))}
                    <p className="quiet" style={{ marginTop: 14, marginBottom: 0 }}>
                        Coston2 testnet, chain id 114. No real money is involved.
                    </p>
                </div>
            </main>
        );
    }

    // ------------------------------------------------------------------ connected

    const open = advance?.open ?? false;

    return (
        <main>
            <h1>Ledgerline</h1>
            <div className="row" style={{ padding: 0 }}>
                <span className="mono">
                    {PLATFORM}/{ACCOUNT_REF}
                </span>
                <button className="link" onClick={() => disconnect()}>
                    {address?.slice(0, 6)}…{address?.slice(-4)} · disconnect
                </button>
            </div>

            <h2>Proven revenue</h2>
            {periods.length === 0 ? (
                <div className="block">
                    <p style={{ margin: 0 }}>
                        Connect a revenue account to prove your earnings. Run the attestation script and the figure
                        appears here the moment the voting round finalises.
                    </p>
                </div>
            ) : (
                provenTable
            )}

            <h2>What you can borrow</h2>
            <div className="block">
                <span className="figure">{usd(limit ?? 0n)}</span>
                <p className="quiet" style={{ marginTop: 16, marginBottom: 0 }}>
                    The mean of your last {averaged} attested {averaged === 1 ? "period" : "periods"} is{" "}
                    <span className="mono">{usd(avg)}</span>. A first advance is one times that mean. Nothing else
                    goes into it, and the inputs are stored on the advance itself so the decision can be checked
                    afterwards.
                </p>
            </div>

            {!open ? (
                <>
                    <h2>Take an advance</h2>
                    <div className="block">
                        <div className="row">
                            <span>Where the money goes</span>
                            <span>
                                <button
                                    className="ghost"
                                    aria-pressed={leg === "fxrp"}
                                    onClick={() => setLeg("fxrp")}
                                    style={{ marginRight: 8 }}
                                >
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
                                    directly. You never hold FXRP. FAssets redeems whole lots only, {lot ? fxrp(lot) : "10"}{" "}
                                    XRP each, so this route starts at about ten dollars.
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
                                        style={{ width: 240 }}
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
                                    const fee = feeBps ? (base * BigInt(feeBps)) / 10_000n : 0n;
                                    return `${usd(base + fee)} in dollars`;
                                })()}
                            </span>
                        </div>

                        <div style={{ marginTop: 20 }}>
                            <button
                                disabled={
                                    isWriting ||
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
                            doing here — without it the debt would be denominated in XRP and would move with the
                            price.
                        </p>
                    </div>

                    <h2>Repayment</h2>
                    <div className="block">
                        <p style={{ margin: 0 }}>
                            Each newly proven period repays {shareBps ? Number(shareBps) / 100 : 20}% of that
                            period&apos;s revenue, converted to FXRP at the rate current at that moment. Nobody has to
                            remember to pay; a proven period is the trigger.
                        </p>
                    </div>
                </>
            )}

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
            </div>
        </main>
    );
}
