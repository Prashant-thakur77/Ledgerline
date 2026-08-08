"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useReadContract, useSimulateContract, useWriteContract } from "wagmi";
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

const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM ?? "demo";
const ACCOUNT_REF = process.env.NEXT_PUBLIC_ACCOUNT_REF ?? "acct_1LedgerlineDemo";

export default function Page() {
    const { address, isConnected } = useAccount();
    const { connect, connectors, isPending } = useConnect();
    const { disconnect } = useDisconnect();
    const [amount, setAmount] = useState("2.00");
    const [leg, setLeg] = useState<"fxrp" | "xrpl">("fxrp");
    const [xrplAddress, setXrplAddress] = useState("");
    const [lots, setLots] = useState("1");

    const { data: accountId } = useReadContract({
        address: ORACLE_ADDRESS,
        abi: oracleAbi,
        functionName: "accountIdFor",
        args: [PLATFORM, ACCOUNT_REF],
    });

    const enabled = { query: { enabled: Boolean(accountId) } };
    const { data: history } = useReadContract({
        address: ORACLE_ADDRESS,
        abi: oracleAbi,
        functionName: "revenueHistory",
        args: [accountId!],
        ...enabled,
    });
    const { data: limit } = useReadContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "advanceLimitCents",
        args: [accountId!],
        ...enabled,
    });
    const { data: advance, refetch: refetchAdvance } = useReadContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "advanceOf",
        args: [accountId!],
        ...enabled,
    });
    const { data: feeBps } = useReadContract({ address: MANAGER_ADDRESS, abi: managerAbi, functionName: "feeBps" });
    const { data: shareBps } = useReadContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "repaymentShareBps",
    });

    // currentXrpUsd is nonpayable because FtsoV2.getFeedById is payable, so it is read by simulation.
    const { data: priceSim } = useSimulateContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "currentXrpUsd",
    });
    const [xrpUsd, priceDecimals] = (priceSim?.result as [bigint, number] | undefined) ?? [undefined, undefined];

    const cents = BigInt(Math.round(parseFloat(amount || "0") * 100));
    const { data: quoted } = useReadContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "usdCentsToFxrp",
        args: [cents, xrpUsd!, priceDecimals!],
        query: { enabled: Boolean(xrpUsd && cents > 0n) },
    });

    const { data: lot } = useReadContract({ address: MANAGER_ADDRESS, abi: managerAbi, functionName: "lotSize" });
    const lotsBn = BigInt(parseInt(lots || "0", 10) || 0);
    const { data: xrplCents } = useReadContract({
        address: MANAGER_ADDRESS,
        abi: managerAbi,
        functionName: "fxrpToUsdCents",
        args: [(lot ?? 0n) * lotsBn, xrpUsd!, priceDecimals!],
        query: { enabled: Boolean(lot && xrpUsd && lotsBn > 0n) },
    });

    const { writeContract, isPending: isWriting, data: txHash } = useWriteContract();

    if (!isConnected) {
        return (
            <main>
                <h1>Borrow against revenue you can prove</h1>
                <p>
                    Your payment processor already knows you earn four thousand dollars a month. No lender can read
                    it, so no lender will price it. Flare&apos;s Data Connector can: it calls the API, the network&apos;s
                    own data providers agree on the answer, and the figure arrives on chain with a Merkle proof — the
                    same way a price feed does. No trusted server vouches for anything.
                </p>
                <p>
                    A contract underwrites an advance against that proven revenue and sends FXRP. The debt is
                    denominated in US dollars using FTSOv2, so you owe dollars rather than taking a bet on the XRP price.
                </p>
                <div className="panel">
                    {connectors.map((c) => (
                        <button key={c.uid} onClick={() => connect({ connector: c })} disabled={isPending}>
                            {isPending ? "Connecting…" : `Connect ${c.name}`}
                        </button>
                    ))}
                    <p className="note">Coston2 testnet, chain id 114. Nothing here uses real money.</p>
                </div>
            </main>
        );
    }

    const open = advance?.open ?? false;
    const periods = history ?? [];
    const avg = periods.length
        ? periods.slice(-3).reduce((s, r) => s + r.revenueCents, 0n) / BigInt(Math.min(3, periods.length))
        : 0n;

    return (
        <main>
            <h1>Ledgerline</h1>
            <p className="mono">
                {address?.slice(0, 6)}…{address?.slice(-4)} ·{" "}
                <a onClick={() => disconnect()} style={{ cursor: "pointer" }}>
                    disconnect
                </a>
            </p>

            <h2>Proven revenue</h2>
            {periods.length === 0 ? (
                <div className="panel">
                    <p style={{ margin: 0 }}>
                        Nothing proven yet for <span className="mono">{PLATFORM}/{ACCOUNT_REF}</span>. Run the
                        attestation script to prove a period on chain.
                    </p>
                </div>
            ) : (
                <div className="panel">
                    {periods.map((r, i) => (
                        <div className="row" key={i}>
                            <span>
                                {day(r.periodStart)} → {day(r.periodEnd)}
                                <span className="proven">verified by FDC</span>
                            </span>
                            <span>{usd(r.revenueCents)}</span>
                        </div>
                    ))}
                    <p className="note">
                        Each figure was returned by the revenue API, reduced by a jq filter, agreed by Flare&apos;s data
                        providers and verified against a Merkle root by{" "}
                        <a href={`${EXPLORER}/address/${ORACLE_ADDRESS}#code`} target="_blank" rel="noreferrer">
                            RevenueOracle
                        </a>{" "}
                        before it was stored. The contract rejects a proof that does not verify.
                    </p>
                </div>
            )}

            <h2>What you can borrow</h2>
            <div className="panel">
                <div className="big">{usd(limit ?? 0n)}</div>
                <p className="note" style={{ marginTop: 10 }}>
                    The mean of your last {Math.min(3, periods.length) || 3} attested periods ({usd(avg)}) × 1.0 for a
                    first advance. Nothing is hidden in that number: the inputs are stored on the advance itself and
                    emitted in an event, so the decision can be audited afterwards.
                </p>
            </div>

            {!open ? (
                <>
                    <h2>Take an advance</h2>
                    <div className="panel">
                        <div className="row">
                            <span>Where should the money go?</span>
                            <span>
                                <button
                                    onClick={() => setLeg("fxrp")}
                                    style={{ opacity: leg === "fxrp" ? 1 : 0.4, marginRight: 8 }}
                                >
                                    FXRP on Flare
                                </button>
                                <button onClick={() => setLeg("xrpl")} style={{ opacity: leg === "xrpl" ? 1 : 0.4 }}>
                                    XRP on the XRP Ledger
                                </button>
                            </span>
                        </div>
                        {leg === "xrpl" && (
                            <p className="note">
                                The FXRP is redeemed through FAssets and an agent pays your XRP Ledger account
                                directly. You never hold FXRP. FAssets redeems whole lots only —{" "}
                                {lot ? fxrp(lot) : "10"} XRP each — so this leg has a floor of about $10.
                            </p>
                        )}
                        {leg === "fxrp" ? (
                            <div className="row">
                                <span>Amount in US dollars</span>
                                <input value={amount} onChange={(e) => setAmount(e.target.value)} />
                            </div>
                        ) : (
                            <>
                                <div className="row">
                                    <span>Lots ({lot ? fxrp(lot) : "10"} XRP each)</span>
                                    <input value={lots} onChange={(e) => setLots(e.target.value)} />
                                </div>
                                <div className="row">
                                    <span>Your XRP Ledger address</span>
                                    <input
                                        value={xrplAddress}
                                        onChange={(e) => setXrplAddress(e.target.value)}
                                        placeholder="r…"
                                        style={{ width: 260 }}
                                        className="mono"
                                    />
                                </div>
                                <div className="row">
                                    <span>Dollar debt this creates</span>
                                    <span>{xrplCents ? usd(xrplCents) : "…"}</span>
                                </div>
                            </>
                        )}
                        <div className="row">
                            <span>XRP/USD, live from FTSOv2</span>
                            <span>{xrpUsd ? price(xrpUsd, Number(priceDecimals)) : "…"}</span>
                        </div>
                        <div className="row">
                            <span>{leg === "fxrp" ? "FXRP you would receive" : "XRP that will reach your XRPL account"}</span>
                            <span>
                                {leg === "fxrp"
                                    ? quoted
                                        ? fxrp(quoted)
                                        : "…"
                                    : lot
                                      ? `${fxrp(lot * lotsBn)} less the agent's fee`
                                      : "…"}
                            </span>
                        </div>
                        <div className="row">
                            <span>Fee</span>
                            <span>{feeBps ? `${Number(feeBps) / 100}%` : "…"}</span>
                        </div>
                        <div style={{ marginTop: 16 }}>
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
                                                  // Redemption walks the ticket queue and estimateGas comes
                                                  // back well short of what it actually needs.
                                                  gas: 6_000_000n,
                                              },
                                        { onSuccess: () => setTimeout(() => refetchAdvance(), 4000) }
                                    )
                                }
                            >
                                {isWriting
                                    ? "Sending…"
                                    : leg === "fxrp"
                                      ? `Borrow ${usd(cents)}`
                                      : `Borrow ${xrplCents ? usd(xrplCents) : "…"} as XRP`}
                            </button>
                        </div>
                        {txHash && (
                            <p className="note">
                                <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">
                                    View transaction
                                </a>
                            </p>
                        )}
                    </div>
                </>
            ) : (
                <>
                    <h2>Your advance</h2>
                    <div className="panel">
                        <div className="big">{usd(advance!.outstandingCents)}</div>
                        <p className="note" style={{ marginTop: 10, marginBottom: 18 }}>
                            owed, in US dollars. This figure does not move when XRP does.
                        </p>
                        <div className="row">
                            <span>Principal</span>
                            <span>{usd(advance!.principalCents)}</span>
                        </div>
                        <div className="row">
                            <span>Fee</span>
                            <span>{usd(advance!.feeCents)}</span>
                        </div>
                        <div className="row">
                            <span>FXRP actually sent to you</span>
                            <span>{fxrp(advance!.fxrpDisbursed)}</span>
                        </div>
                        <div className="row">
                            <span>XRP/USD at origination</span>
                            <span>{price(advance!.xrpUsdPrice, Number(advance!.priceDecimals))}</span>
                        </div>
                        <div className="row">
                            <span>XRP/USD right now</span>
                            <span>{xrpUsd ? price(xrpUsd, Number(priceDecimals)) : "…"}</span>
                        </div>
                        <div className="row">
                            <span>Underwritten from</span>
                            <span>
                                {advance!.periodsUsed} period(s), mean {usd(advance!.avgRevenueCents)} ×{" "}
                                {Number(advance!.factorBps) / 10000}
                            </span>
                        </div>
                        {advance!.delinquent && (
                            <p className="note" style={{ color: "#f85149" }}>
                                This advance is marked delinquent. No further advances will be issued to this account.
                            </p>
                        )}
                    </div>

                    <h2>Repayment</h2>
                    <div className="panel">
                        <p style={{ margin: 0 }}>
                            Each newly attested period repays {shareBps ? Number(shareBps) / 100 : 20}% of that
                            period&apos;s revenue, converted to FXRP at the rate current at that moment. The dollar
                            obligation falls by the dollar amount repaid, whatever XRP is worth on the day.
                        </p>
                    </div>
                </>
            )}

            <h2>Contracts</h2>
            <div className="panel mono">
                <div className="row">
                    <span>RevenueOracle</span>
                    <a href={`${EXPLORER}/address/${ORACLE_ADDRESS}#code`} target="_blank" rel="noreferrer">
                        {ORACLE_ADDRESS}
                    </a>
                </div>
                <div className="row">
                    <span>AdvanceManager</span>
                    <a href={`${EXPLORER}/address/${MANAGER_ADDRESS}#code`} target="_blank" rel="noreferrer">
                        {MANAGER_ADDRESS}
                    </a>
                </div>
            </div>
        </main>
    );
}
