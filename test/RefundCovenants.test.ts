import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * V6: refunds arrive attested, and the covenants read them.
 *
 * Visa's VAMP thresholds as contract law: past 1.5% of gross refunded, the revenue-share rate steps up
 * by half (a refund-heavy month repays faster); past 2.2%, the account cannot originate at all until a
 * cleaner month is proven. No risk team, no discretion — the same monitoring every acquirer runs, as
 * public policy.
 */

const DTO_TYPE = "tuple(string platform,string accountRef,uint256 revenueCents,uint256 periodStart,uint256 periodEnd,uint256 refundCents,uint256 disputeCount)";
const coder = AbiCoder.defaultAbiCoder();

const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY;
const XRP_USD = 1_000_000n;
const PRICE_DECIMALS = 6;
const REF = "acct_1Refunds";

function proofWithRefunds(revenueCents: number, refundCents: number, periodStart: number, periodEnd: number) {
    const abiEncodedData = coder.encode(
        [DTO_TYPE],
        [["stripe", REF, revenueCents, periodStart, periodEnd, refundCents, 0]]
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
    await manager.setReserveTerms(0, 1);
    await manager.setFeeSplit(0, 0); // the split has its own suite

    await fxrp.mint(owner.address, 100_000_000_000n);
    await fxrp.connect(owner).approve(await manager.getAddress(), 100_000_000_000n);
    await manager.depositTreasury(100_000_000_000n);

    await fxrp.mint(borrower.address, 100_000_000_000n);
    await fxrp.connect(borrower).approve(await manager.getAddress(), 100_000_000_000n);

    const accountId = await oracle.accountIdFor("stripe", REF);
    const now = await time.latest();
    const start = now - 200 * DAY; // room for several consecutive months, all seasoned
    return { owner, borrower, oracle, fxrp, manager, accountId, start };
}

describe("The refund ratio, attested and read", () => {
    it("computes against gross: refunds over net plus refunds", async () => {
        const { borrower, oracle, accountId, start } = await setup();
        // $3,900 net with $100 refunded: 10,000/400,000 of gross = 2.5% = 250 bps.
        await oracle.connect(borrower).submitAttestation(
            accountId, proofWithRefunds(390_000, 10_000, start, start + MONTH)
        );
        expect(await oracle.refundRatioBps(accountId)).to.equal(250);
    });

    it("a clean period reads zero", async () => {
        const { borrower, oracle, accountId, start } = await setup();
        await oracle.connect(borrower).submitAttestation(
            accountId, proofWithRefunds(400_000, 0, start, start + MONTH)
        );
        expect(await oracle.refundRatioBps(accountId)).to.equal(0);
    });
});

describe("The freeze covenant", () => {
    it("an account past 2.2% refunded cannot originate", async () => {
        const { borrower, oracle, manager, accountId, start } = await setup();
        await oracle.connect(borrower).submitAttestation(
            accountId, proofWithRefunds(390_000, 10_000, start, start + MONTH) // 2.5%
        );
        await expect(
            manager.connect(borrower).requestAdvance(accountId, 10_000n)
        ).to.be.revertedWithCustomError(manager, "ExcessiveRefunds");
    });

    it("a cleaner month unfreezes it", async () => {
        const { borrower, oracle, manager, accountId, start } = await setup();
        await oracle.connect(borrower).submitAttestation(
            accountId, proofWithRefunds(390_000, 10_000, start, start + MONTH)
        );
        await oracle.connect(borrower).submitAttestation(
            accountId, proofWithRefunds(400_000, 1_000, start + MONTH, start + 2 * MONTH) // 0.25%
        );
        await expect(manager.connect(borrower).requestAdvance(accountId, 10_000n)).to.not.be.reverted;
    });
});

describe("The warning covenant", () => {
    it("steps the revenue share up by half when the latest period warns", async () => {
        const { borrower, oracle, manager, accountId, start } = await setup();
        // Clean month, borrow against it.
        await oracle.connect(borrower).submitAttestation(
            accountId, proofWithRefunds(400_000, 0, start, start + MONTH)
        );
        await manager.connect(borrower).requestAdvance(accountId, 300_000n); // $3,000, owes $3,150

        // The next month warns: 2% refunded (past 1.5%, under 2.2%).
        await oracle.connect(borrower).submitAttestation(
            accountId, proofWithRefunds(392_000, 8_000, start + MONTH, start + 2 * MONTH)
        );

        const before = (await manager.advanceOf(accountId)).outstandingCents;
        await manager.connect(borrower).applyRevenueRepayment(accountId);
        const repaid = before - (await manager.advanceOf(accountId)).outstandingCents;

        // 20% base share stepped to 30% of the period's net revenue: $1,176 rather than $784.
        expect(repaid).to.equal(117_600n);
    });

    it("a clean period repays at the base share", async () => {
        const { borrower, oracle, manager, accountId, start } = await setup();
        await oracle.connect(borrower).submitAttestation(
            accountId, proofWithRefunds(400_000, 0, start, start + MONTH)
        );
        await manager.connect(borrower).requestAdvance(accountId, 300_000n);
        await oracle.connect(borrower).submitAttestation(
            accountId, proofWithRefunds(400_000, 1_000, start + MONTH, start + 2 * MONTH) // 0.25%
        );

        const before = (await manager.advanceOf(accountId)).outstandingCents;
        await manager.connect(borrower).applyRevenueRepayment(accountId);
        expect(before - (await manager.advanceOf(accountId)).outstandingCents).to.equal(80_000n); // 20%
    });
});

describe("Governance of the thresholds", () => {
    it("warn must sit below freeze, and only the owner sets them", async () => {
        const { borrower, manager } = await setup();
        await expect(manager.setRefundCovenants(300, 200)).to.be.revertedWithCustomError(manager, "InvalidAmount");
        await expect(manager.connect(borrower).setRefundCovenants(100, 200)).to.be.reverted;
        await expect(manager.setRefundCovenants(100, 200)).to.emit(manager, "RefundCovenantsSet");
    });
});
