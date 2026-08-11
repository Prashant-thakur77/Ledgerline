import Link from "next/link";
import type { Metadata } from "next";
import { Mechanism } from "./components/Mechanism";
import { LiveProof } from "./components/LiveProof";

export const metadata: Metadata = {
    title: "Ledgerline — borrow against revenue you can prove",
    description:
        "Your payment processor already proves you earn four thousand dollars a month. No lender can read it, and Flare's Data Connector can. Advances against attested revenue, settled in FXRP or real XRP.",
};

const EXPLORER = "https://coston2-explorer.flare.network";
const XRPL = "https://testnet.xrpl.org";
const REPO = "https://github.com/Prashant-thakur77/Ledgerline";

/**
 * The landing page.
 *
 * A judge or a lender arriving cold needs the argument before the interface: what the problem is, why it
 * cannot be solved without Flare, and evidence that it has actually been done. The application itself lives
 * at /app behind a deliberate "open the app" step, because a wallet prompt is a terrible first impression
 * and most visitors want to read before they connect.
 *
 * Everything here is static except one element — the attested figure, which is read live from the contract.
 * That is the point: the page makes a claim and then shows the claim being true.
 */
export default function Landing() {
    return (
        <>
            <header className="siteheader">
                <div className="siteheader-in">
                    <Link href="/" className="brand">
                        Ledgerline
                    </Link>
                    <nav>
                        <a href="#how">How it works</a>
                        <a href="#evidence">Evidence</a>
                        <a href={REPO} target="_blank" rel="noreferrer">
                            GitHub
                        </a>
                        <Link href="/app" className="btn-link">
                            Open the app
                        </Link>
                    </nav>
                </div>
            </header>

            <main className="landing">
                {/* ---------------------------------------------------------------- hero */}
                <section className="hero rise">
                    <p className="eyebrow">Flare Summer Signal · Interoperable Asset Products</p>
                    <h1>Borrow against revenue you can prove.</h1>
                    <p className="lede">
                        Your payment processor already knows you earn four thousand dollars a month. No lender
                        can read it, so no lender will price it.
                    </p>
                    <p>
                        Flare&apos;s Data Connector reads it instead. It calls the API, the network&apos;s own
                        data providers agree on the answer, and the figure arrives on chain with a Merkle proof
                        — proven the way a price feed is proven. Nobody vouches for it. There is nobody to
                        bribe.
                    </p>
                    <div className="cta">
                        <Link href="/app" className="btn">
                            Open the app
                        </Link>
                        <a className="btn ghost-btn" href="#how">
                            See how it works
                        </a>
                    </div>
                    <p className="quiet" style={{ marginTop: 18 }}>
                        Live on Coston2 testnet. You can run a real FDC attestation yourself — no Stripe
                        account needed.
                    </p>
                </section>

                {/* ---------------------------------------------------------------- live proof */}
                <section className="rise">
                    <h2>Not a mock. Read from the contract, right now.</h2>
                    <LiveProof />
                    <p className="quiet" style={{ marginTop: 18 }}>
                        That green line is the whole product. It names which API the figure came from, which
                        FDC voting round agreed on it, and the Merkle root it resolves to — and it opens the
                        transaction that verified it. You can check every part of it without asking us
                        anything.
                    </p>
                </section>

                {/* ---------------------------------------------------------------- problem */}
                <section className="rise">
                    <h2>Why this cannot be built without Flare</h2>
                    <div className="cards">
                        <div className="card">
                            <h3>A contract cannot read a Stripe dashboard</h3>
                            <p>
                                So on chain, someone with real earnings is indistinguishable from someone
                                claiming the same number with nothing behind it. Anyone can say anything.
                            </p>
                        </div>
                        <div className="card">
                            <h3>The usual workaround reinstates the middleman</h3>
                            <p>
                                Trust a company&apos;s server to sign the figure, and you have rebuilt exactly
                                the intermediary the system was supposed to remove — with a single key to
                                steal or subpoena.
                            </p>
                        </div>
                        <div className="card">
                            <h3>FDC removes it</h3>
                            <p>
                                Every data provider calls the API independently, runs the same deterministic
                                reduction, and has to agree. The result is relayed as a Merkle root and
                                verified on chain.
                            </p>
                        </div>
                    </div>
                </section>

                {/* ---------------------------------------------------------------- mechanism */}
                <section id="how" className="rise">
                    <h2>How it works</h2>
                    <Mechanism />
                </section>

                {/* ---------------------------------------------------------------- evidence */}
                <section id="evidence" className="rise">
                    <h2>It has actually been run</h2>
                    <p>
                        Every hash below is on Coston2 or the XRP Ledger testnet and can be opened. The
                        repository ships a script,{" "}
                        <a href={`${REPO}/blob/main/scripts/ledgerline/verify-claims.ts`} target="_blank" rel="noreferrer">
                            <code>verify-claims.ts</code>
                        </a>
                        , that resolves every transaction cited in the documentation against the chain and
                        fails if any claim is not backed.
                    </p>

                    <h3 className="sub">Revenue, proven from a live Stripe API call</h3>
                    <ul className="evidence">
                        <li>
                            <span>$3,916.78 attested, FDC round 1,422,337</span>
                            <a className="mono" href={`${EXPLORER}/tx/0x8abab9c34593df83554f8f43a4fed3e06bea898695eca1ad9971b32b258b15a7`} target="_blank" rel="noreferrer">
                                0x8abab9c3… ↗
                            </a>
                        </li>
                    </ul>

                    <h3 className="sub">
                        The loop closes — funded in real XRP, repaid in real XRP
                    </h3>
                    <ul className="evidence">
                        <li>
                            <span>Advance redeemed through FAssets, one lot</span>
                            <a className="mono" href={`${EXPLORER}/tx/0x63f50a21ec6dc5638ec28ffa63f15413e8c6d580e1f52037a76d5b92144dfa92`} target="_blank" rel="noreferrer">
                                0x63f50a21… ↗
                            </a>
                        </li>
                        <li>
                            <span>An agent paid +9.95 XRP on the XRP Ledger</span>
                            <span className="mono quiet">debt on Flare: $10.53</span>
                        </li>
                        <li>
                            <span>Repaid with a plain 5 XRP payment, one 32-byte memo</span>
                            <a className="mono" href={`${XRPL}/transactions/10E4F29BC5608E5438964ECB3147D34600869D389186C612505678CEE4E70AD5`} target="_blank" rel="noreferrer">
                                10E4F29B… ↗
                            </a>
                        </li>
                        <li>
                            <span>FDC Payment proof verified, debt settled on Flare</span>
                            <a className="mono" href={`${EXPLORER}/tx/0x99d0f4b26d70bc47fda3be9954741597ab7df17afe2d2d7798d2cbae198a6144`} target="_blank" rel="noreferrer">
                                0x99d0f4b2… ↗
                            </a>
                        </li>
                        <li>
                            <span>Owed</span>
                            <span className="mono">$10.53 → $5.51</span>
                        </li>
                    </ul>

                    <p className="quiet">
                        The borrower held no FXRP and signed no EVM transaction to receive the money or to
                        repay it. Data crossed from Web2 into Flare through FDC Web2Json; value crossed out to
                        the XRP Ledger through FAssets and back through FDC Payment. The obligation itself
                        never left Flare, and was never denominated in anything but dollars.
                    </p>
                </section>

                {/* ---------------------------------------------------------------- honesty */}
                <section className="rise">
                    <h2>What is honest about it</h2>
                    <p>
                        <strong>This is unsecured credit.</strong> A borrower can take an advance and stop
                        earning, and nothing here prevents that. Revenue history is the reputation: defaults
                        are recorded on chain, and advances start small and grow with repayment history.
                    </p>
                    <p>
                        <strong>The Stripe key is published on chain.</strong> FDC attestation requests are
                        public calldata, so the API key travels in the clear. That breaks confidentiality, not
                        trust — the figure is still proven by the network rather than vouched for by us. It is
                        a read-only restricted key scoped to two endpoints, and the code refuses a full secret
                        key outright.
                    </p>
                    <p>
                        <strong>Publishing revenue publicly is the real adoption blocker</strong>, and the fix
                        is Flare Confidential Compute: run the underwriting inside a TEE and publish only the
                        decision. That is specified in the README and deliberately not built — the honest move
                        four days out is to name the weakness rather than ship it badly.
                    </p>
                    <p className="quiet">
                        No users yet, and it would be dishonest to imply otherwise. The sandbox source exists
                        so a stranger can run the whole loop against their own wallet without a Stripe account
                        or anything from us.
                    </p>
                </section>

                {/* ---------------------------------------------------------------- final cta */}
                <section className="rise finalcta">
                    <h2>Try it</h2>
                    <p>
                        Connect any wallet on Coston2 and run a real FDC attestation against an account bound
                        to your own address. It takes about two minutes, and the page narrates every step with
                        links to Flare&apos;s explorers you can open while the voting round is still open.
                    </p>
                    <div className="cta">
                        <Link href="/app" className="btn">
                            Open the app
                        </Link>
                        <a className="btn ghost-btn" href={REPO} target="_blank" rel="noreferrer">
                            Read the source
                        </a>
                    </div>
                </section>

                <footer className="sitefooter">
                    <p className="quiet">
                        Coston2 testnet, chain id 114 · contracts source-verified ·{" "}
                        <a href={`${EXPLORER}/address/0x80D08369E1a34e8c7C43FCF947323e56e6B87Be6#code`} target="_blank" rel="noreferrer">
                            RevenueOracle
                        </a>{" "}
                        ·{" "}
                        <a href={`${EXPLORER}/address/0x63fC5a5c422D40DcC8FA267384BA5351d8698A58#code`} target="_blank" rel="noreferrer">
                            AdvanceManager
                        </a>{" "}
                        ·{" "}
                        <a href={REPO} target="_blank" rel="noreferrer">
                            MIT licensed
                        </a>
                    </p>
                </footer>
            </main>
        </>
    );
}
