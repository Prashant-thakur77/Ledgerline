import Link from "next/link";
import type { Metadata } from "next";
import { Grain, SiteHeader } from "../components/Chrome";
import { EXPLORER, ORACLE_ADDRESS, MANAGER_ADDRESS, POOL_ADDRESS } from "@/lib/contracts";

export const metadata: Metadata = {
    title: "Docs · Proofline",
    description: "How Proofline turns a payment processor's records into on-chain credit, in detail.",
};

const REPO = "https://github.com/Prashant-thakur77/Ledgerline";

/**
 * The documentation, written as a document rather than rendered from markdown: every section is designed,
 * the palette rules hold (green only on attested facts), and nothing is generated. A reader who finishes
 * this page knows the full trust model and where every number comes from.
 */
export default function Docs() {
    return (
        <>
            <Grain />
            <SiteHeader />

            <main className="landing docspage">
                <section>
                    <div className="shell">
                        <p className="eyebrow">Documentation</p>
                        <h1>
                            How it
                            <br />
                            <span className="grad">works.</span>
                        </h1>
                        <p className="lede narrow">
                            Proofline turns a payment processor&apos;s records into on-chain credit. This page
                            is the whole mechanism, in the order the money moves, with the exact Flare
                            protocol named at each step.
                        </p>

                        <nav className="toc" aria-label="Contents">
                            <a href="#proving">01 · Proving revenue</a>
                            <a href="#underwriting">02 · Underwriting</a>
                            <a href="#money">03 · The money legs</a>
                            <a href="#repayment">04 · Repayment</a>
                            <a href="#pool">05 · The lender pool</a>
                            <a href="#confidential">06 · Confidential path</a>
                            <a href="#addresses">07 · Addresses</a>
                        </nav>
                    </div>
                </section>

                <section id="proving">
                    <div className="shell">
                        <p className="eyebrow">01 · FDC Web2Json</p>
                        <h2>Proving revenue</h2>
                        <div className="narrow">
                            <p>
                                An attestation request names an API endpoint, a jq reduction, and an ABI
                                shape. Every one of Flare&apos;s data providers calls the same API, runs the
                                same reduction, and must agree on the result; the agreed answer is committed
                                in a 90-second voting round and published under a Merkle root by the Relay.
                                <strong> No single server vouches for the figure, so there is nobody to
                                bribe.</strong>
                            </p>
                            <p>
                                <code>RevenueOracle</code> verifies the Merkle proof against Flare&apos;s own
                                verification contract, derives the account identity from the attested payload
                                rather than from the caller, and stores the period. Three rules make the
                                stored history underwritable:
                            </p>
                            <p>
                                <strong>Periods cannot overlap.</strong> Three windows shifted by a day each
                                would otherwise count as three months of history while covering one month of
                                revenue.
                            </p>
                            <p>
                                <strong>A period must be a month.</strong> 26 to 32 days. The underwriting
                                prices each record as one month&apos;s takings, so a single attestation
                                covering a year of honest revenue would otherwise be priced as a month and
                                borrow an order of magnitude past policy.
                            </p>
                            <p>
                                <strong>The first prover owns the account.</strong> Later attestations must
                                come from the same wallet, and moving to a new wallet takes a rotation with a
                                three-day public delay, cancellable by the owner the whole time.
                            </p>
                        </div>
                    </div>
                </section>

                <section id="underwriting">
                    <div className="shell">
                        <p className="eyebrow">02 · Policy</p>
                        <h2>Underwriting</h2>
                        <div className="narrow">
                            <p>
                                The limit is <code>min(mean of last 3 periods, latest period) × factor</code>,
                                so a collapsing business is priced on its collapse rather than its history.
                                The factor is earned:
                            </p>
                            <p>
                                <strong>2.5% base.</strong> Deliberately below card-processing fees (~2.9%).
                                The fundamental attack on revenue-based credit is paying yourself through
                                your own processor and defaulting; a first advance smaller than the fees paid
                                to fabricate it makes the attack lose money before any other signal is
                                consulted.
                            </p>
                            <p>
                                <strong>+20 points per cleanly repaid advance</strong>, up to 1.0×. A cycle
                                counts only if the advance was never delinquent, and credit-closed advances
                                earn nothing, so the tier cannot be farmed.
                            </p>
                            <p>
                                <strong>Account age gates everything.</strong> Under 30 attested days (or
                                with no attested age), the factor stays at base regardless of history. Each
                                proven month beyond the first adds 8 points, which is how a real business
                                with a year of history starts above the cold-start floor: faking that year
                                would cost a year of card fees.
                            </p>
                            <p>
                                <strong>Risk is priced, not hoped away.</strong> The origination fee is 5%
                                plus a premium of up to 4% that melts to zero as the factor approaches the
                                cap: tier-0 borrowers pay for the book&apos;s expected loss.
                            </p>
                            <p>
                                The debt is denominated in US cents and converted through FTSOv2&apos;s
                                XRP/USD feed at each movement, with the feed&apos;s own decimals and a
                                staleness bound: a feed older than an hour, or timestamped in the future,
                                refuses to price anything. Advances also carry a 180-day term, so a token
                                repayment inside each 45-day grace window cannot hold a balance open forever.
                            </p>
                            <p>
                                <strong>And it underwrites the way acquirers do.</strong> Revenue inside the
                                120-day refund window is haircut by age (settled card revenue is not final
                                money, and no acquirer treats it as such). 10% of each advance is escrowed
                                as a rolling reserve that releases on a clean close or once the window
                                passes. A repayment floor curve makes revenue share amortise the way
                                platform lenders&apos; books do. Merchants can route settlements through
                                an on-chain lockbox that splits repayment out atomically, springing to full
                                withholding while an account is behind. The mechanisms and their live
                                evidence are on <Link href="/roadmap">the roadmap</Link>.
                            </p>
                        </div>
                    </div>
                </section>

                <section id="money">
                    <div className="shell">
                        <p className="eyebrow">03 · FAssets</p>
                        <h2>The money legs</h2>
                        <div className="narrow">
                            <p>
                                <strong>FXRP on Flare.</strong> The pool transfers FXRP to the borrower;
                                the obligation is recorded in dollars at the FTSO rate at that moment.
                            </p>
                            <p>
                                <strong>Real XRP on the XRP Ledger.</strong> <code>requestAdvanceToXrpl</code>{" "}
                                redeems the FXRP through FAssets and an agent pays the borrower&apos;s XRPL
                                address directly. The borrower never holds an EVM asset, and if the request
                                is placed on their behalf, never needs an EVM wallet. A redemption that fills
                                short of the requested lots reverts rather than booking dollars against XRP
                                nobody sent.
                            </p>
                        </div>
                    </div>
                </section>

                <section id="repayment">
                    <div className="shell">
                        <p className="eyebrow">04 · FDC Payment</p>
                        <h2>Repayment</h2>
                        <div className="narrow">
                            <p>
                                <strong>Revenue repays it.</strong> Each newly proven period lets anyone
                                trigger a repayment of 20% of that period&apos;s revenue, pulled from the
                                borrower&apos;s FXRP allowance. A proven period is the trigger; nobody has to
                                remember to pay.
                            </p>
                            <p>
                                <strong>Or a plain XRP payment.</strong> The borrower pays the treasury
                                address on the XRP Ledger carrying their account id as the payment reference
                                (one memo, exactly 32 bytes). A second FDC attestation type, Payment, proves
                                the transaction happened, and the same Merkle machinery verifies it on
                                Flare. Each XRPL transaction can be consumed once; payments can be
                                batch-settled; the account owner may bind repayments to a single XRPL sender.
                                Overpayment becomes credit that settles the next advance at origination,
                                because an XRPL payment cannot be refunded without custodying a hot key.
                            </p>
                            <p>
                                Delinquency is recorded after 45 days of silence or at the 180-day term, and
                                blocks the account for good. A write-off requires a second full grace period
                                and formally takes the loss against the pool.
                            </p>
                        </div>
                    </div>
                </section>

                <section id="pool">
                    <div className="shell">
                        <p className="eyebrow">05 · ERC-4626</p>
                        <h2>The lender pool</h2>
                        <div className="narrow">
                            <p>
                                Deposits mint shares against <code>idle + lent + attested receivables − junior</code>.
                                Origination fees and repayment flow land in the share price; write-offs
                                consume the protocol-owned junior buffer first and reach the share price only
                                beyond its depth, and both amounts are in the event. Lending stops at 80%
                                utilisation; withdrawals are limited to idle liquidity because an advance
                                cannot be recalled, and <code>maxWithdraw</code> says so honestly.
                            </p>
                            <p>
                                Two exposures are the depositor&apos;s by design and are printed where the
                                money enters: XRP/USD drift between disbursement and repayment, and XRPL-side
                                settlements that book as receivables until the operator re-mints the XRP into
                                FXRP.
                            </p>
                        </div>
                    </div>
                </section>

                <section id="confidential">
                    <div className="shell">
                        <p className="eyebrow">06 · Flare Confidential Compute</p>
                        <h2>The confidential path</h2>
                        <div className="narrow">
                            <p>
                                Public revenue is the adoption blocker: almost no business will publish its
                                monthly takings permanently. The same underwriting therefore also runs inside
                                a TEE on Flare&apos;s shared platform, where revenue goes in and only the
                                decision comes out. It is registered and has run live, and it produces the
                                same answer as the public path.{" "}
                                <Link href="/confidential">The evidence has its own page.</Link>
                            </p>
                        </div>
                    </div>
                </section>

                <section id="addresses">
                    <div className="shell">
                        <p className="eyebrow">07 · Coston2, chain id 114</p>
                        <h2>Addresses</h2>
                        <div className="block" style={{ maxWidth: 720 }}>
                            {[
                                ["RevenueOracle", ORACLE_ADDRESS],
                                ["AdvanceManager", MANAGER_ADDRESS],
                                ["LenderPool", POOL_ADDRESS],
                                ["RevenueSplitter", "0xf7982B48D4005F2aa5b2d7AE030996D1d19eD727"],
                                ["PrivateUnderwriter", "0x66cB73a6326F7e6541DA95f5fB2236d8b4f4fc4a"],
                                ["GovernanceTimelock", "0x10eBCE7B70f859E3754832862A34B1B0fE45C37A"],
                            ].map(([name, addr]) => (
                                <div className="row" key={name}>
                                    <span>{name}</span>
                                    <a
                                        className="mono"
                                        href={`${EXPLORER}/address/${addr}#code`}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        {addr.slice(0, 10)}…{addr.slice(-8)} ↗
                                    </a>
                                </div>
                            ))}
                            <p className="quiet" style={{ marginTop: 14, marginBottom: 0 }}>
                                All source-verified. The repository ships <code>verify-claims.ts</code>,
                                which resolves every transaction cited in the documentation against the
                                chain and fails if any claim is not backed.
                            </p>
                        </div>
                    </div>
                </section>
            </main>
        </>
    );
}
