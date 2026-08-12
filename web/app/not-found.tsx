import Link from "next/link";
import { Grain, Mark } from "./components/Chrome";

/** One screen, in the product's voice: even the dead end states what is true. */
export default function NotFound() {
    return (
        <>
            <Grain />
            <main className="landing">
                <section className="hero" style={{ minHeight: "100svh" }}>
                    <div className="shell hero-in">
                        <p className="eyebrow">404</p>
                        <h1>
                            Nothing proven
                            <br />
                            <span className="grad">at this address.</span>
                        </h1>
                        <p className="lede narrow">
                            The page you asked for does not exist. Everything that does is one level up.
                        </p>
                        <div className="cta">
                            <Link href="/" className="btn">Back to the start</Link>
                            <Link href="/app" className="btn ghost-btn">Open the app</Link>
                        </div>
                    </div>
                </section>
            </main>
        </>
    );
}
