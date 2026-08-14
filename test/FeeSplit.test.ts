import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * V6: the fee splits at source.
 *
 * Every repayment carries a pro-rata slice of the origination fee. Instead of all of it landing in the
 * senior share price, the junior first-loss buffer takes 20% and the keeper reserve 10%, so the cushion
 * and the watchmen refill from revenue instead of manual top-ups. Senior receives the remainder, and
 * zeroing both knobs restores V5 exactly.
 */

const DTO_TYPE = "tuple(string platform,string accountRef,uint256 revenueCents,uint256 periodStart,uint256 periodEnd,uint256 refundCents,uint256 disputeCount)";
const coder = AbiCoder.defaultAbiCoder();

const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY;
const XRP_USD = 1_000_000n; // $1: cents and micro-FXRP coincide
const PRICE_DECIMALS = 6;
const REF = "acct_1FeeSplit";

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

async function setup(opts: { pool?: boolean } = { pool: true }) {
    const [owner, borrower, lp, stranger] = await ethers.getSigners();

    const Oracle = await ethers.getContractFactory("RevenueOracleHarness");
    const oracle = await Oracle.deploy();
    const Token = await ethers.getContractFactory("MockFXRP");
    const fxrp = await Token.deploy();
    const Manager = await ethers.getContractFactory("AdvanceManagerHarness");
    const manager = await Manager.deploy(await oracle.getAddress(), await fxrp.getAddress());
    await manager.setXrpUsd(XRP_USD, PRICE_DECIMALS);
    await manager.setFactorSchedule(10_000, 0, 10_000, 0);
    await manager.setReserveTerms(0, 1); // the reserve has its own suite; keep the arithmetic clean here

    let pool;
    if (opts.pool) {
        const Pool = await ethers.getContractFactory("LenderPool");
        pool = await Pool.deploy(await fxrp.getAddress());
        await pool.setManager(await manager.getAddress());
        await manager.setPool(await pool.getAddress());
        await fxrp.mint(lp.address, 100_000_000_000n);
        await fxrp.connect(lp).approve(await pool.getAddress(), 100_000_000_000n);
        await pool.connect(lp).deposit(100_000_000_000n, lp.address);
    } else {
        await fxrp.mint(owner.address, 100_000_000_000n);
        await fxrp.connect(owner).approve(await manager.getAddress(), 100_000_000_000n);
        await manager.depositTreasury(100_000_000_000n);
    }

    await fxrp.mint(borrower.address, 100_000_000_000n);
    await fxrp.connect(borrower).approve(await manager.getAddress(), 100_000_000_000n);

    const accountId = await oracle.accountIdFor("stripe", REF);
    const now = await time.latest();
    const end = now - 121 * DAY; // seasoned, so age-weighting is not in play
    await oracle.connect(borrower).submitAttestation(accountId, revenueProof(400_000, end - MONTH, end));

    return { owner, borrower, lp, stranger, oracle, fxrp, manager, pool, accountId };
}

describe("The fee split, at source", () => {
    it("a full repayment splits the fee 70/20/10 and the books balance", async () => {
        const { borrower, manager, pool, accountId } = await setup();

        // $1,000 advance at 5% fee: $50 of fee, $1,050 owed. At $1, one cent = 10,000 micro-FXRP.
        await manager.connect(borrower).requestAdvance(accountId, 100_000n);

        const juniorBefore = await pool!.juniorAssets();
        const keeperBefore = await manager.keeperReserveFxrp();
        const assetsBefore = await pool!.totalAssets();

        await manager.connect(borrower).repay(accountId, 105_000n);

        // Fee slice of the payment: 1,050,000,000 * 5,000/105,000 = 50,000,000 micro-FXRP ($50).
        expect((await pool!.juniorAssets()) - juniorBefore).to.equal(10_000_000n); // 20% of the fee
        expect((await manager.keeperReserveFxrp()) - keeperBefore).to.equal(5_000_000n); // 10%

        // Senior yield = 70% of the fee: totalAssets grew by exactly that (junior backs no shares).
        expect((await pool!.totalAssets()) - assetsBefore).to.equal(35_000_000n);
    });

    it("partial repayments split pro-rata, and the sum matches a single full repayment", async () => {
        const { borrower, manager, pool, accountId } = await setup();
        await manager.connect(borrower).requestAdvance(accountId, 100_000n);

        await manager.connect(borrower).repay(accountId, 52_500n);
        await manager.connect(borrower).repay(accountId, 52_500n);

        expect(await pool!.juniorAssets()).to.equal(10_000_000n);
        expect(await manager.keeperReserveFxrp()).to.equal(5_000_000n);
        expect((await manager.advanceOf(accountId)).open).to.equal(false);
    });

    it("the keeper reserve funded by the split actually pays a keeper", async () => {
        const { borrower, stranger, fxrp, manager, accountId } = await setup();
        await manager.connect(borrower).requestAdvance(accountId, 100_000n);
        await manager.connect(borrower).repay(accountId, 52_500n); // seeds the keeper reserve via the split

        // A second advance goes quiet past the grace period.
        await manager.connect(borrower).repay(accountId, 52_500n);
        await time.increase(1 * DAY + 1); // clear the origination epoch
        await manager.connect(borrower).requestAdvance(accountId, 100_000n);
        await time.increase(46 * DAY);

        const before = await fxrp.balanceOf(stranger.address);
        await manager.connect(stranger).markDelinquent(accountId);
        expect((await fxrp.balanceOf(stranger.address)) - before).to.equal(5_000_000n); // the tip
    });

    it("splits only what services the debt: an overpayment's credit is not taxed", async () => {
        const { borrower, manager, pool, accountId } = await setup();
        await manager.connect(borrower).requestAdvance(accountId, 100_000n); // owes $1,050

        // $1,500 arrives through the third-party rail: $1,050 closes the debt, $450 banks as credit.
        await manager.connect(borrower).repayFxrpFor(accountId, 1_500_000_000n);
        expect(await manager.creditCents(accountId)).to.equal(45_000n);

        // The fee slice must be computed on the $1,050 that serviced the debt — the whole $50 fee —
        // and not on the $450 of credit, which is the borrower's own money passing through.
        expect(await pool!.juniorAssets()).to.equal(10_000_000n); // 20% of $50, not 20% of $71.43
        expect(await manager.keeperReserveFxrp()).to.equal(5_000_000n);
        expect((await manager.advanceOf(accountId)).open).to.equal(false);
    });

    it("treasury mode takes only the keeper cut", async () => {
        const { borrower, manager, accountId } = await setup({ pool: false });
        await manager.connect(borrower).requestAdvance(accountId, 100_000n);

        const treasuryBefore = await manager.treasuryBalance();
        await manager.connect(borrower).repay(accountId, 105_000n);

        expect(await manager.keeperReserveFxrp()).to.equal(5_000_000n);
        // Treasury receives everything except the keeper cut.
        expect((await manager.treasuryBalance()) - treasuryBefore).to.equal(1_050_000_000n - 5_000_000n);
    });

    it("zeroing the split restores V5 behaviour exactly", async () => {
        const { borrower, manager, pool, accountId } = await setup();
        await manager.setFeeSplit(0, 0);
        await manager.connect(borrower).requestAdvance(accountId, 100_000n);

        const juniorBefore = await pool!.juniorAssets();
        const assetsBefore = await pool!.totalAssets();
        await manager.connect(borrower).repay(accountId, 105_000n);

        expect(await pool!.juniorAssets()).to.equal(juniorBefore);
        expect(await manager.keeperReserveFxrp()).to.equal(0n);
        expect((await pool!.totalAssets()) - assetsBefore).to.equal(50_000_000n); // the whole fee, senior
    });

    it("the setter refuses a split beyond 100% and only the owner holds it", async () => {
        const { borrower, manager } = await setup();
        await expect(manager.setFeeSplit(9_000, 2_000)).to.be.revertedWithCustomError(manager, "InvalidSplit");
        await expect(manager.connect(borrower).setFeeSplit(0, 0)).to.be.reverted;
    });
});

describe("The write-off delegate", () => {
    it("the named delegate can write off; a stranger cannot; the owner always can", async () => {
        const { owner, borrower, lp, stranger, manager, accountId } = await setup();
        await manager.connect(owner).setDelegate(lp.address);

        await manager.connect(borrower).requestAdvance(accountId, 100_000n);
        await time.increase(46 * DAY);
        await manager.markDelinquent(accountId);
        await time.increase(91 * DAY);

        await expect(manager.connect(stranger).writeOff(accountId)).to.be.revertedWithCustomError(
            manager, "NotDelegateOrOwner"
        );
        await expect(manager.connect(lp).writeOff(accountId)).to.emit(manager, "WrittenOff");
    });
});
