import type { Metadata } from "next";
import { Fraunces, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const sans = Inter_Tight({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });
// The editorial voice: a display serif for headlines, italic for the words that carry the argument.
const display = Fraunces({
    subsets: ["latin"],
    variable: "--font-display",
    display: "swap",
    style: ["normal", "italic"],
    weight: "variable",
    axes: ["opsz"],
});

export const metadata: Metadata = {
    title: "Proofline · Prove revenue. Borrow.",
    description: "Borrow against revenue your payment processor already proves, settled in FXRP on Flare.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable}`}>
            <body>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
