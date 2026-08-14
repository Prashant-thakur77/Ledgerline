/**
 * Generate the differential fixture: the on-chain underwriting answer for a matrix of accounts.
 *
 *   npx hardhat run scripts/ledgerline/gen-underwriting-fixture.ts
 *
 * The Confidential Compute extension claims its arithmetic mirrors AdvanceManager verbatim, and that
 * claim is what makes a private decision trustworthy — a borrower who underwrites in the enclave must
 * get the answer the public contract would have given, or the enclave is a different lender wearing
 * the same name. Nothing enforced that. This script asks the real contract for its answer across a
 * matrix of ages, histories and cycles, and writes it where the enclave's own test suite can read it
 * (fcc/typescript/src/__tests__/fixtures/underwriting.json), so the extension is checked against the
 * contract on every run of either suite.
 *
 * It runs against the in-process Hardhat network with the harness contracts, so it needs no chain, no
 * key and no funds — regenerate it whenever the underwriting policy changes.
 */
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";
import fs from "fs";
import path from "path";

const DTO_TYPE =
    "tuple(string platform,string accountRef,uint256 revenueCents,uint256 periodStart,uint256 periodEnd,uint256 refundCents,uint256 disputeCount)";
const PROFILE_TYPE = "tuple(string platform,string accountRef,uint256 createdAt)";
const coder = AbiCoder.defaultAbiCoder();

const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY;

interface PeriodSpec {
    revenueCents: number;
    /** How long before "now" this period ended, in days — this is what age weighting turns on. */
    endsDaysAgo: number;
    refundCents?: number;
}

interface CaseSpec {
    name: string;
    periods: PeriodSpec[];
    /** Account age in days at the time of the call; 0 means the oracle has no profile. */
    accountAgeDays: number;
    closedCleanCycles: number;
}

const CASES: CaseSpec[] = [
    {
        name: "seasoned account, three settled months",
        periods: [
            { revenueCents: 400_000, endsDaysAgo: 210 },
            { revenueCents: 400_000, endsDaysAgo: 180 },
            { revenueCents: 400_000, endsDaysAgo: 150 },
        ],
        accountAgeDays: 400,
        closedCleanCycles: 0,
    },
    {
        name: "unknown age is priced at the base factor",
        periods: [
            { revenueCents: 400_000, endsDaysAgo: 210 },
            { revenueCents: 400_000, endsDaysAgo: 180 },
            { revenueCents: 400_000, endsDaysAgo: 150 },
        ],
        accountAgeDays: 0,
        closedCleanCycles: 0,
    },
    {
        name: "an account younger than the age gate",
        periods: [{ revenueCents: 400_000, endsDaysAgo: 150 }],
        accountAgeDays: 10,
        closedCleanCycles: 0,
    },
    {
        name: "clean cycles earn factor",
        periods: [
            { revenueCents: 400_000, endsDaysAgo: 210 },
            { revenueCents: 400_000, endsDaysAgo: 180 },
            { revenueCents: 400_000, endsDaysAgo: 150 },
        ],
        accountAgeDays: 400,
        closedCleanCycles: 2,
    },
    {
        name: "cycles past the cap clamp at 1.0x",
        periods: [
            { revenueCents: 400_000, endsDaysAgo: 210 },
            { revenueCents: 400_000, endsDaysAgo: 180 },
            { revenueCents: 400_000, endsDaysAgo: 150 },
        ],
        accountAgeDays: 400,
        closedCleanCycles: 9,
    },
    {
        name: "the latest month is the weak one, so it binds",
        periods: [
            { revenueCents: 400_000, endsDaysAgo: 210 },
            { revenueCents: 400_000, endsDaysAgo: 180 },
            { revenueCents: 40_000, endsDaysAgo: 150 },
        ],
        accountAgeDays: 400,
        closedCleanCycles: 0,
    },
    // The age-weighted cases: revenue still inside the 120-day refund window is provisional, and the
    // contract haircuts it from 50% to 100% by age. These are the cases a naive mirror gets wrong.
    {
        name: "a month that ended yesterday counts barely half",
        periods: [{ revenueCents: 400_000, endsDaysAgo: 1 }],
        accountAgeDays: 400,
        closedCleanCycles: 0,
    },
    {
        name: "a month halfway through the refund window",
        periods: [{ revenueCents: 400_000, endsDaysAgo: 60 }],
        accountAgeDays: 400,
        closedCleanCycles: 0,
    },
    {
        name: "one settled month and two provisional ones",
        periods: [
            { revenueCents: 400_000, endsDaysAgo: 150 },
            { revenueCents: 400_000, endsDaysAgo: 45 },
            { revenueCents: 400_000, endsDaysAgo: 15 },
        ],
        accountAgeDays: 400,
        closedCleanCycles: 1,
    },
    {
        name: "the window's edge: exactly 120 days counts whole",
        periods: [{ revenueCents: 400_000, endsDaysAgo: 120 }],
        accountAgeDays: 400,
        closedCleanCycles: 0,
    },
    {
        name: "an uneven history, all provisional",
        periods: [
            { revenueCents: 123_456, endsDaysAgo: 100 },
            { revenueCents: 654_321, endsDaysAgo: 70 },
            { revenueCents: 222_222, endsDaysAgo: 40 },
        ],
        accountAgeDays: 900,
        closedCleanCycles: 3,
    },
    {
        name: "a large account clamps at the maximum advance",
        periods: [
            { revenueCents: 90_000_000, endsDaysAgo: 210 },
            { revenueCents: 90_000_000, endsDaysAgo: 180 },
            { revenueCents: 90_000_000, endsDaysAgo: 150 },
        ],
        accountAgeDays: 900,
        closedCleanCycles: 4,
    },
];

function profileProof(ref: string, createdAt: number) {
    const abiEncodedData = coder.encode([PROFILE_TYPE], [["stripe", ref, createdAt]]);
    return {
        merkleProof: [],
        data: {
            attestationType: ethers.encodeBytes32String("Web2Json"),
            sourceId: ethers.encodeBytes32String("PublicWeb2"),
            votingRound: 2,
            lowestUsedTimestamp: 0,
            requestBody: {
                url: "",
                httpMethod: "GET",
                headers: "{}",
                queryParams: "{}",
                body: "{}",
                postProcessJq: "{}",
                abiSignature: "{}",
            },
            responseBody: { abiEncodedData },
        },
    };
}

function proof(ref: string, revenueCents: number, periodStart: number, periodEnd: number, refundCents = 0) {
    const abiEncodedData = coder.encode(
        [DTO_TYPE],
        [["stripe", ref, revenueCents, periodStart, periodEnd, refundCents, 0]]
    );
    return {
        merkleProof: [],
        data: {
            attestationType: ethers.encodeBytes32String("Web2Json"),
            sourceId: ethers.encodeBytes32String("PublicWeb2"),
            votingRound: 1,
            lowestUsedTimestamp: 0,
            requestBody: {
                url: "",
                httpMethod: "GET",
                headers: "{}",
                queryParams: "{}",
                body: "{}",
                postProcessJq: "{}",
                abiSignature: "{}",
            },
            responseBody: { abiEncodedData },
        },
    };
}

async function main() {
    const [, borrower] = await ethers.getSigners();

    const Oracle = await ethers.getContractFactory("RevenueOracleHarness");
    const oracle = await Oracle.deploy();
    const Token = await ethers.getContractFactory("MockFXRP");
    const fxrp = await Token.deploy();
    const Manager = await ethers.getContractFactory("AdvanceManagerHarness");
    const manager = await Manager.deploy(await oracle.getAddress(), await fxrp.getAddress());
    await manager.setXrpUsd(1_000_000n, 6);
    // The production policy deploy.ts ships, which is the policy the enclave hard-codes: +8pts of
    // factor per proven month, and a 4% risk premium at tier 0 melting to zero at the cap.
    await manager.setRiskTerms(800, 400);
    await manager.setFeeSplit(0, 0);
    await manager.setVelocity(1_000); // cycles are earned in bulk below, not spread over days

    await fxrp.mint(borrower.address, 10n ** 15n);
    await fxrp.connect(borrower).approve(await manager.getAddress(), 10n ** 15n);
    const [owner] = await ethers.getSigners();
    await fxrp.mint(owner.address, 10n ** 15n);
    await fxrp.connect(owner).approve(await manager.getAddress(), 10n ** 15n);
    await manager.depositTreasury(10n ** 15n);

    const out: unknown[] = [];

    for (let i = 0; i < CASES.length; i++) {
        const c = CASES[i];
        const ref = `acct_diff_${i}`;
        const accountId = await oracle.accountIdFor("stripe", ref);

        /*
         * Every read happens at one pinned timestamp, chosen ahead of the setup transactions so the
         * chain can reach it: the enclave is then handed exactly this `nowTs` and has no excuse for
         * a different answer. Period ends are expressed relative to it, so "ended yesterday" means
         * yesterday as of the reading, not as of the writing.
         */
        const now = (await ethers.provider.getBlock("latest"))!.timestamp + 3600;

        for (const p of c.periods) {
            const end = now - p.endsDaysAgo * DAY;
            await oracle
                .connect(borrower)
                .submitAttestation(accountId, proof(ref, p.revenueCents, end - MONTH, end, p.refundCents ?? 0));
        }
        if (c.accountAgeDays > 0) {
            await oracle.submitProfileAttestation(accountId, profileProof(ref, now - c.accountAgeDays * DAY));
        }
        // Clean cycles are earned, never set: borrow a token amount and repay it in full, which is
        // exactly what the tier schedule counts. The fixture therefore describes a reachable account.
        for (let k = 0; k < c.closedCleanCycles; k++) {
            await manager.connect(borrower).requestAdvance(accountId, 100n);
            const a = await manager.advanceOf(accountId);
            await manager.connect(borrower).repay(accountId, a.outstandingCents);
        }

        // Read the contract's answer as of exactly `now`.
        await ethers.provider.send("evm_setNextBlockTimestamp", [now]);
        await ethers.provider.send("evm_mine", []);

        out.push({
            name: c.name,
            input: {
                accountId,
                nowTs: now,
                accountCreatedAt: c.accountAgeDays > 0 ? now - c.accountAgeDays * DAY : 0,
                closedCleanCycles: c.closedCleanCycles,
                periods: c.periods.map((p) => {
                    const end = now - p.endsDaysAgo * DAY;
                    return {
                        revenueCents: p.revenueCents,
                        periodStart: end - MONTH,
                        periodEnd: end,
                        ...(p.refundCents ? { refundCents: p.refundCents } : {}),
                    };
                }),
            },
            onChain: {
                limitCents: Number(await manager.advanceLimitCents(accountId)),
                factorBps: Number(await manager.accountFactorBps(accountId)),
                feeBps: Number(await manager.accountFeeBps(accountId)),
                periodsUsed: Math.min(c.periods.length, 3),
            },
        });
    }

    const dir = path.join(__dirname, "..", "..", "fcc", "typescript", "src", "__tests__", "fixtures");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "underwriting.json");
    fs.writeFileSync(
        file,
        JSON.stringify(
            {
                _comment:
                    "Generated by scripts/ledgerline/gen-underwriting-fixture.ts — the on-chain underwriting answer " +
                    "for each case. The enclave must reproduce every figure exactly; see differential.test.ts.",
                cases: out,
            },
            null,
            2
        ) + "\n"
    );
    console.log(`wrote ${out.length} cases to ${path.relative(process.cwd(), file)}`);
}

void main().then(() => process.exit(0));
