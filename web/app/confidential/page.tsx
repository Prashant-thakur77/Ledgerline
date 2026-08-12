import Link from "next/link";
import type { Metadata } from "next";
import { Grain, Mark } from "../components/Chrome";
import { PrivateDecision } from "../components/PrivateDecision";

export const metadata: Metadata = {
    title: "Confidential · Proofline",
    description: "Underwriting inside a TEE on Flare: revenue goes in, only the decision comes out.",
};

const REPO = "https://github.com/Prashant-thakur77/Ledgerline";
const EXPLORER = "https://coston2-explorer.flare.network";

/**
 * The Confidential Compute evidence, on its own page.
 *
 * This is the answer to the product's hardest objection, and it is real, registered, and executed on
 * Flare's shared TEE platform. Burying it in a card on the landing page undersold the strongest single
 * claim this project can make: the same number from three different trust models.
 */
export default function Confidential() {
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
                        <Link href="/security" style={{ textDecoration: "none" }}>Security</Link>
                        <a href={REPO} target="_blank" rel="noreferrer">GitHub</a>
                        <Link href="/app" className="btn">Open the app</Link>
                    </nav>
                </div>
            </header>

            <main className="landing">
                <section>
                    <div className="shell">
                        <p className="eyebrow">Flare Confidential Compute</p>
                        <h1>
                            Proven,
                            <br />
                            <span className="grad">not published.</span>
                        </h1>
                        <p className="lede narrow">
                            Almost no business will put its monthly revenue on a public chain, permanently.
                            That is not a small caveat for revenue-based credit; it is the adoption ceiling.
                            So the underwriting also runs inside a trusted enclave on Flare&apos;s own TEE
                            platform: the attested revenue goes in, and only the decision comes out.
                        </p>
                    </div>
                </section>

                <section>
                    <div className="shell">
                        <p className="eyebrow">Registered, and executed</p>
                        <h2>It has run, on the real platform</h2>
                        <p className="narrow">
                            This is not a local simulation of the idea. The extension is registered on
                            Flare&apos;s shared TEE platform on Coston2, its machine reached PRODUCTION
                            status, and Flare&apos;s own data providers have carried a real underwriting
                            instruction into the enclave.
                        </p>
                        <div className="block" style={{ maxWidth: 760 }}>
                            <div className="row">
                                <span>Extension</span>
                                <span className="mono">66180</span>
                            </div>
                            <div className="row">
                                <span>TEE machine</span>
                                <span className="mono">0x0f42321d… · status 2, PRODUCTION</span>
                            </div>
                            <div className="row">
                                <span>Code measurement</span>
                                <span className="mono">0x194844cf… · whitelisted</span>
                            </div>
                            <div className="row">
                                <span>Instruction on chain</span>
                                <a
                                    className="mono"
                                    href={`${EXPLORER}/tx/0x7b77dc2fe6e733761c35568f8ff013b74f3d98a408642a57e770c38b0f864131`}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    0x7b77dc2f… ↗
                                </a>
                            </div>
                            <div className="row">
                                <span>Went in</span>
                                <span>one proven period, $3,916.78</span>
                            </div>
                            <div className="row">
                                <span>Came out</span>
                                <span className="mono">limit $97.91 · factor 2.5% · fee 8.9%</span>
                            </div>
                            <div className="row">
                                <span>And with the key in the enclave</span>
                                <a
                                    className="mono"
                                    href={`${EXPLORER}/tx/0x8a9e95937a1843ec76164b5db1fc1633ea274c0bb45137a1635c37d18ed68e88`}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    0x8a9e9593… ↗
                                </a>
                            </div>
                            <p className="quiet" style={{ marginTop: 14, marginBottom: 0 }}>
                                The revenue figure appears nowhere in the response. In the second run the
                                enclave read the processor itself: the calldata verifiably contains no API
                                key and no figure, just an account reference and a month window. That is the
                                entire point.
                            </p>
                        </div>
                    </div>
                </section>

                <section>
                    <div className="shell">
                        <p className="eyebrow">The claim worth making</p>
                        <h2>Three trust models, one answer</h2>
                        <p className="narrow">
                            The same account is priced three ways: by the public contract anyone can read, by
                            an enclave-signed decision verified on chain against a registered code
                            measurement, and by the live TEE platform run above. All three say{" "}
                            <strong>$97.91</strong>. Privacy costs nothing in correctness, and either path
                            can be checked against the other.
                        </p>
                        <PrivateDecision />
                        <div className="block" style={{ maxWidth: 760 }}>
                            <div className="row">
                                <span>Public path · AdvanceManager</span>
                                <span className="mono">$97.91</span>
                            </div>
                            <div className="row">
                                <span>Enclave decision stored on chain</span>
                                <a
                                    className="mono"
                                    href={`${EXPLORER}/tx/0x8b32907ea847421be70bacd8e5754752236cbbf673afd7dfbec6568832ff0de5`}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    $97.91 · 0x8b32907e… ↗
                                </a>
                            </div>
                            <div className="row">
                                <span>Live TEE platform run</span>
                                <span className="mono">$97.91</span>
                            </div>
                        </div>
                        <p className="quiet narrow" style={{ marginTop: 18 }}>
                            The verifier contract, PrivateUnderwriter, accepts a decision only under a valid
                            enclave signature over the decision and the registered code measurement, with
                            staleness and replay guards. Changing the underwriting policy changes the hash:
                            a public, governed rollout.
                        </p>
                    </div>
                </section>

                <section>
                    <div className="shell">
                        <p className="eyebrow">Still honest</p>
                        <h2>What is not claimed</h2>
                        <p className="narrow">
                            This runs a simulated TEE, which the Coston2 platform supports through to
                            PRODUCTION: the code measurement is reported by the proxy rather than attested by
                            confidential hardware. Moving to real hardware changes who vouches for the
                            measurement, not how anything above is verified. The full build, registration
                            record and reproduction steps are in{" "}
                            <a href={`${REPO}/tree/main/fcc`} target="_blank" rel="noreferrer">
                                the repository
                            </a>
                            .
                        </p>
                    </div>
                </section>
            </main>
        </>
    );
}
