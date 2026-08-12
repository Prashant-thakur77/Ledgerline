import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Phase 1: the underwriting is attack-resistant, not just the data.
 *
 * The proofs already guarantee nobody can attest revenue Stripe did not report. These tests are about the
 * layer above — being honest with the machine and still cheating the economics — and each maps to a named
 * attack in docs/ROADMAP.md: revenue recycling, overlapping windows, and fabricated history on a young
 * account.
 */

const DTO_TYPE = "tuple(string platform,string accountRef,uint256 revenueCents,uint256 periodStart,uint256 periodEnd)";
const PROFILE_TYPE = "tuple(string platform,string accountRef,uint256 createdAt)";
const coder = AbiCoder.defaultAbiCoder();

const MONTH = 30 * 24 * 60 * 60;
const JAN = 1767225600;
const FXRP_DECIMALS = 6;
const XRP_USD = 1_000_000n; // $1 exactly, so dollar and FXRP figures line up in assertions
const PRICE_DECIMALS = 6;

const REF = "acct_1TierTest";

function revenueProof(revenueCents: number, periodStart: number, periodEnd: number, accountRef = REF) {
    const abiEncodedData = coder.encode(
        [DTO_TYPE],
        [["stripe", accountRef, revenueCents, periodStart, periodEnd]]
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

function profileProof(createdAt: number, accountRef = REF) {
    const abiEncodedData = coder.encode([PROFILE_TYPE], [["stripe", accountRef, createdAt]]);
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

async function setup() {
    const [owner, borrower] = await ethers.getSigners();

    const Oracle = await ethers.getContractFactory("RevenueOracleHarness");
    const oracle = await Oracle.deploy();
    const Token = await ethers.getContractFactory("MockFXRP");
    const fxrp = await Token.deploy();

    const Manager = await ethers.getContractFactory("AdvanceManagerHarness");
    const manager = await Manager.deploy(await oracle.getAddress(), await fxrp.getAddress());
    await manager.setXrpUsd(XRP_USD, PRICE_DECIMALS);
    // Production defaults on purpose: 2.5% base, +20pts per clean cycle, 1.0x cap, 30-day age gate.

    const treasury = 1_000_000n * 10n ** BigInt(FXRP_DECIMALS);
    await fxrp.mint(owner.address, treasury);
    await fxrp.approve(await manager.getAddress(), treasury);
    await manager.depositTreasury(treasury);

    const accountId = await oracle.accountIdFor("stripe", REF);
    return { owner, borrower, oracle, fxrp, manager, accountId };
}

/** Prove `months` consecutive non-overlapping periods of `cents` each, ending in the past. */
async function proveMonths(
    oracle: Awaited<ReturnType<typeof setup>>["oracle"],
    borrower: Awaited<ReturnType<typeof setup>>["borrower"],
    accountId: string,
    cents: number,
    months: number,
    startAt = JAN
) {
    for (let i = 0; i < months; i++) {
        await oracle
            .connect(borrower)
            .submitAttestation(accountId, revenueProof(cents, startAt + i * MONTH, startAt + (i + 1) * MONTH));
    }
}

describe("Attack-resistant underwriting", () => {
    describe("overlapping periods (the fabricated-history attack)", () => {
        it("rejects a period that starts inside the previous one", async () => {
            const { oracle, borrower, accountId } = await setup();
            await oracle.connect(borrower).submitAttestation(accountId, revenueProof(400_000, JAN, JAN + MONTH));

            const DAY = 24 * 60 * 60;
            await expect(
                oracle
                    .connect(borrower)
                    .submitAttestation(accountId, revenueProof(400_000, JAN + DAY, JAN + MONTH + DAY))
            )
                .to.be.revertedWithCustomError(oracle, "OverlappingPeriod")
                .withArgs(JAN + MONTH, JAN + DAY);
        });

        it("accepts periods that touch exactly", async () => {
            const { oracle, borrower, accountId } = await setup();
            await oracle.connect(borrower).submitAttestation(accountId, revenueProof(400_000, JAN, JAN + MONTH));
            await expect(
                oracle
                    .connect(borrower)
                    .submitAttestation(accountId, revenueProof(400_000, JAN + MONTH, JAN + 2 * MONTH))
            ).to.not.be.reverted;
        });

        it("accepts periods with a gap", async () => {
            const { oracle, borrower, accountId } = await setup();
            await oracle.connect(borrower).submitAttestation(accountId, revenueProof(400_000, JAN, JAN + MONTH));
            await expect(
                oracle
                    .connect(borrower)
                    .submitAttestation(accountId, revenueProof(400_000, JAN + 2 * MONTH, JAN + 3 * MONTH))
            ).to.not.be.reverted;
        });
    });

    describe("the attested profile (account age)", () => {
        it("stores the platform's creation date", async () => {
            const { oracle, accountId } = await setup();
            await oracle.submitProfileAttestation(accountId, profileProof(JAN));
            expect(await oracle.accountCreatedAt(accountId)).to.equal(JAN);
        });

        it("does not bind ownership — only proven revenue does that", async () => {
            const { oracle, accountId } = await setup();
            await oracle.submitProfileAttestation(accountId, profileProof(JAN));
            expect(await oracle.accountOwner(accountId)).to.equal(ethers.ZeroAddress);
        });

        it("can be set exactly once", async () => {
            const { oracle, accountId } = await setup();
            await oracle.submitProfileAttestation(accountId, profileProof(JAN));
            await expect(oracle.submitProfileAttestation(accountId, profileProof(JAN + 1)))
                .to.be.revertedWithCustomError(oracle, "ProfileAlreadySet")
                .withArgs(accountId);
        });

        it("rejects a zero or future creation date", async () => {
            const { oracle, accountId } = await setup();
            await expect(
                oracle.submitProfileAttestation(accountId, profileProof(0))
            ).to.be.revertedWithCustomError(oracle, "InvalidProfile");

            const future = (await time.latest()) + MONTH;
            await expect(
                oracle.submitProfileAttestation(accountId, profileProof(future))
            ).to.be.revertedWithCustomError(oracle, "InvalidProfile");
        });

        it("rejects a profile whose account does not match the claim", async () => {
            const { oracle, accountId } = await setup();
            await expect(
                oracle.submitProfileAttestation(accountId, profileProof(JAN, "acct_SomeoneElse"))
            ).to.be.revertedWithCustomError(oracle, "AccountMismatch");
        });

        it("rejects a proof the network does not verify", async () => {
            const { oracle, accountId } = await setup();
            await oracle.setProofValid(false);
            await expect(
                oracle.submitProfileAttestation(accountId, profileProof(JAN))
            ).to.be.revertedWithCustomError(oracle, "InvalidProof");
        });
    });

    describe("the tier schedule", () => {
        it("prices an account with no attested age at the base factor, whatever its history", async () => {
            const { manager, oracle, borrower, accountId } = await setup();
            await proveMonths(oracle, borrower, accountId, 400_000, 3);
            // No profile attested: factor stays at base even with three months proven.
            expect(await manager.accountFactorBps(accountId)).to.equal(250);
            // $4,000 mean at 2.5% = $100.00
            expect(await manager.advanceLimitCents(accountId)).to.equal(10_000n);
        });

        it("prices a young account at the base factor", async () => {
            const { manager, oracle, borrower, accountId } = await setup();
            await proveMonths(oracle, borrower, accountId, 400_000, 3);
            const now = await time.latest();
            await oracle.submitProfileAttestation(accountId, profileProof(now - 7 * 24 * 60 * 60));
            expect(await manager.accountFactorBps(accountId)).to.equal(250);
        });

        it("grows the factor with cleanly repaid advances, up to the cap", async () => {
            const { manager, oracle, fxrp, borrower, accountId } = await setup();
            await proveMonths(oracle, borrower, accountId, 400_000, 3);
            await oracle.submitProfileAttestation(accountId, profileProof(JAN)); // old account

            // Give the borrower FXRP to repay with, and an allowance.
            await fxrp.mint(borrower.address, 10_000_000_000n);
            await fxrp.connect(borrower).approve(await manager.getAddress(), 10_000_000_000n);

            expect(await manager.accountFactorBps(accountId)).to.equal(250);

            // Cycle 1: borrow the full tier-0 limit, repay in full.
            await manager.connect(borrower).requestAdvance(accountId, 10_000);
            let a = await manager.advanceOf(accountId);
            await manager.connect(borrower).repay(accountId, a.outstandingCents);
            expect(await manager.closedCleanCycles(accountId)).to.equal(1);
            expect(await manager.accountFactorBps(accountId)).to.equal(2_250); // 250 + 2000

            // Cycle 2.
            await manager.connect(borrower).requestAdvance(accountId, 50_000);
            a = await manager.advanceOf(accountId);
            await manager.connect(borrower).repay(accountId, a.outstandingCents);
            expect(await manager.accountFactorBps(accountId)).to.equal(4_250);

            // Five clean cycles reach the cap and stay there.
            for (let i = 0; i < 3; i++) {
                await manager.connect(borrower).requestAdvance(accountId, 10_000);
                a = await manager.advanceOf(accountId);
                await manager.connect(borrower).repay(accountId, a.outstandingCents);
            }
            expect(await manager.closedCleanCycles(accountId)).to.equal(5);
            expect(await manager.accountFactorBps(accountId)).to.equal(10_000);
        });

        it("stores the factor actually applied on the advance", async () => {
            const { manager, oracle, borrower, accountId } = await setup();
            await proveMonths(oracle, borrower, accountId, 400_000, 3);
            await manager.connect(borrower).requestAdvance(accountId, 5_000);
            expect((await manager.advanceOf(accountId)).factorBps).to.equal(250);
        });

        it("a delinquent cycle earns nothing, and the account stays blocked", async () => {
            const { manager, oracle, fxrp, borrower, accountId } = await setup();
            await proveMonths(oracle, borrower, accountId, 400_000, 3);
            await oracle.submitProfileAttestation(accountId, profileProof(JAN));

            await fxrp.mint(borrower.address, 10_000_000_000n);
            await fxrp.connect(borrower).approve(await manager.getAddress(), 10_000_000_000n);

            await manager.connect(borrower).requestAdvance(accountId, 10_000);
            await time.increase(46 * 24 * 60 * 60); // past the grace period
            await manager.markDelinquent(accountId);

            const a = await manager.advanceOf(accountId);
            await manager.connect(borrower).repay(accountId, a.outstandingCents);

            expect(await manager.closedCleanCycles(accountId)).to.equal(0);
            await expect(
                manager.connect(borrower).requestAdvance(accountId, 1_000)
            ).to.be.revertedWithCustomError(manager, "AccountDelinquent");
        });

        it("rejects a schedule whose base exceeds its cap", async () => {
            const { manager } = await setup();
            await expect(manager.setFactorSchedule(10_001, 0, 10_000, 0)).to.be.revertedWithCustomError(
                manager,
                "InvalidAmount"
            );
        });

        it("only the owner can change the schedule", async () => {
            const { manager, borrower } = await setup();
            await expect(
                manager.connect(borrower).setFactorSchedule(100, 100, 100, 0)
            ).to.be.revertedWithCustomError(manager, "OwnableUnauthorizedAccount");
        });
    });

    describe("the limit prices a collapse on the collapse", () => {
        it("uses the latest period when it is below the mean", async () => {
            const { manager, oracle, borrower, accountId } = await setup();
            // $4,000, $4,000, then a collapse to $400.
            await oracle.connect(borrower).submitAttestation(accountId, revenueProof(400_000, JAN, JAN + MONTH));
            await oracle
                .connect(borrower)
                .submitAttestation(accountId, revenueProof(400_000, JAN + MONTH, JAN + 2 * MONTH));
            await oracle
                .connect(borrower)
                .submitAttestation(accountId, revenueProof(40_000, JAN + 2 * MONTH, JAN + 3 * MONTH));

            // mean = $2,800; latest = $400; base must be the $400. At 2.5%: $10.00.
            expect(await manager.advanceLimitCents(accountId)).to.equal(1_000n);
        });

        it("uses the mean when the business is growing", async () => {
            const { manager, oracle, borrower, accountId } = await setup();
            await oracle.connect(borrower).submitAttestation(accountId, revenueProof(100_000, JAN, JAN + MONTH));
            await oracle
                .connect(borrower)
                .submitAttestation(accountId, revenueProof(400_000, JAN + MONTH, JAN + 2 * MONTH));

            // mean = $2,500; latest = $4,000; base is the mean. At 2.5%: $62.50.
            expect(await manager.advanceLimitCents(accountId)).to.equal(6_250n);
        });

        it("a fully refunded month zeroes the limit", async () => {
            const { manager, oracle, borrower, accountId } = await setup();
            await oracle.connect(borrower).submitAttestation(accountId, revenueProof(400_000, JAN, JAN + MONTH));
            // The jq clamps a net-negative month to zero before it ever reaches the chain.
            await oracle
                .connect(borrower)
                .submitAttestation(accountId, revenueProof(0, JAN + MONTH, JAN + 2 * MONTH));

            expect(await manager.advanceLimitCents(accountId)).to.equal(0n);
        });
    });

    describe("the recycling attack loses money", () => {
        it("tier-0 advance is smaller than the card fees paid to fabricate the revenue", async () => {
            const { manager, oracle, borrower, accountId } = await setup();

            // The attacker fabricates $10,000 of "revenue" through their own Stripe account.
            const fabricatedCents = 1_000_000;
            await proveMonths(oracle, borrower, accountId, fabricatedCents, 3);

            // Stripe's fee on the fabrication: 2.9% + 30¢ per charge (one charge per month here).
            const cardFeesCents = Math.ceil(fabricatedCents * 3 * 0.029) + 30 * 3;

            // The most the attacker can pull out at tier 0, then default.
            const maxAdvance = await manager.advanceLimitCents(accountId);

            // 2.5% of the monthly figure vs 2.9% of the total fabricated: strictly negative EV.
            expect(maxAdvance).to.equal(25_000n); // $250.00
            expect(Number(maxAdvance)).to.be.lessThan(cardFeesCents); // $250 < $872.90
        });

        it("the age gate stops a fresh account buying tier with fake clean cycles", async () => {
            const { manager, oracle, fxrp, borrower, accountId } = await setup();
            await proveMonths(oracle, borrower, accountId, 400_000, 3);

            // Profile attested: the account is 7 days old.
            const now = await time.latest();
            await oracle.submitProfileAttestation(accountId, profileProof(now - 7 * 24 * 60 * 60));

            await fxrp.mint(borrower.address, 10_000_000_000n);
            await fxrp.connect(borrower).approve(await manager.getAddress(), 10_000_000_000n);

            // Grind three clean cycles anyway.
            for (let i = 0; i < 3; i++) {
                await manager.connect(borrower).requestAdvance(accountId, 1_000);
                const a = await manager.advanceOf(accountId);
                await manager.connect(borrower).repay(accountId, a.outstandingCents);
            }
            expect(await manager.closedCleanCycles(accountId)).to.equal(3);

            // The cycles are banked but priced at base until the account is old enough...
            expect(await manager.accountFactorBps(accountId)).to.equal(250);

            // ...and unlock only once it genuinely ages.
            await time.increase(31 * 24 * 60 * 60);
            expect(await manager.accountFactorBps(accountId)).to.equal(6_250); // 250 + 3×2000
        });
    });
});
