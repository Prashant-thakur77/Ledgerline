"use client";

import { useAccount, useDisconnect } from "wagmi";
import { AppHeader } from "../../components/AppHeader";
import { Grain } from "../../components/Chrome";
import { Lend } from "../../components/Lend";
import { EXPLORER, POOL_ADDRESS } from "@/lib/contracts";

/**
 * The lender's room.
 *
 * A lender and a borrower have nothing to say to each other on one page: one is underwriting the other.
 * This page owns the LP side entirely: what the pool holds, what a deposit earns, and the two risks the
 * vault's accounting makes true rather than hiding. The deposit form lives with its disclosures, not a
 * scroll away from them.
 */
export default function LendPage() {
    const { address } = useAccount();
    const { disconnect } = useDisconnect();

    return (
        <>
            <Grain />
            <AppHeader account={address} onDisconnect={() => disconnect()} />
            <main className="app-main">
                <h1>
                    Fund the
                    <br />
                    <span className="grad">advances.</span>
                </h1>
                <p className="lede">
                    An ERC-4626 vault of FXRP. Deposits fund every advance the protocol originates, and the
                    origination fees and repayment flow land in the share price, visibly.
                </p>
                <p className="quiet">
                    Withdrawals are limited to idle liquidity because an advance cannot be recalled, and a
                    vault that promised otherwise would be lying to its first stressed depositor. Lending
                    stops at 80% utilisation so withdrawing stays possible.
                </p>

                <Lend />

                <p className="quiet" style={{ marginTop: 18 }}>
                    Need FXRP? It is minted from real XRP through{" "}
                    <a href="https://dev.flare.network/fassets/minting" target="_blank" rel="noreferrer">
                        FAssets
                    </a>
                    . This app spends and redeems it; minting lives with the protocol itself.
                </p>

                <h2>What you are underwriting</h2>
                <div className="block">
                    <p>
                        This is unsecured credit against attested revenue. The tier schedule prices a first
                        advance below the card fees it would cost to fake the revenue behind it. Risk is
                        premium-priced into the origination fee, and defaults are written off against the
                        pool with the junior buffer absorbing first. Two exposures are yours by design:
                    </p>
                    <p>
                        <strong>XRP/USD drift.</strong> Debts are denominated in dollars and pool assets in
                        FXRP, so the FXRP returned for a repaid dollar moves with the price between
                        disbursement and repayment.
                    </p>
                    <p style={{ marginBottom: 0 }}>
                        <strong>XRPL-side settlements arrive off-pool.</strong> A repayment proven from the
                        XRP Ledger settles the debt and books a receivable here until the operator re-mints
                        that XRP into FXRP. The claim is attested and counted; the token itself arrives
                        later.
                    </p>
                </div>

                <h2>The vault, on chain</h2>
                <div className="block">
                    <div className="row">
                        <span>LenderPool (ERC-4626)</span>
                        <a
                            className="mono"
                            href={`${EXPLORER}/address/${POOL_ADDRESS}#code`}
                            target="_blank"
                            rel="noreferrer"
                        >
                            {POOL_ADDRESS.slice(0, 8)}…{POOL_ADDRESS.slice(-6)} ↗
                        </a>
                    </div>
                    <p className="quiet" style={{ marginTop: 12, marginBottom: 0 }}>
                        Source-verified. Every number above is read from it directly, and the share-price
                        arithmetic can be checked against the contract by hand.
                    </p>
                </div>
            </main>
        </>
    );
}
