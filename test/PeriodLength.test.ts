import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";

/**
 * A period has to be a month, because the underwriting treats it as one.
 *
 * The window an attestation covers is chosen by whoever builds the FDC request — it is a date range in the
 * processor's API query, not something the network decides. `advanceLimitCents` then takes the mean of the
 * last few *records* and lends a fraction of it, treating each record as one month's takings. Nothing
 * checked that a record was a month, so a single attestation covering a year of genuine revenue would be
 * underwritten as though a year's earnings were one month's — the same real business borrowing an order of
 * magnitude more than the policy intends, with every figure honestly attested.
 *
 * This is what makes the anti-recycling argument hold: a first advance is meant to be smaller than the card
 * fees paid to fabricate the revenue behind it, and that comparison is only true per month.
 */

const DTO_TYPE = "tuple(string platform,string accountRef,uint256 revenueCents,uint256 periodStart,uint256 periodEnd,uint256 refundCents,uint256 disputeCount)";
const coder = AbiCoder.defaultAbiCoder();

const DAY = 24 * 60 * 60;
const JAN = 1767225600;
const REF = "acct_1PeriodLen";

function revenueProof(revenueCents: number, periodStart: number, periodEnd: number) {
    const abiEncodedData = coder.encode([DTO_TYPE], [["stripe", REF, revenueCents, periodStart, periodEnd, 0, 0]]);
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

async function setup() {
    const [, borrower] = await ethers.getSigners();
    const Oracle = await ethers.getContractFactory("RevenueOracleHarness");
    const oracle = await Oracle.deploy();
    const accountId = await oracle.accountIdFor("stripe", REF);
    return { borrower, oracle, accountId };
}

describe("A proven period has to look like a month", () => {
    it("accepts an ordinary month", async () => {
        const { borrower, oracle, accountId } = await setup();
        await expect(oracle.connect(borrower).submitAttestation(accountId, revenueProof(400_000, JAN, JAN + 30 * DAY)))
            .to.emit(oracle, "RevenueProven");
    });

    it("accepts the short and long ends of a real calendar month", async () => {
        const { borrower, oracle, accountId } = await setup();
        await oracle.connect(borrower).submitAttestation(accountId, revenueProof(400_000, JAN, JAN + 28 * DAY));
        await oracle
            .connect(borrower)
            .submitAttestation(accountId, revenueProof(400_000, JAN + 28 * DAY, JAN + 59 * DAY)); // 31 days
        expect(await oracle.attestationCount(accountId)).to.equal(2n);
    });

    it("refuses a year of revenue presented as one period", async () => {
        const { borrower, oracle, accountId } = await setup();

        // Every figure here is genuine — it is the window that lies.
        await expect(
            oracle.connect(borrower).submitAttestation(accountId, revenueProof(4_800_000, JAN, JAN + 365 * DAY))
        ).to.be.revertedWithCustomError(oracle, "InvalidPeriodLength");
    });

    it("refuses a single day dressed up as a period", async () => {
        const { borrower, oracle, accountId } = await setup();
        await expect(
            oracle.connect(borrower).submitAttestation(accountId, revenueProof(400_000, JAN, JAN + DAY))
        ).to.be.revertedWithCustomError(oracle, "InvalidPeriodLength");
    });
});
