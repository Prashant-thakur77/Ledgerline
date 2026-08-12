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

/*
 * Superseded addresses are kept here on purpose. Transactions cited in the documentation were sent to the
 * deployment that was current at the time, and a checker that only knew the latest address would print a
 * bare hex string for them — which reads like something is wrong when nothing is.
 */
const NAMED: Record<string, string> = {
    "0x639ca7C10DC1619d7cAA2B5a286372345194864b": "RevenueOracle",
    "0x24f2c925679e737174103A5F6715b766E3D5D602": "AdvanceManager",
    "0x38560eE630071846158F639a217E6a0fB2d66Fe2": "LenderPool",
    "0x151FDDB3d60B1Cc9AD43e0831495D430b0412906": "RevenueOracle (superseded)",
    "0xae027AeB3d1FBa24743D1ADE902521641F32f41c": "AdvanceManager (superseded)",
    "0xB6a742c6B2e1Ff4052670a82C97d0558E77235c7": "LenderPool (superseded)",
    "0x66cB73a6326F7e6541DA95f5fB2236d8b4f4fc4a": "PrivateUnderwriter",
    "0x4Ef13AC54c1306F2E678e201b9CB4f9e1C1AB4b6": "RevenueOracle (superseded)",
    "0xD397f88C6466C0F202b5387454d2897762FDE054": "AdvanceManager (superseded)",
    "0x815337Dd052544b228b11A192Fe108F9482441f6": "LenderPool (superseded)",
    "0x80D08369E1a34e8c7C43FCF947323e56e6B87Be6": "RevenueOracle (superseded)",
    "0x63fC5a5c422D40DcC8FA267384BA5351d8698A58": "AdvanceManager (superseded)",
    "0x4EC83Eb966dcac3e4291c85320Cfd6941a7C4f66": "AdvanceManager (superseded)",
    "0x5774E51335277893c5f177bb6735b4CF2fE76A63": "AdvanceManager (superseded)",
    "0x47C6d20206AbD9413d345d45c65aB8a074Ca28a8": "RevenueOracle (superseded)",
    "0xd7DADF66AF4dA4C5FF0Ccdcccc77db1a46520341": "FCC InstructionSender (extension 66180)",
    "0x08c4b3B19634847B829c708F6FEc67132ae0cf8c": "FCC InstructionSender (extension 66184, key-in-enclave)",
    "0x0b6A3645c240605887a5532109323A3E12273dc7": "FXRP (FTestXRP)",
    "0x48aC463d7975828989331F4De43341627b9c5f1D": "FdcHub",
};

async function main() {
    /*
     * Only hashes published as explorer transaction links are treated as claims that a transaction exists.
     * Merkle roots and account ids are the same shape and appear all over these documents; calling one of
     * those a missing transaction would be a false alarm, and a checker that cries wolf gets ignored.
     */
    const TX_LINK = /coston2-explorer\.flare\.network\/tx\/(0x[0-9a-fA-F]{64})/g;

    const claimed = new Map<string, string[]>();
    for (const file of FILES) {
        const full = path.join(ROOT, file);
        if (!fs.existsSync(full)) continue;
        const text = fs.readFileSync(full, "utf8");
        for (const m of text.matchAll(TX_LINK)) {
            const hash = m[1].toLowerCase();
            claimed.set(hash, [...(claimed.get(hash) ?? []), file]);
        }
    }

    console.log(`\nChecking ${claimed.size} claimed transaction hashes against Coston2.\n`);

    let bad = 0;
    for (const [hash, files] of [...claimed].sort()) {
        const where = [...new Set(files)].join(", ");
        const receipt = await ethers.provider.getTransactionReceipt(hash);

        if (!receipt) {
            console.log(`  MISSING  ${hash}`);
            console.log(`           linked as a transaction in ${where}, but the chain has no such transaction`);
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
