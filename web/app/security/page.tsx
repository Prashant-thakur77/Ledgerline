import Link from "next/link";
import type { Metadata } from "next";
import { Grain, Mark } from "../components/Chrome";

export const metadata: Metadata = {
    title: "Security · Proofline",
    description: "The trust model, the adversarial audit of our own deployment, and what is deliberately not claimed.",
};

const REPO = "https://github.com/Prashant-thakur77/Ledgerline";

/**
 * The security page: what has to be trusted, what was found when we attacked our own deployment, and what
 * is deliberately not claimed. Publishing your own audit trail is unusual; that is exactly why it is here.
 */
const FINDINGS = [
    {
        title: "Credit could retire principal before it was lent",
        body: "Banked credit applied inside origination, before the pool transferred the funds. An advance closed entirely by credit left principal on the pool's books that no repayment would ever return, silently inflating the share price. Credit now applies only after the money moves.",
    },
    {
        title: "XRP arriving with no open advance was never booked",
        body: "The payment became spendable credit while the pool recorded no claim, so that credit later drained FXRP the pool was never credited for. The receivable is now booked for the whole payment, debt or no debt.",
    },
    {
        title: "The price feed's age was never checked",
        body: "Every dollar figure converts through FTSOv2's XRP/USD. A stalled feed would size advances at yesterday's price and settle repayments at a rate that cheats whichever side the market moved against. Feeds older than an hour, or timestamped in the future, now refuse to price anything.",
    },
    {
        title: "A one-cent drip held a balance open forever",
        body: "Every repayment refreshed the delinquency clock, so paying one cent inside each 45-day grace window kept a six-figure balance current indefinitely. Advances now carry a 180-day term as a second, independent delinquency trigger.",
    },
    {
        title: "A short FAssets fill was booked as full",
        body: "The redemption's return value was ignored, so an agent filling nine tenths of the requested lots left the borrower owing dollars against XRP nobody sent. An under-filled redemption now reverts the advance.",
    },
    {
        title: "A 'period' could be a year",
        body: "The attestation window is chosen by whoever builds the request, and underwriting prices each period as one month. A single honest attestation covering a year would have borrowed an order of magnitude past policy. Periods must now span 26 to 32 days.",
    },
];

export default function Security() {
    return (
        <>
            <Grain />
            <header className="siteheader">
                <div className="siteheader-in">
                    <Link href="/" className="brand">
                        <Mark />
                        Proofline
                    </Link>
                    <nav>
                        <Link href="/docs" style={{ textDecoration: "none" }}>Docs</Link>
                        <Link href="/confidential" style={{ textDecoration: "none" }}>Confidential</Link>
                        <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
                        <Link href="/app" className="btn">Open the app</Link>
                    </nav>
                </div>
            </header>

            <main className="landing">
                <section>
                    <div className="shell">
                        <p className="eyebrow">Security</p>
                        <h1>
                            We attacked
                            <br />
                            <span className="grad">our own product.</span>
                        </h1>
                        <p className="lede narrow">
                            An adversarial pass over every money path in the deployed contracts, each
                            suspicion written as a failing test before any fix. Six real defects came out of
                            it. They are listed below because a lending protocol that hides its own audit
                            trail is asking to be trusted twice.
                        </p>
                    </div>
                </section>

                <section>
                    <div className="shell">
                        <p className="eyebrow">Findings · all fixed, all tested, all redeployed</p>
                        <h2>Six defects, found and fixed</h2>
                        <div className="cards" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
                            {FINDINGS.map((f, i) => (
                                <div className="card" key={f.title}>
                                    <span className="card-n">{String(i + 1).padStart(2, "0")}</span>
                                    <h3>{f.title}</h3>
                                    <p>{f.body}</p>
                                </div>
                            ))}
                        </div>
                        <p className="quiet narrow" style={{ marginTop: 24 }}>
                            The current deployment carries every fix, and the full cycle has been exercised
                            on it live: attest, borrow from the pool, repay, books closing exactly. 144
                            automated tests, including a 200-step randomised invariant walk over the pool
                            accounting.
                        </p>
                    </div>
                </section>

                <section>
                    <div className="shell">
                        <p className="eyebrow">Trust model</p>
                        <h2>What you have to trust, and what you do not</h2>
                        <div className="narrow">
                            <p>
                                <strong>Attested by a network, not by us:</strong> every revenue figure (FDC
                                Web2Json, provider quorum, Merkle proof), every XRPL repayment (FDC Payment),
                                and every XRP/USD conversion (FTSOv2). The contracts verify proofs against
                                Flare&apos;s own verification contract; account identity is derived from
                                attested payloads, never from the caller.
                            </p>
                            <p>
                                <strong>Trusted, today:</strong> the policy levers (tier schedule, fees,
                                terms, pause on originations) and the write-off pen sit behind an on-chain
                                timelock: every owner action is proposed publicly and waits out the delay
                                before it executes, so borrowers and LPs see changes coming. The delay is
                                an hour on Coston2 so the mechanism is demonstrable; production would carry
                                days. The operator re-mints XRPL-side repayments back into the pool, with
                                the junior buffer absorbing failures first. Repayments are deliberately
                                unpausable, so an operational decision cannot manufacture delinquencies.
                            </p>
                            <p>
                                <strong>Structural:</strong> this is unsecured credit. A borrower can take an
                                advance and stop earning; delinquency is recorded on chain and blocks the
                                account forever, and that is the whole of the enforcement. The tier schedule
                                exists so that discovering this costs the attacker more than the advance.
                            </p>
                        </div>
                    </div>
                </section>

                <section>
                    <div className="shell">
                        <p className="eyebrow">Known limits</p>
                        <h2>What is still open, and what closing it costs</h2>
                        <div className="narrow">
                            <p>
                                <strong>Distributed default.</strong> One person, many processor accounts,
                                many small first advances, defaulting on all. Each account needs a month of
                                attested age and real revenue, so the attack is slow and mostly unprofitable,
                                but it is bounded by policy rather than by identity. Closing it takes an
                                identity attestation, which is another Web2Json source, not a redesign.
                            </p>
                            <p>
                                <strong>Refund lag.</strong> Revenue proven this month can be refunded next
                                month, after an advance is out. The next period prices the collapse
                                (<code>min(mean, latest)</code>) and processors keep their fees on refunds,
                                so fabrication still loses money, but a one-cycle window exists. Closing it
                                tightly means attesting refund totals as their own field.
                            </p>
                            <p>
                                <strong>Nobody is paid to report delinquency.</strong>{" "}
                                <code>markDelinquent</code> is permissionless but unrewarded. The fix is a
                                small keeper bounty from the pool, and it is deliberately not deployed this
                                close to a deadline: a money-touching change ships with tests or not at all.
                            </p>
                            <p>
                                <strong>The API key in calldata: closed.</strong> FDC requests are public,
                                so on the public path the read-only key travels in the clear. The enclave
                                path now removes it: a live TEE op reads the processor itself, the
                                instruction carries only an account reference and a window, and the on-chain
                                calldata verifiably contains no credential and no revenue figure. Same
                                decision as the public path.
                            </p>
                            <p className="quiet">
                                Each of these maps to a mechanism the incumbent industry already
                                uses, researched and sequenced in{" "}
                                <a
                                    href="https://github.com/Prashant-thakur77/Ledgerline/blob/main/docs/REALWORLD-PLAN.md"
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    the real-world plan
                                </a>
                                : splitter lockboxes replicate deduction-at-source without the
                                processor, rolling reserves treat recent revenue as provisional the
                                way every acquirer does, KYB with beneficial-owner resolution makes
                                identity the unit of exposure, and keeper bounties pay the watchman.
                            </p>
                            <p>
                                <strong>Jurisdiction.</strong> Revenue-based financing is regulated activity
                                in most places: loan-versus-sale characterisation, collections, disclosure.
                                No contract fixes this. A real deployment operates behind a licensed
                                originator, and the protocol&apos;s job is to make that originator unable to
                                lie about the numbers.
                            </p>
                        </div>
                    </div>
                </section>

                <section>
                    <div className="shell">
                        <p className="eyebrow">Verify it yourself</p>
                        <h2>Nothing above asks to be believed</h2>
                        <p className="narrow">
                            The repository ships <code>verify-claims.ts</code>, which resolves every
                            transaction hash cited anywhere in the documentation against Coston2 and fails if
                            any claim is not backed by the chain. The contracts are source-verified, the
                            tests run with one command, and the app reads every figure it shows directly from
                            the contracts.{" "}
                            <a href={REPO} target="_blank" rel="noreferrer">
                                Read the source.
                            </a>
                        </p>
                    </div>
                </section>
            </main>
        </>
    );
}
