import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Two ways an advance could quietly escape its own rules.
 *
 * The first is the drip: every repayment refreshes the delinquency clock, so a borrower who pays a single
 * cent inside each grace period keeps a balance open forever while never being late. The second is a short
 * fill from FAssets: the debt is computed from the lots asked for, so a redemption that only partly
 * succeeded would leave the borrower owing dollars against XRP nobody sent.
 */

const DTO_TYPE = "tuple(string platform,string accountRef,uint256 revenueCents,uint256 periodStart,uint256 periodEnd,uint256 refundCents,uint256 disputeCount)";
const coder = AbiCoder.defaultAbiCoder();

const MONTH = 30 * 24 * 60 * 60;
const DAY = 24 * 60 * 60;
const JAN = 1767225600;
const XRP_USD = 1_000_000n;
const PRICE_DECIMALS = 6;
const REF = "acct_1TermTest";

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
    const [owner, borrower] = await ethers.getSigners();

    const Oracle = await ethers.getContractFactory("RevenueOracleHarness");
    const oracle = await Oracle.deploy();
    const Token = await ethers.getContractFactory("MockFXRP");
    const fxrp = await Token.deploy();
    const Manager = await ethers.getContractFactory("AdvanceManagerHarness");
    const manager = await Manager.deploy(await oracle.getAddress(), await fxrp.getAddress());
    await manager.setXrpUsd(XRP_USD, PRICE_DECIMALS);
    await manager.setFactorSchedule(10_000, 0, 10_000, 0);

    await fxrp.mint(owner.address, 50_000_000_000n);
    await fxrp.connect(owner).approve(await manager.getAddress(), 50_000_000_000n);
    await manager.depositTreasury(50_000_000_000n);

    await fxrp.mint(borrower.address, 50_000_000_000n);
    await fxrp.connect(borrower).approve(await manager.getAddress(), 50_000_000_000n);

    const accountId = await oracle.accountIdFor("stripe", REF);
    await oracle.connect(borrower).submitAttestation(accountId, revenueProof(400_000, JAN, JAN + MONTH));

    return { owner, borrower, oracle, fxrp, manager, accountId };
}

describe("An advance cannot outlive its term", () => {
    it("a cent every forty days no longer holds the balance open forever", async () => {
        const { borrower, manager, accountId } = await setup();
        await manager.connect(borrower).requestAdvance(accountId, 100_000n); // $1,000

        // Drip-feed one cent every 40 days, inside the 45-day grace, for most of a year.
        for (let i = 0; i < 8; i++) {
            await time.increase(40 * DAY);
            await manager.connect(borrower).repay(accountId, 1n);
        }

        // The grace clock alone would still say this account is current...
        const advance = await manager.advanceOf(accountId);
        expect(advance.open).to.equal(true);
        expect(advance.outstandingCents).to.be.gt(100_000n - 100n); // barely repaid anything

        // ...but the term has long since expired, so anyone can mark it delinquent.
        await expect(manager.markDelinquent(accountId)).to.emit(manager, "MarkedDelinquent");
        expect((await manager.advanceOf(accountId)).delinquent).to.equal(true);
    });

    it("an advance inside both its grace period and its term is not delinquent", async () => {
        const { borrower, manager, accountId } = await setup();
        await manager.connect(borrower).requestAdvance(accountId, 100_000n);

        await time.increase(30 * DAY);
        await expect(manager.markDelinquent(accountId)).to.be.revertedWithCustomError(
            manager,
            "GracePeriodNotElapsed"
        );
    });

    it("the term is governable and cannot be set to zero", async () => {
        const { manager } = await setup();
        await expect(manager.setMaxTerm(0)).to.be.revertedWithCustomError(manager, "InvalidAmount");
        await expect(manager.setMaxTerm(90 * DAY)).to.emit(manager, "MaxTermSet").withArgs(90 * DAY);
    });
});

describe("A short FAssets fill is refused, not booked", () => {
    it("reverts rather than opening an advance against XRP that was never sent", async () => {
        const { owner, borrower, manager, accountId, fxrp } = await setup();

        const LOT = 10_000_000n; // 10 XRP, as on Coston2
        const Redeemer = await ethers.getContractFactory("MockAssetManager");
        const redeemer = await Redeemer.deploy(await fxrp.getAddress(), LOT);
        await manager.setAssetManager(await redeemer.getAddress());

        // The agent can only fill nine tenths of what is asked for.
        await redeemer.setFillRatioBps(9_000);

        await expect(
            manager.connect(borrower).requestAdvanceToXrpl(accountId, 2n, "rBorrowerXrplAddress11111111")
        ).to.be.revertedWithCustomError(manager, "RedemptionShortfall");

        // A full fill still works.
        await redeemer.setFillRatioBps(10_000);
        await expect(
            manager.connect(borrower).requestAdvanceToXrpl(accountId, 2n, "rBorrowerXrplAddress11111111")
        ).to.emit(manager, "AdvanceDisbursedToXrpl");
        expect(owner.address).to.be.a("string"); // keep the signer referenced
    });
});
