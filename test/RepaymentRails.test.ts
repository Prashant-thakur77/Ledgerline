import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";

/**
 * Phase 5's repayment rails: batching, sender binding, and overpayment credit.
 *
 * The design decision under test throughout: an XRPL payment cannot be retracted, so every attested dollar
 * is honoured — debt first, credit after — and credit can settle a future advance but can never earn the
 * tier progress that only actual repayment earns.
 */

const DTO_TYPE = "tuple(string platform,string accountRef,uint256 revenueCents,uint256 periodStart,uint256 periodEnd)";
const coder = AbiCoder.defaultAbiCoder();

const MONTH = 30 * 24 * 60 * 60;
const JAN = 1767225600;
const DROPS = 1_000_000n;
const XRP_USD = 1_000_000n; // $1
const PRICE_DECIMALS = 6;
const REF = "acct_1RailsTest";
const XRPL_TREASURY = "rRailsTreasury11111111111111";
const BORROWER_XRPL = "rBorrowerOwnAccount111111111";
const TEST_XRP = ethers.encodeBytes32String("testXRP");

function revenueProof(revenueCents: number, index: number) {
    const abiEncodedData = coder.encode(
        [DTO_TYPE],
        [["stripe", REF, revenueCents, JAN + index * MONTH, JAN + (index + 1) * MONTH]]
    );
    return {
        merkleProof: [],
        data: {
            attestationType: ethers.encodeBytes32String("Web2Json"),
            sourceId: ethers.encodeBytes32String("PublicWeb2"),
            votingRound: 1,
            lowestUsedTimestamp: 0,
            requestBody: { url: "", httpMethod: "GET", headers: "{}", queryParams: "{}", body: "{}", postProcessJq: "{}", abiSignature: "{}" },
            responseBody: { abiEncodedData },
        },
    };
}

let txCounter = 0;
function paymentProof(
    drops: bigint,
    reference: string,
    overrides: Partial<{ sender: string; transactionId: string }> = {}
) {
    return {
        merkleProof: [],
        data: {
            attestationType: ethers.encodeBytes32String("Payment"),
            sourceId: TEST_XRP,
            votingRound: 1,
            lowestUsedTimestamp: 0,
            requestBody: {
                transactionId: overrides.transactionId ?? ethers.id(`rails-tx-${txCounter++}`),
                inUtxo: 0,
                utxo: 0,
            },
            responseBody: {
                blockNumber: 1,
                blockTimestamp: JAN,
                sourceAddressHash: ethers.keccak256(ethers.toUtf8Bytes(overrides.sender ?? BORROWER_XRPL)),
                sourceAddressesRoot: ethers.ZeroHash,
                receivingAddressHash: ethers.keccak256(ethers.toUtf8Bytes(XRPL_TREASURY)),
                intendedReceivingAddressHash: ethers.ZeroHash,
                spentAmount: drops,
                intendedSpentAmount: drops,
                receivedAmount: drops,
                intendedReceivedAmount: drops,
                standardPaymentReference: reference,
                oneToOne: true,
                status: 0,
            },
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
    await manager.setFactorSchedule(10_000, 0, 10_000, 0);
    await manager.setXrplTreasury(XRPL_TREASURY, TEST_XRP);

    const treasury = 1_000_000n * 10n ** 6n;
    await fxrp.mint(owner.address, treasury);
    await fxrp.approve(await manager.getAddress(), treasury);
    await manager.depositTreasury(treasury);

    const accountId = await oracle.accountIdFor("stripe", REF);
    await oracle.connect(borrower).submitAttestation(accountId, revenueProof(400_000, 0));

    // A $100 advance: $105 owed after the fee.
    await manager.connect(borrower).requestAdvance(accountId, 10_000);

    return { owner, borrower, oracle, fxrp, manager, accountId };
}

describe("Repayment rails", () => {
    describe("batching", () => {
        it("settles several small payments in one transaction", async () => {
            const { manager, accountId } = await setup();
            // Three payments of $30 against $105 owed.
            const proofs = [
                paymentProof(30n * DROPS, accountId),
                paymentProof(30n * DROPS, accountId),
                paymentProof(30n * DROPS, accountId),
            ];
            await manager.repayFromXrplBatch(accountId, proofs);
            expect((await manager.advanceOf(accountId)).outstandingCents).to.equal(1_500n); // $15 left
        });

        it("a batch that closes the debt mid-way banks the rest as credit", async () => {
            const { manager, accountId } = await setup();
            const proofs = [
                paymentProof(100n * DROPS, accountId), // $100 of $105
                paymentProof(100n * DROPS, accountId), // $5 to debt, $95 to credit
                paymentProof(10n * DROPS, accountId), // all credit
            ];
            await manager.repayFromXrplBatch(accountId, proofs);

            const a = await manager.advanceOf(accountId);
            expect(a.open).to.equal(false);
            expect(a.outstandingCents).to.equal(0n);
            expect(await manager.creditCents(accountId)).to.equal(10_500n); // $95 + $10
        });

        it("rejects an empty batch", async () => {
            const { manager, accountId } = await setup();
            await expect(manager.repayFromXrplBatch(accountId, [])).to.be.revertedWithCustomError(
                manager,
                "InvalidAmount"
            );
        });

        it("one replayed payment fails the whole batch, atomically", async () => {
            const { manager, accountId } = await setup();
            const dup = paymentProof(10n * DROPS, accountId, { transactionId: ethers.id("dup") });
            await manager.repayFromXrpl(accountId, dup);
            const before = (await manager.advanceOf(accountId)).outstandingCents;

            await expect(
                manager.repayFromXrplBatch(accountId, [paymentProof(10n * DROPS, accountId), dup])
            ).to.be.revertedWithCustomError(manager, "XrplPaymentAlreadyUsed");
            // The batch is atomic: the good payment in it did not land either.
            expect((await manager.advanceOf(accountId)).outstandingCents).to.equal(before);
        });
    });

    describe("sender binding", () => {
        it("unbound, anyone may settle the debt", async () => {
            const { manager, accountId } = await setup();
            await expect(
                manager.repayFromXrpl(accountId, paymentProof(10n * DROPS, accountId, { sender: "rAStranger" }))
            ).to.not.be.reverted;
        });

        it("bound, a payment from anywhere else is rejected", async () => {
            const { manager, borrower, accountId } = await setup();
            await manager.connect(borrower).bindRepaymentSource(accountId, BORROWER_XRPL);

            await expect(
                manager.repayFromXrpl(accountId, paymentProof(10n * DROPS, accountId, { sender: "rAStranger" }))
            ).to.be.revertedWithCustomError(manager, "WrongPaymentSender");

            await expect(
                manager.repayFromXrpl(accountId, paymentProof(10n * DROPS, accountId))
            ).to.not.be.reverted;
        });

        it("an empty string lifts the binding", async () => {
            const { manager, borrower, accountId } = await setup();
            await manager.connect(borrower).bindRepaymentSource(accountId, BORROWER_XRPL);
            await manager.connect(borrower).bindRepaymentSource(accountId, "");
            await expect(
                manager.repayFromXrpl(accountId, paymentProof(10n * DROPS, accountId, { sender: "rAStranger" }))
            ).to.not.be.reverted;
        });

        it("only the account owner can bind it", async () => {
            const { manager, owner, accountId } = await setup();
            await expect(
                manager.connect(owner).bindRepaymentSource(accountId, BORROWER_XRPL)
            ).to.be.revertedWithCustomError(manager, "NotAccountOwner");
        });
    });

    describe("overpayment credit", () => {
        it("the excess of an overpayment becomes credit instead of vanishing", async () => {
            const { manager, accountId } = await setup();
            await manager.repayFromXrpl(accountId, paymentProof(150n * DROPS, accountId)); // $150 vs $105

            expect((await manager.advanceOf(accountId)).open).to.equal(false);
            expect(await manager.creditCents(accountId)).to.equal(4_500n); // $45
        });

        it("a payment with no open advance is all credit", async () => {
            const { manager, accountId } = await setup();
            await manager.repayFromXrpl(accountId, paymentProof(105n * DROPS, accountId)); // closes it
            await manager.repayFromXrpl(accountId, paymentProof(20n * DROPS, accountId)); // lands as credit

            expect(await manager.creditCents(accountId)).to.equal(2_000n);
        });

        it("credit settles the next advance at origination", async () => {
            const { manager, borrower, accountId } = await setup();
            await manager.repayFromXrpl(accountId, paymentProof(150n * DROPS, accountId)); // $45 credit

            await manager.connect(borrower).requestAdvance(accountId, 10_000); // $105 owed
            const a = await manager.advanceOf(accountId);
            expect(a.outstandingCents).to.equal(6_000n); // $105 − $45
            expect(await manager.creditCents(accountId)).to.equal(0n);
        });

        it("credit that covers the whole advance closes it at open — without a clean cycle", async () => {
            const { manager, borrower, accountId } = await setup();
            // Close the first advance by repaying (that IS a clean cycle), then bank a big credit.
            await manager.repayFromXrpl(accountId, paymentProof(105n * DROPS, accountId));
            expect(await manager.closedCleanCycles(accountId)).to.equal(1);
            await manager.repayFromXrpl(accountId, paymentProof(300n * DROPS, accountId)); // $300 credit

            // A $105 obligation opens and instantly closes against the credit.
            await manager.connect(borrower).requestAdvance(accountId, 10_000);
            const a = await manager.advanceOf(accountId);
            expect(a.open).to.equal(false);
            expect(a.outstandingCents).to.equal(0n);
            expect(await manager.creditCents(accountId)).to.equal(19_500n); // $300 − $105

            // The borrower got the FXRP and the debt is settled — but no tier progress was earned.
            expect(await manager.closedCleanCycles(accountId)).to.equal(1);
        });
    });
});
