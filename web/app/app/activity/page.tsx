"use client";

import { useAccount, useDisconnect, useReadContract } from "wagmi";
import { AppHeader } from "../../components/AppHeader";
import { Grain } from "../../components/Chrome";
import { Mechanism } from "../../components/Mechanism";
import { ProtocolStrip, ActivityFeed } from "../../components/Activity";
import { TwoLedgers } from "../../components/TwoLedgers";
import { EXPLORER, ORACLE_ADDRESS, MANAGER_ADDRESS, oracleAbi } from "@/lib/contracts";

const STRIPE_ACCOUNT_REF = process.env.NEXT_PUBLIC_ACCOUNT_REF ?? "acct_1U2HbaRh1zuX9OfD";

/**
 * The auditor's room: everything the protocol has done, and how it does it.
 *
 * No forms, no wallet requirement, nothing to sign. This page exists so that checking up on the product is
 * its own activity rather than a scroll past the borrowing forms: the event feed rebuilt from the
 * contracts' own logs, the mechanism reference, and the addresses everything above can be verified against.
 */
export default function ActivityPage() {
    const { address } = useAccount();
    const { disconnect } = useDisconnect();

    const { data: accountId } = useReadContract({
        address: ORACLE_ADDRESS,
        abi: oracleAbi,
        functionName: "accountIdFor",
        args: ["stripe", STRIPE_ACCOUNT_REF],
    });

    return (
        <>
            <Grain />
            <AppHeader account={address} onDisconnect={() => disconnect()} />
            <main className="app-main">
                <h1>
                    Every move,
                    <br />
                    <span className="grad">on chain.</span>
                </h1>
                <p className="lede">
                    There is no database behind this product. Everything below is rebuilt from events the
                    contracts emitted, and anyone with the addresses can reproduce it without asking us.
                </p>

                <ProtocolStrip />

                <h2>Both ledgers, right now</h2>
                <TwoLedgers />

                <h2>The featured account&apos;s history</h2>
                <ActivityFeed accountId={accountId as `0x${string}` | undefined} />

                <h2>How it works</h2>
                <Mechanism />

                <h2>Contracts</h2>
                <div className="block">
                    <div className="row">
                        <span>RevenueOracle</span>
                        <a
                            className="mono"
                            href={`${EXPLORER}/address/${ORACLE_ADDRESS}#code`}
                            target="_blank"
                            rel="noreferrer"
                        >
                            {ORACLE_ADDRESS.slice(0, 8)}…{ORACLE_ADDRESS.slice(-6)} ↗
                        </a>
                    </div>
                    <div className="row">
                        <span>AdvanceManager</span>
                        <a
                            className="mono"
                            href={`${EXPLORER}/address/${MANAGER_ADDRESS}#code`}
                            target="_blank"
                            rel="noreferrer"
                        >
                            {MANAGER_ADDRESS.slice(0, 8)}…{MANAGER_ADDRESS.slice(-6)} ↗
                        </a>
                    </div>
                    <p className="quiet" style={{ marginTop: 12, marginBottom: 0 }}>
                        Source-verified on the Coston2 explorer. Every figure in the app is read from them
                        directly; nothing is cached or served from a database.
                    </p>
                </div>
            </main>
        </>
    );
}
