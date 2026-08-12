import Link from "next/link";
import type { Metadata } from "next";
import { Mechanism } from "./components/Mechanism";
import { LiveProof } from "./components/LiveProof";
import { Tilt } from "./components/Tilt";
import { RevenueLine } from "./components/RevenueLine";
import { HeroStrip } from "./components/HeroStrip";
import { Reveal } from "./components/Reveal";
import { Stat } from "./components/Stat";
import { FlareBadge, Mark, Marquee, Grain, ScrollProgress, CardGrid, MaskedWords } from "./components/Chrome";

export const metadata: Metadata = {
    title: "Proofline · Prove revenue. Borrow.",
    description:
        "Prove your revenue on chain. Borrow against it. Your revenue repays it. Built on Flare.",
};

const EXPLORER = "https://coston2-explorer.flare.network";
const XRPL = "https://testnet.xrpl.org";
const REPO = "https://github.com/Prashant-thakur77/Ledgerline";

/**
 * The landing page.
 *
 * Someone arriving cold needs the argument before the interface: what the problem is, why it cannot be
 * solved without Flare, and evidence it has actually been done. The application lives at /app behind a
 * deliberate step, because opening on a wallet prompt asks for trust before giving any reason to extend it.
 *
 * Everything here is static except one element — the attested figure, read live from the contract. The page
 * makes a claim and then shows the claim being true, before the visitor has connected anything.
 */
export default function Landing() {
    return (
        <>
            <Grain />
            <ScrollProgress />

            <header className="siteheader">
                <div className="siteheader-in">
                    <Link href="/" className="brand">
                        <Mark />
                        Proofline
                        <span className="brand-tag">prove revenue · borrow</span>
                    </Link>
                    <nav>
                        <Link href="/docs">Docs</Link>
                        <Link href="/security">Security</Link>
                        <a href={REPO} target="_blank" rel="noreferrer">
                            GitHub
                        </a>
                        <Link href="/app" className="btn">
                            Open the app
                        </Link>
                    </nav>
                </div>
            </header>

            <main className="landing">
                {/* ---------------------------------------------------------------- hero */}
                <section className="hero">
                    <RevenueLine />
                    <div className="shell hero-in">
                        <Reveal>
                            <p className="eyebrow">Flare Summer Signal · live on Coston2</p>
                        </Reveal>
                        <Reveal delay={70}>
                            {/* Two lines, one voice: the first in white, the turn of the sentence in grey. */}
                            <h1>
                                <MaskedWords text="Prove revenue." />
                                <br />
                                <span className="grad">
                                    <MaskedWords text="Borrow against it." />
                                </span>
                            </h1>
                        </Reveal>
                        <div className="hero-cols">
                            <Reveal delay={160}>
                                <p className="lede narrow" style={{ marginBottom: 0 }}>
                                    Your payment processor already knows what you earn. No lender can read
                                    it, so no lender will price it. Flare&apos;s Data Connector reads it
                                    instead. The network&apos;s own providers agree on the figure, and it
                                    lands on chain with a Merkle proof. Nobody vouches for it. There is
                                    nobody to bribe.
                                </p>
                            </Reveal>
                            <Reveal delay={240}>
                                <div className="cta" style={{ marginTop: 0 }}>
                                    <Link href="/app" className="btn">
                                        Open the app
                                    </Link>
                                    <a className="btn ghost-btn" href="#how">
                                        How it works
                                    </a>
                                </div>
                            </Reveal>
                        </div>
                        <Reveal delay={320}>
                            <HeroStrip />
                        </Reveal>
                    </div>
                </section>

                <Marquee />

                {/* ---------------------------------------------------------------- live proof */}
                <section id="proof">
                    <div className="shell">
                        <Reveal>
                            <p className="eyebrow">
                                <span className="dot">●</span> Live from the contract
                            </p>
                            <h2>Not a mock. Read from Coston2, right now.</h2>
                        </Reveal>
                        <Reveal delay={80}>
                            <Tilt>
                                <LiveProof />
                            </Tilt>
                        </Reveal>
                        <Reveal delay={140}>
                            <p className="narrow" style={{ marginTop: 26 }}>
                                That green line is the whole product. It names which API the figure came from,
                                which FDC voting round agreed on it, and the Merkle root it resolves to, and
                                it opens the transaction that verified it.{" "}
                                <strong>You can check every part of it without asking us anything.</strong>
                            </p>
                        </Reveal>

                        <Reveal delay={180}>
                            <div className="stats">
                                <Stat value={144} label="automated tests, all passing" />
                                <Stat value={2} label="FDC attestation types, both load-bearing" />
                                <Stat value={116} suffix="s" label="measured, request to verified on chain" />
                                <Stat value={0} label="keys this site holds" />
                            </div>
                        </Reveal>
                    </div>
                </section>

                {/* ---------------------------------------------------------------- problem */}
                <section>
                    <div className="shell">
                        <Reveal>
                            <p className="eyebrow">The gap</p>
                            <h2>Why this cannot be built without Flare</h2>
                        </Reveal>
                        <CardGrid>
                            {[
                                {
                                    n: "01",
                                    h: "A contract cannot read a Stripe dashboard",
                                    p: "So on chain, someone with real earnings is indistinguishable from someone claiming the same number with nothing behind it. Anyone can say anything.",
                                },
                                {
                                    n: "02",
                                    h: "The usual workaround reinstates the middleman",
                                    p: "Trust a company's server to sign the figure and you have rebuilt exactly the intermediary the system was supposed to remove, with a single key to steal or subpoena.",
                                },
                                {
                                    n: "03",
                                    h: "FDC removes it",
                                    p: "Every data provider calls the API independently, runs the same deterministic reduction, and has to agree. The result is relayed as a Merkle root and verified on chain.",
                                },
                            ].map((c, i) => (
                                <Reveal key={c.n} delay={i * 90} className="card">
                                    <span className="card-n">{c.n}</span>
                                    <h3>{c.h}</h3>
                                    <p>{c.p}</p>
                                </Reveal>
                            ))}
                        </CardGrid>
                    </div>
                </section>

                {/* ---------------------------------------------------------------- mechanism */}
                <section id="how">
                    <div className="shell">
                        <Reveal>
                            <p className="eyebrow">The mechanism</p>
                            <h2>From a Stripe balance to XRP in a wallet</h2>
                            <p className="narrow" style={{ marginTop: 20 }}>
                                Seven stages, in the order they actually happen. The two marked in green are
                                the ones a network agreed on. Everything else is ordinary machinery.
                            </p>
                        </Reveal>
                        <Reveal delay={80}>
                            <Mechanism />
                        </Reveal>
                    </div>
                </section>

                {/* ---------------------------------------------------------------- evidence */}
                <section>
                    <div className="shell">
                        <Reveal>
                            <p className="eyebrow">Receipts</p>
                            <h2>It has actually been run</h2>
                            <p className="narrow" style={{ marginTop: 20 }}>
                                Every hash below is on Coston2 or the XRP Ledger testnet and can be opened.
                                The repository ships{" "}
                                <a href={`${REPO}/blob/main/scripts/ledgerline/verify-claims.ts`} target="_blank" rel="noreferrer">
                                    <code>verify-claims.ts</code>
                                </a>
                                , which resolves every transaction cited in the documentation against the
                                chain and fails if any claim is not backed.
                            </p>
                        </Reveal>

                        <Reveal delay={70}>
                            <h3 className="sub">Revenue, proven from a live Stripe API call</h3>
                            <ul className="evidence">
                                <li>
                                    <span>$3,916.78 attested · FDC round 1,422,337</span>
                                    <a href={`${EXPLORER}/tx/0x8abab9c34593df83554f8f43a4fed3e06bea898695eca1ad9971b32b258b15a7`} target="_blank" rel="noreferrer">
                                        0x8abab9c3… ↗
                                    </a>
                                </li>
                            </ul>
                        </Reveal>

                        <Reveal delay={110}>
                            <h3 className="sub">The loop closes: funded in real XRP, repaid in real XRP</h3>
                            <ul className="evidence">
                                <li>
                                    <span>Advance redeemed through FAssets, one lot</span>
                                    <a href={`${EXPLORER}/tx/0x63f50a21ec6dc5638ec28ffa63f15413e8c6d580e1f52037a76d5b92144dfa92`} target="_blank" rel="noreferrer">
                                        0x63f50a21… ↗
                                    </a>
                                </li>
                                <li>
                                    <span>An agent paid +9.95 XRP on the XRP Ledger</span>
                                    <span className="mono quiet">debt on Flare: $10.53</span>
                                </li>
                                <li>
                                    <span>Repaid with a plain 5 XRP payment, one 32-byte memo</span>
                                    <a href={`${XRPL}/transactions/10E4F29BC5608E5438964ECB3147D34600869D389186C612505678CEE4E70AD5`} target="_blank" rel="noreferrer">
                                        10E4F29B… ↗
                                    </a>
                                </li>
                                <li>
                                    <span>FDC Payment proof verified, debt settled on Flare</span>
                                    <a href={`${EXPLORER}/tx/0x99d0f4b26d70bc47fda3be9954741597ab7df17afe2d2d7798d2cbae198a6144`} target="_blank" rel="noreferrer">
                                        0x99d0f4b2… ↗
                                    </a>
                                </li>
                                <li>
                                    <span>Owed</span>
                                    <span className="mono">$10.53 → $5.51</span>
                                </li>
                            </ul>
                        </Reveal>

                        <Reveal delay={150}>
                            <p className="narrow" style={{ marginTop: 30 }}>
                                The borrower held no FXRP and signed no EVM transaction to receive the money
                                or to repay it. Data crossed from Web2 into Flare through FDC Web2Json; value
                                crossed out to the XRP Ledger through FAssets and back through FDC Payment.{" "}
                                <strong>
                                    The obligation itself never left Flare, and was never denominated in
                                    anything but dollars.
                                </strong>
                            </p>
                        </Reveal>
                    </div>
                </section>

                {/* ---------------------------------------------------------------- honesty */}
                <section>
                    <div className="shell">
                        <Reveal>
                            <p className="eyebrow">Limitations</p>
                            <h2>What is honest about it</h2>
                        </Reveal>
                        <CardGrid>
                            {[
                                {
                                    h: "This is unsecured credit",
                                    p: "A borrower can take an advance and stop earning, and nothing here prevents that. Revenue history is the reputation: defaults are recorded on chain, and advances start small and grow with repayment history.",
                                },
                                {
                                    h: "The Stripe key is published on chain",
                                    p: "FDC requests are public calldata, so the key travels in the clear. That breaks confidentiality, not trust: the figure is still proven by the network. It is a read-only restricted key, and the code refuses a full secret key outright.",
                                },
                                {
                                    h: "Public revenue is the adoption blocker",
                                    p: "Almost no business will publish its monthly revenue permanently. The fix is Flare Confidential Compute, and it is built: our extension is registered on Flare's TEE platform, and its data providers have carried a real underwriting instruction into the enclave. $3,916.78 of proven revenue went in, a $97.91 limit came out, and the revenue appears nowhere. Same answer as the public path.",
                                },
                            ].map((c, i) => (
                                <Reveal key={c.h} delay={i * 90} className="card">
                                    <h3>{c.h}</h3>
                                    <p>{c.p}</p>
                                </Reveal>
                            ))}
                        </CardGrid>
                        <Reveal delay={200}>
                            <p className="quiet narrow" style={{ marginTop: 32 }}>
                                No users yet, and it would be dishonest to imply otherwise. The sandbox source
                                exists so a stranger can run the whole loop against their own wallet without a
                                Stripe account or anything from us.
                            </p>
                        </Reveal>
                    </div>
                </section>

                {/* ---------------------------------------------------------------- final cta */}
                <section>
                    <div className="shell">
                        <Reveal>
                            <h2>Run an attestation yourself.</h2>
                            <p className="narrow" style={{ marginTop: 20 }}>
                                Connect any wallet on Coston2 and prove a period against an account bound to
                                your own address. It takes about two minutes, and the page narrates every step
                                with links to Flare&apos;s explorers you can open while the voting round is
                                still open.
                            </p>
                            <div className="cta">
                                <Link href="/app" className="btn">
                                    Open the app →
                                </Link>
                                <a className="btn ghost-btn" href={REPO} target="_blank" rel="noreferrer">
                                    Read the source
                                </a>
                            </div>
                        </Reveal>
                    </div>
                </section>

                <footer className="sitefooter">
                    <div className="shell sitefooter-grid">
                        <div className="foot-brand">
                            <FlareBadge compact />
                            <p className="quiet" style={{ marginTop: 16 }}>
                                Proofline. Prove your revenue on chain, borrow against it, and let the
                                revenue repay it. Coston2 testnet, chain 114. MIT licensed.
                            </p>
                        </div>
                        <div className="foot-col">
                            <div className="foot-title">Contracts</div>
                            <a href={`${EXPLORER}/address/0x639ca7C10DC1619d7cAA2B5a286372345194864b#code`} target="_blank" rel="noreferrer">RevenueOracle</a>
                            <a href={`${EXPLORER}/address/0x24f2c925679e737174103A5F6715b766E3D5D602#code`} target="_blank" rel="noreferrer">AdvanceManager</a>
                            <a href={`${EXPLORER}/address/0x38560eE630071846158F639a217E6a0fB2d66Fe2#code`} target="_blank" rel="noreferrer">LenderPool</a>
                            <a href={`${EXPLORER}/address/0x66cB73a6326F7e6541DA95f5fB2236d8b4f4fc4a#code`} target="_blank" rel="noreferrer">PrivateUnderwriter</a>
                        </div>
                        <div className="foot-col">
                            <div className="foot-title">Evidence</div>
                            <a href={`${EXPLORER}/tx/0x8b32907ea847421be70bacd8e5754752236cbbf673afd7dfbec6568832ff0de5`} target="_blank" rel="noreferrer">Private underwriting</a>
                            <a href={`${XRPL}/transactions/10E4F29BC5608E5438964ECB3147D34600869D389186C612505678CEE4E70AD5`} target="_blank" rel="noreferrer">XRPL repayment</a>
                            <a href={`${REPO}/blob/main/scripts/ledgerline/verify-claims.ts`} target="_blank" rel="noreferrer">Verify every claim</a>
                        </div>
                        <div className="foot-col">
                            <div className="foot-title">Site</div>
                            <Link href="/docs">Docs</Link>
                            <Link href="/security">Security</Link>
                            <Link href="/confidential">Confidential</Link>
                            <Link href="/app/lend">Lend</Link>
                        </div>
                        <div className="foot-col">
                            <div className="foot-title">Source</div>
                            <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
                            <a href={`${REPO}/blob/main/README.md`} target="_blank" rel="noreferrer">README</a>
                            <a href={`${REPO}/blob/main/docs/ROADMAP.md`} target="_blank" rel="noreferrer">Roadmap</a>
                            <a href={`${REPO}/blob/main/docs/RESOLUTIONS.md`} target="_blank" rel="noreferrer">Security model</a>
                        </div>
                    </div>
                </footer>
            </main>
        </>
    );
}
