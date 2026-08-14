import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";

const DTO_TYPE = "tuple(string platform,string accountRef,uint256 revenueCents,uint256 periodStart,uint256 periodEnd,uint256 refundCents,uint256 disputeCount)";
const coder = AbiCoder.defaultAbiCoder();

const MONTH = 30 * 24 * 60 * 60;
const JAN = 1767225600;

// Coston2 reality, verified in Phase 0: FXRP is 6 decimals and XRP/USD is also 6.
const FXRP_DECIMALS = 6;
const XRP_USD = 1_041_868n; // $1.041868
const PRICE_DECIMALS = 6;

const ACCOUNT_REF = "acct_1TestAbc123";

function proofFor(revenueCents: number, index: number) {
    const abiEncodedData = coder.encode(
        [DTO_TYPE],
        [["stripe", ACCOUNT_REF, revenueCents, JAN + index * MONTH, JAN + (index + 1) * MONTH, 0, 0]]
    );
    return {
        merkleProof: [],
        data: {
            attestationType: ethers.encodeBytes32String("Web2Json"),
            sourceId: ethers.encodeBytes32String("PublicWeb2"),
            votingRound: 1419928 + index,
            lowestUsedTimestamp: 0,
            requestBody: {
                url: "https://api.stripe.com/v1/payouts",
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

/** The conversion the contract must perform, written independently here so the test is a real check. */
function usdCentsToFxrpRaw(cents: bigint, price: bigint, priceDecimals: number): bigint {
    return (cents * 10n ** BigInt(priceDecimals) * 10n ** BigInt(FXRP_DECIMALS)) / (100n * price);
}

async function setup() {
    const [owner, borrower, attacker] = await ethers.getSigners();

    const Oracle = await ethers.getContractFactory("RevenueOracleHarness");
    const oracle = await Oracle.deploy();
    await oracle.waitForDeployment();

    const Token = await ethers.getContractFactory("MockFXRP");
    const fxrp = await Token.deploy();
    await fxrp.waitForDeployment();

    const Manager = await ethers.getContractFactory("AdvanceManagerHarness");
    const manager = await Manager.deploy(await oracle.getAddress(), await fxrp.getAddress());
    await manager.waitForDeployment();
    await manager.setXrpUsd(XRP_USD, PRICE_DECIMALS);
        // These suites test the core mechanics; Phase A features have their own suite.
        await manager.setReserveTerms(0, 1);
        await manager.setFeeSplit(0, 0);
    // Legacy tests predate the tier schedule; pin the flat 1.0x factor they assume.
    await manager.setFactorSchedule(10_000, 0, 10_000, 0);

    // Fund the treasury with 10,000 FXRP.
    const treasury = 10_000n * 10n ** BigInt(FXRP_DECIMALS);
    await fxrp.mint(owner.address, treasury);
    await fxrp.approve(await manager.getAddress(), treasury);
    await manager.depositTreasury(treasury);

    const accountId = await oracle.accountIdFor("stripe", ACCOUNT_REF);
    return { oracle, fxrp, manager, owner, borrower, attacker, accountId };
}

/** Prove `count` months of revenue for the borrower. */
async function proveRevenue(oracle: any, borrower: any, accountId: string, months: number[]) {
    for (let i = 0; i < months.length; i++) {
        await oracle.connect(borrower).submitAttestation(accountId, proofFor(months[i], i));
    }
}

describe("AdvanceManager", () => {
    describe("underwriting", () => {
        it("offers 1.0x the average of the last three attested months", async () => {
            const { oracle, manager, borrower, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [300_000, 400_000, 500_000]);

            // average of 300k, 400k, 500k cents = 400_000 cents = $4,000
            expect(await manager.advanceLimitCents(accountId)).to.equal(400_000n);
        });

        it("averages only the most recent three months when more exist", async () => {
            const { oracle, manager, borrower, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [10_000, 10_000, 300_000, 400_000, 500_000]);

            expect(await manager.advanceLimitCents(accountId)).to.equal(400_000n);
        });

        it("underwrites from a single month when that is all there is", async () => {
            const { oracle, manager, borrower, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [250_000]);

            expect(await manager.advanceLimitCents(accountId)).to.equal(250_000n);
        });

        it("offers nothing to an account with no attested revenue", async () => {
            const { manager, accountId } = await setup();
            expect(await manager.advanceLimitCents(accountId)).to.equal(0n);
        });
    });

    describe("taking an advance", () => {
        it("sends FXRP converted at the FTSO rate and records a dollar obligation", async () => {
            const { oracle, fxrp, manager, borrower, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [400_000]);

            const usd = 100_000n; // $1,000.00
            await manager.connect(borrower).requestAdvance(accountId, usd);

            const expectedFxrp = usdCentsToFxrpRaw(usd, XRP_USD, PRICE_DECIMALS);
            expect(await fxrp.balanceOf(borrower.address)).to.equal(expectedFxrp);

            const advance = await manager.advanceOf(accountId);
            const fee = (usd * (await manager.feeBps())) / 10_000n;
            expect(advance.principalCents).to.equal(usd);
            expect(advance.feeCents).to.equal(fee);
            expect(advance.outstandingCents).to.equal(usd + fee);
            expect(advance.fxrpDisbursed).to.equal(expectedFxrp);
        });

        it("stores the underwriting inputs so the decision is auditable", async () => {
            const { oracle, manager, borrower, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [300_000, 400_000, 500_000]);
            await manager.connect(borrower).requestAdvance(accountId, 100_000n);

            const advance = await manager.advanceOf(accountId);
            expect(advance.avgRevenueCents).to.equal(400_000n);
            expect(advance.periodsUsed).to.equal(3n);
            expect(advance.factorBps).to.equal(10_000n);
            expect(advance.xrpUsdPrice).to.equal(XRP_USD);
            expect(advance.priceDecimals).to.equal(PRICE_DECIMALS);
        });

        it("reverts when the amount exceeds the limit", async () => {
            const { oracle, manager, borrower, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [400_000]);

            await expect(
                manager.connect(borrower).requestAdvance(accountId, 400_001n)
            ).to.be.revertedWithCustomError(manager, "ExceedsLimit");
        });

        it("reverts when no revenue has been attested", async () => {
            const { manager, borrower, accountId } = await setup();

            await expect(
                manager.connect(borrower).requestAdvance(accountId, 1_000n)
            ).to.be.revertedWithCustomError(manager, "NoRevenueProven");
        });

        it("reverts when the caller does not own the account", async () => {
            const { oracle, manager, borrower, attacker, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [400_000]);

            await expect(
                manager.connect(attacker).requestAdvance(accountId, 1_000n)
            ).to.be.revertedWithCustomError(manager, "NotAccountOwner");
        });

        it("reverts on a second advance while one is open", async () => {
            const { oracle, manager, borrower, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [400_000]);
            await manager.connect(borrower).requestAdvance(accountId, 100_000n);

            await expect(
                manager.connect(borrower).requestAdvance(accountId, 1_000n)
            ).to.be.revertedWithCustomError(manager, "AdvanceAlreadyOpen");
        });
    });

    describe("repayment", () => {
        it("reduces the dollar obligation by the dollar value repaid", async () => {
            const { oracle, fxrp, manager, borrower, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [400_000]);
            await manager.connect(borrower).requestAdvance(accountId, 100_000n);
            const before = (await manager.advanceOf(accountId)).outstandingCents;

            const repayCents = 25_000n; // $250
            const fxrpNeeded = usdCentsToFxrpRaw(repayCents, XRP_USD, PRICE_DECIMALS);
            await fxrp.connect(borrower).approve(await manager.getAddress(), fxrpNeeded);
            await manager.connect(borrower).repay(accountId, repayCents);

            expect((await manager.advanceOf(accountId)).outstandingCents).to.equal(before - repayCents);
        });

        it("closes the advance when fully repaid", async () => {
            const { oracle, fxrp, manager, borrower, owner, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [400_000]);
            await manager.connect(borrower).requestAdvance(accountId, 100_000n);

            const outstanding = (await manager.advanceOf(accountId)).outstandingCents;
            // The fee means the borrower owes more FXRP than it received; top it up.
            await fxrp.mint(borrower.address, 10_000n * 10n ** BigInt(FXRP_DECIMALS));
            const fxrpNeeded = usdCentsToFxrpRaw(outstanding, XRP_USD, PRICE_DECIMALS) + 1n;
            await fxrp.connect(borrower).approve(await manager.getAddress(), fxrpNeeded);
            await manager.connect(borrower).repay(accountId, outstanding);

            expect((await manager.advanceOf(accountId)).outstandingCents).to.equal(0n);
            expect(await manager.hasOpenAdvance(accountId)).to.equal(false);

            // and the borrower can take another advance afterwards
            await expect(manager.connect(borrower).requestAdvance(accountId, 1_000n)).to.not.be.reverted;
        });

        it("takes the agreed share of a newly attested period automatically", async () => {
            const { oracle, fxrp, manager, borrower, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [400_000]);
            await manager.connect(borrower).requestAdvance(accountId, 100_000n);
            const before = (await manager.advanceOf(accountId)).outstandingCents;

            // A new month is proven: $4,000 of revenue.
            await oracle.connect(borrower).submitAttestation(accountId, proofFor(400_000, 1));

            const shareBps = await manager.repaymentShareBps();
            const expectedCents = (400_000n * shareBps) / 10_000n;
            const fxrpNeeded = usdCentsToFxrpRaw(expectedCents, XRP_USD, PRICE_DECIMALS) + 1n;
            await fxrp.mint(borrower.address, fxrpNeeded);
            await fxrp.connect(borrower).approve(await manager.getAddress(), fxrpNeeded);

            await manager.applyRevenueRepayment(accountId);

            expect((await manager.advanceOf(accountId)).outstandingCents).to.equal(before - expectedCents);
        });

        it("will not take the same attested period twice", async () => {
            const { oracle, fxrp, manager, borrower, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [400_000]);
            await manager.connect(borrower).requestAdvance(accountId, 100_000n);
            await oracle.connect(borrower).submitAttestation(accountId, proofFor(400_000, 1));

            await fxrp.mint(borrower.address, 10_000n * 10n ** BigInt(FXRP_DECIMALS));
            await fxrp.connect(borrower).approve(await manager.getAddress(), ethers.MaxUint256);
            await manager.applyRevenueRepayment(accountId);

            await expect(manager.applyRevenueRepayment(accountId)).to.be.revertedWithCustomError(
                manager,
                "PeriodAlreadyApplied"
            );
        });
    });

    describe("the dollar denomination holds when XRP moves", () => {
        it("leaves the dollar obligation unchanged after a 3x price move", async () => {
            const { oracle, fxrp, manager, borrower, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [400_000]);
            await manager.connect(borrower).requestAdvance(accountId, 100_000n);
            const owedBefore = (await manager.advanceOf(accountId)).outstandingCents;

            // XRP triples.
            const newPrice = XRP_USD * 3n;
            await manager.setXrpUsd(newPrice, PRICE_DECIMALS);

            expect((await manager.advanceOf(accountId)).outstandingCents).to.equal(owedBefore);

            // Repaying $250 now costs a third of the FXRP it would have before.
            const repayCents = 25_000n;
            const fxrpNow = usdCentsToFxrpRaw(repayCents, newPrice, PRICE_DECIMALS);
            const fxrpBefore = usdCentsToFxrpRaw(repayCents, XRP_USD, PRICE_DECIMALS);
            expect(fxrpNow).to.be.lessThan(fxrpBefore);

            const balBefore = await fxrp.balanceOf(borrower.address);
            await fxrp.connect(borrower).approve(await manager.getAddress(), fxrpNow);
            await manager.connect(borrower).repay(accountId, repayCents);

            expect(balBefore - (await fxrp.balanceOf(borrower.address))).to.equal(fxrpNow);
            expect((await manager.advanceOf(accountId)).outstandingCents).to.equal(owedBefore - repayCents);
        });

        it("uses the feed's own decimals rather than assuming 18", async () => {
            const { oracle, fxrp, manager, borrower, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [400_000]);

            // Same $1.041868 price expressed with 8 decimals, as FLR/USD does on Coston2.
            await manager.setXrpUsd(104_186_800n, 8);
            await manager.connect(borrower).requestAdvance(accountId, 100_000n);

            const expected = usdCentsToFxrpRaw(100_000n, 104_186_800n, 8);
            expect(await fxrp.balanceOf(borrower.address)).to.equal(expected);
            // and that must equal what the 6-decimal feed produced, to within rounding
            const at6 = usdCentsToFxrpRaw(100_000n, XRP_USD, PRICE_DECIMALS);
            expect(expected).to.equal(at6);
        });

        it("refuses to convert when the feed returns a zero price", async () => {
            const { oracle, manager, borrower, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [400_000]);
            await manager.setXrpUsd(0, PRICE_DECIMALS);

            await expect(
                manager.connect(borrower).requestAdvance(accountId, 100_000n)
            ).to.be.revertedWithCustomError(manager, "InvalidPrice");
        });
    });

    describe("delinquency", () => {
        it("blocks a new advance once marked delinquent", async () => {
            const { oracle, fxrp, manager, borrower, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [400_000]);
            await manager.connect(borrower).requestAdvance(accountId, 10_000n);

            await ethers.provider.send("evm_increaseTime", [Number(await manager.gracePeriod()) + 1]);
            await ethers.provider.send("evm_mine", []);
            await manager.markDelinquent(accountId);

            expect((await manager.advanceOf(accountId)).delinquent).to.equal(true);

            // repay in full, then try again
            await fxrp.mint(borrower.address, 10_000n * 10n ** BigInt(FXRP_DECIMALS));
            await fxrp.connect(borrower).approve(await manager.getAddress(), ethers.MaxUint256);
            await manager.connect(borrower).repay(accountId, (await manager.advanceOf(accountId)).outstandingCents);

            await expect(
                manager.connect(borrower).requestAdvance(accountId, 1_000n)
            ).to.be.revertedWithCustomError(manager, "AccountDelinquent");
        });

        it("cannot be marked delinquent before the grace period elapses", async () => {
            const { oracle, manager, borrower, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [400_000]);
            await manager.connect(borrower).requestAdvance(accountId, 10_000n);

            await expect(manager.markDelinquent(accountId)).to.be.revertedWithCustomError(
                manager,
                "GracePeriodNotElapsed"
            );
        });
    });

    describe("treasury safety", () => {
        it("does not let a borrower withdraw the treasury", async () => {
            const { manager, borrower } = await setup();
            await expect(manager.connect(borrower).withdrawTreasury(1n)).to.be.reverted;
        });

        it("does not let a borrower drain more than the limit across repeated advances", async () => {
            const { oracle, fxrp, manager, borrower, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [400_000]);

            await manager.connect(borrower).requestAdvance(accountId, 400_000n);
            await fxrp.mint(borrower.address, 10_000n * 10n ** BigInt(FXRP_DECIMALS));
            await fxrp.connect(borrower).approve(await manager.getAddress(), ethers.MaxUint256);
            await manager.connect(borrower).repay(accountId, (await manager.advanceOf(accountId)).outstandingCents);

            // Second advance is bounded by the same limit, not by the treasury balance.
            await expect(
                manager.connect(borrower).requestAdvance(accountId, 400_001n)
            ).to.be.revertedWithCustomError(manager, "ExceedsLimit");
        });

        it("reverts rather than partially funding when the treasury is short", async () => {
            const { oracle, manager, borrower, owner, accountId } = await setup();
            await proveRevenue(oracle, borrower, accountId, [400_000]);
            await manager.connect(owner).withdrawTreasury(await manager.treasuryBalance());

            await expect(
                manager.connect(borrower).requestAdvance(accountId, 400_000n)
            ).to.be.revertedWithCustomError(manager, "InsufficientTreasury");
        });
    });

    describe("the whole path", () => {
        it("runs first attestation, advance, automatic and manual repayment to zero", async () => {
            const { oracle, fxrp, manager, borrower, accountId } = await setup();

            await proveRevenue(oracle, borrower, accountId, [400_000]);
            expect(await manager.advanceLimitCents(accountId)).to.equal(400_000n);

            await manager.connect(borrower).requestAdvance(accountId, 200_000n);
            const fee = (200_000n * (await manager.feeBps())) / 10_000n;
            expect((await manager.advanceOf(accountId)).outstandingCents).to.equal(200_000n + fee);

            await fxrp.mint(borrower.address, 100_000n * 10n ** BigInt(FXRP_DECIMALS));
            await fxrp.connect(borrower).approve(await manager.getAddress(), ethers.MaxUint256);

            // month two lands and auto-repays its share
            await oracle.connect(borrower).submitAttestation(accountId, proofFor(400_000, 1));
            await manager.applyRevenueRepayment(accountId);
            const afterAuto = (await manager.advanceOf(accountId)).outstandingCents;
            expect(afterAuto).to.be.lessThan(200_000n + fee);
            expect(afterAuto).to.be.greaterThan(0n);

            // borrower clears the rest by hand
            await manager.connect(borrower).repay(accountId, afterAuto);
            expect((await manager.advanceOf(accountId)).outstandingCents).to.equal(0n);
            expect(await manager.hasOpenAdvance(accountId)).to.equal(false);
        });
    });
});
