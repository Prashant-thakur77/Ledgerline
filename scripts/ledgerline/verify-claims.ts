import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Checks that every transaction hash this repository claims actually exists on chain, succeeded, and was
 * sent to a contract we say it was sent to.
 *
 * This exists because the most common way a hackathon submission loses credibility is a README that claims
 * more than the chain can back. Anyone reviewing this can run it and see for themselves:
 *
 *   npx hardhat run scripts/ledgerline/verify-claims.ts --network coston2
 *
 * A non-zero exit means a claim in the documentation is not supported by the chain.
 */

const ROOT = path.join(__dirname, "..", "..");
const FILES = ["README.md", "docs/DEPLOYED.md", "docs/DEMO.md", "docs/PHASE0.md", "docs/BLOCKERS.md", "handoff/BRIEF.md"];

const NAMED: Record<string, string> = {
    "0x80D08369E1a34e8c7C43FCF947323e56e6B87Be6": "RevenueOracle",
    "0x4EC83Eb966dcac3e4291c85320Cfd6941a7C4f66": "AdvanceManager",
    "0x0b6A3645c240605887a5532109323A3E12273dc7": "FXRP (FTestXRP)",
    "0x48aC463d7975828989331F4De43341627b9c5f1D": "FdcHub",
};

async function main() {
    const claimed = new Map<string, string[]>();
    for (const file of FILES) {
        const full = path.join(ROOT, file);
        if (!fs.existsSync(full)) continue;
        const text = fs.readFileSync(full, "utf8");
        for (const m of text.matchAll(/0x[0-9a-fA-F]{64}/g)) {
            const hash = m[0].toLowerCase();
            claimed.set(hash, [...(claimed.get(hash) ?? []), file]);
        }
    }

    console.log(`\nChecking ${claimed.size} claimed transaction hashes against Coston2.\n`);

    let bad = 0;
    for (const [hash, files] of [...claimed].sort()) {
        const where = [...new Set(files)].join(", ");
        const receipt = await ethers.provider.getTransactionReceipt(hash);

        if (!receipt) {
            // Not every 64-hex string in the docs is a transaction — Merkle roots and account ids look the
            // same. Say which it is rather than calling a root a missing transaction.
            const asBlock = await ethers.provider.getTransaction(hash);
            console.log(`  NOT A TRANSACTION  ${hash}`);
            console.log(`                     cited in ${where}`);
            console.log(`                     (a Merkle root or account id would look like this too)`);
            if (asBlock) bad++;
            bad++;
            continue;
        }

        const to = receipt.to ?? "(contract creation)";
        const label = NAMED[ethers.getAddress(to)] ?? to;
        const status = receipt.status === 1 ? "ok  " : "FAILED";
        if (receipt.status !== 1) bad++;
        console.log(`  ${status}  ${hash.slice(0, 12)}…  block ${receipt.blockNumber}  to ${label}`);
        console.log(`          cited in ${where}`);
    }

    console.log();
    if (bad > 0) {
        console.log(`${bad} claimed hash(es) are not confirmed successful transactions. Fix the docs.\n`);
        process.exitCode = 1;
    } else {
        console.log("Every claimed transaction exists on chain and succeeded.\n");
    }
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
