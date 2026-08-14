import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Phase A of the real-world plan: the incumbent industry's risk mechanisms, adapted on-chain.
 *
 * Each mechanism is tested the way the research described the real one working: the rolling reserve
 * behaves like an acquirer's, the floor curve like Stripe Capital's minimum, the splitter like
 * Shopify Capital's payout withholding, the keeper tip like Maker's flat kick incentive, the guardian
 * like Compound's pause asymmetry.
 */

const DTO_TYPE = "tuple(string platform,string accountRef,uint256 revenueCents,uint256 periodStart,uint256 periodEnd,uint256 refundCents,uint256 disputeCount)";
const coder = AbiCoder.defaultAbiCoder();

const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY;
const XRP_USD = 1_000_000n; // $1, so cents and micro-FXRP coincide
const PRICE_DECIMALS = 6;
const REF = "acct_1PhaseA";

let periodCursor = 1767225600; // advances as periods are attested, so they never overlap

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

async function setup(opts: { pool?: boolean } = {}) {
    const [owner, borrower, merchant, keeper, guardian, lp] = await ethers.getSigners();

    const Oracle = await ethers.getContractFactory("RevenueOracleHarness");
    const oracle = await Oracle.deploy();
    const Token = await ethers.getContractFactory("MockFXRP");
    const fxrp = await Token.deploy();
    const Manager = await ethers.getContractFactory("AdvanceManagerHarness");
    const manager = await Manager.deploy(await oracle.getAddress(), await fxrp.getAddress());
    await manager.setXrpUsd(XRP_USD, PRICE_DECIMALS);
    await manager.setFactorSchedule(10_000, 0, 10_000, 0);

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
    // Attest a period that ended one full refund window ago, so the baseline tests see full weight.
    const now = await time.latest();
    const end = now - 121 * DAY;
    await oracle.connect(borrower).submitAttestation(accountId, revenueProof(400_000, end - MONTH, end));

    return { owner, borrower, merchant, keeper, guardian, lp, oracle, fxrp, manager, pool, accountId };
}

// ---------------------------------------------------------------- A3: age weighting

describe("Age-weighted underwriting", () => {
    it("counts seasoned revenue in full", async () => {
        const { manager, accountId } = await setup();
        // $4,000 seasoned at 1.0x factor = $4,000 limit.
        expect(await manager.advanceLimitCents(accountId)).to.equal(400_000n);
    });

    it("haircuts revenue that just settled by half", async () => {
        const [, borrower] = await ethers.getSigners();
        const { oracle, manager } = await setup();
        const accountId = await oracle.accountIdFor("stripe", REF);

        // A fresh period ending now: provisional money, weighted toward 50%.
        const now = await time.latest();
        await oracle.connect(borrower).submitAttestation(accountId, revenueProof(400_000, now - MONTH, now));

        // History = [seasoned 400k, fresh 400k]; mean of (400k, ~200k) ≈ 300k.
        const limit = await manager.advanceLimitCents(accountId);
        expect(limit).to.be.closeTo(300_000n, 2_000n);
    });
});

// ---------------------------------------------------------------- A4: rolling reserve

describe("The rolling reserve", () => {
    it("escrows 10% of the advance and disburses the rest", async () => {
        const { borrower, fxrp, manager, accountId } = await setup();
        const before = await fxrp.balanceOf(borrower.address);

        await manager.connect(borrower).requestAdvance(accountId, 100_000n); // $1,000
        const received = (await fxrp.balanceOf(borrower.address)) - before;

        expect(received).to.equal(900_000_000n); // $900 worth at $1
        expect(await manager.reserveFxrp(accountId)).to.equal(100_000_000n); // $100 held
    });

    it("releases the reserve when the advance closes clean", async () => {
        const { borrower, fxrp, manager, accountId } = await setup();
        await manager.connect(borrower).requestAdvance(accountId, 100_000n);
        await manager.connect(borrower).repay(accountId, 105_000n); // principal + 5% fee

        const before = await fxrp.balanceOf(borrower.address);
        await manager.releaseReserve(accountId);
        expect((await fxrp.balanceOf(borrower.address)) - before).to.equal(100_000_000n);
        expect(await manager.reserveFxrp(accountId)).to.equal(0n);
    });

    it("releases after the refund window even while the advance is open", async () => {
        const { borrower, manager, accountId } = await setup();
        await manager.connect(borrower).requestAdvance(accountId, 100_000n);

        await expect(manager.releaseReserve(accountId)).to.be.revertedWithCustomError(
            manager, "ReserveNotReleasable"
        );
        await time.increase(121 * DAY);
        await expect(manager.releaseReserve(accountId)).to.emit(manager, "ReserveReleased");
    });

    it("a write-off consumes the reserve before the pool takes the loss", async () => {
        const { borrower, manager, pool, accountId } = await setup({ pool: true });
        await manager.connect(borrower).requestAdvance(accountId, 100_000n);

        await time.increase(46 * DAY);
        await manager.markDelinquent(accountId);
        await time.increase(91 * DAY);

        const assetsBefore = await pool!.totalAssets();
        await expect(manager.writeOff(accountId)).to.emit(manager, "ReserveConsumed");

        // The pool lost the disbursed principal minus the recovered reserve, never the full amount:
        // $1,000 went out as FXRP, $100 came back from the reserve, so the book absorbs $900.
        const assetsAfter = await pool!.totalAssets();
        expect(assetsBefore - assetsAfter).to.equal(1_000_000_000n - 100_000_000n);
        expect(await manager.reserveFxrp(accountId)).to.equal(0n);
    });

    it("a reserve larger than the loss nets against it and the surplus goes home", async () => {
        const { borrower, fxrp, manager, pool, accountId } = await setup({ pool: true });
        await manager.connect(borrower).requestAdvance(accountId, 100_000n);

        // Repay $1,000 of the $1,050 owed, then rot: the $100 reserve now exceeds the ~$47.6 of
        // FXRP still out, and the difference is the borrower's money, not the contract's.
        await manager.connect(borrower).repay(accountId, 100_000n);
        await time.increase(46 * DAY);
        await manager.markDelinquent(accountId);
        await time.increase(91 * DAY);

        const advance = await manager.advanceOf(accountId);
        const lostFxrp = advance.fxrpDisbursed - (await manager.fxrpRetired(accountId));
        const reserve = await manager.reserveFxrp(accountId);
        expect(reserve).to.be.gt(lostFxrp); // the scenario is real, not vacuous

        const borrowerBefore = await fxrp.balanceOf(borrower.address);
        const assetsBefore = await pool!.totalAssets();
        await expect(manager.writeOff(accountId)).to.emit(manager, "ReserveReleased");

        // Surplus home, loss fully absorbed by the reserve, the pool whole.
        expect((await fxrp.balanceOf(borrower.address)) - borrowerBefore).to.equal(reserve - lostFxrp);
        expect(await pool!.totalAssets()).to.equal(assetsBefore);
        expect(await manager.reserveFxrp(accountId)).to.equal(0n);

        // And nothing strands: the manager holds exactly the keeper reserve, no orphaned FXRP.
        expect(await fxrp.balanceOf(await manager.getAddress())).to.equal(await manager.keeperReserveFxrp());
    });

    it("in treasury mode the consumed reserve is booked, and the books cover the balance", async () => {
        const { borrower, fxrp, manager, accountId } = await setup();
        await manager.connect(borrower).requestAdvance(accountId, 100_000n);
        await manager.connect(borrower).repay(accountId, 100_000n);
        await time.increase(46 * DAY);
        await manager.markDelinquent(accountId);
        await time.increase(91 * DAY);

        // Retirement is pool bookkeeping; in treasury mode the loss is the whole disbursement, so
        // the entire reserve is consumed and every drop of it must land on the treasury's ledger.
        const reserve = await manager.reserveFxrp(accountId);
        const treasuryBefore = await manager.treasuryBalance();

        await manager.writeOff(accountId);

        expect((await manager.treasuryBalance()) - treasuryBefore).to.equal(reserve);
        // Every FXRP the contract holds is on a ledger: treasury plus keeper reserve, nothing orphaned.
        expect(await fxrp.balanceOf(await manager.getAddress())).to.equal(
            (await manager.treasuryBalance()) + (await manager.keeperReserveFxrp())
        );
    });
});

// ---------------------------------------------------------------- A5: the floor curve

describe("The repayment floor", () => {
    it("is zero shortfall on schedule, and breaches when repayment lags", async () => {
        const { borrower, manager, accountId } = await setup();
        await manager.connect(borrower).requestAdvance(accountId, 100_000n); // owes $1,050

        // On day one nothing is required yet.
        await expect(manager.declareFloorBreach(accountId)).to.be.revertedWithCustomError(
            manager, "FloorNotBreached"
        );

        // At half-term (90d), 30% must be home. Nothing was repaid.
        await time.increase(90 * DAY);
        await expect(manager.declareFloorBreach(accountId)).to.emit(manager, "FloorBreached");
        expect(await manager.floorBreached(accountId)).to.equal(true);
    });

    it("a catch-up repayment cures the breach automatically", async () => {
        const { borrower, manager, accountId } = await setup();
        await manager.connect(borrower).requestAdvance(accountId, 100_000n);
        await time.increase(90 * DAY);
        await manager.declareFloorBreach(accountId);

        // Repay well past the 30% floor.
        await manager.connect(borrower).repay(accountId, 50_000n);
        expect(await manager.floorBreached(accountId)).to.equal(false);
    });
});

// ---------------------------------------------------------------- A2: the splitter

describe("The revenue splitter: deduction at source", () => {
    async function withSplitter() {
        const s = await setup();
        const Splitter = await ethers.getContractFactory("RevenueSplitter");
        const splitter = await Splitter.deploy(
            await s.oracle.getAddress(), await s.manager.getAddress(), await s.fxrp.getAddress()
        );
        await s.fxrp.mint(s.borrower.address, 0n);
        return { ...s, splitter };
    }

    it("splits each settlement: the share to the debt, the rest to the merchant", async () => {
        const { borrower, merchant, fxrp, manager, splitter, accountId } = await withSplitter();
        await manager.connect(borrower).requestAdvance(accountId, 100_000n); // owes $1,050
        await splitter.connect(borrower).enroll(accountId, merchant.address, 2_000); // 20%

        // $500 of revenue arrives through the lockbox.
        await fxrp.connect(borrower).approve(await splitter.getAddress(), 500_000_000n);
        await splitter.connect(borrower).deposit(accountId, 500_000_000n);
        await splitter.settle(accountId);

        // $100 serviced the debt, $400 reached the merchant, atomically.
        expect(await fxrp.balanceOf(merchant.address)).to.equal(400_000_000n);
        expect((await manager.advanceOf(accountId)).outstandingCents).to.equal(105_000n - 10_000n);
    });

    it("springs to 100% withholding while the floor is breached, and relaxes on cure", async () => {
        const { borrower, merchant, fxrp, manager, splitter, accountId } = await withSplitter();
        await manager.connect(borrower).requestAdvance(accountId, 100_000n);
        await splitter.connect(borrower).enroll(accountId, merchant.address, 2_000);

        await time.increase(90 * DAY);
        await manager.declareFloorBreach(accountId);

        // $600 arrives; every cent services the debt while sprung.
        await fxrp.connect(borrower).approve(await splitter.getAddress(), 900_000_000n);
        await splitter.connect(borrower).deposit(accountId, 600_000_000n);
        await splitter.settle(accountId);
        expect(await fxrp.balanceOf(merchant.address)).to.equal(0n);
        expect((await manager.advanceOf(accountId)).outstandingCents).to.equal(105_000n - 60_000n);

        // $600 to debt is past the 30% floor, so the breach has cured; the next split is 20% again.
        expect(await manager.floorBreached(accountId)).to.equal(false);
        await splitter.connect(borrower).deposit(accountId, 300_000_000n);
        await splitter.settle(accountId);
        expect(await fxrp.balanceOf(merchant.address)).to.equal(240_000_000n); // 80% of $300
    });

    it("with no open advance, everything forwards to the merchant", async () => {
        const { borrower, merchant, fxrp, splitter, accountId } = await withSplitter();
        await splitter.connect(borrower).enroll(accountId, merchant.address, 2_000);

        await fxrp.connect(borrower).approve(await splitter.getAddress(), 100_000_000n);
        await splitter.connect(borrower).deposit(accountId, 100_000_000n);
        await splitter.settle(accountId);
        expect(await fxrp.balanceOf(merchant.address)).to.equal(100_000_000n);
    });

    it("only the account owner can enroll, the share is capped, and exit requires a clean slate", async () => {
        const { borrower, merchant, manager, splitter, accountId } = await withSplitter();

        await expect(
            splitter.connect(merchant).enroll(accountId, merchant.address, 2_000)
        ).to.be.revertedWithCustomError(splitter, "NotAccountOwner");
        await expect(
            splitter.connect(borrower).enroll(accountId, merchant.address, 6_000)
        ).to.be.revertedWithCustomError(splitter, "InvalidShare");

        await splitter.connect(borrower).enroll(accountId, merchant.address, 2_000);
        await manager.connect(borrower).requestAdvance(accountId, 10_000n);
        await expect(splitter.connect(borrower).unenroll(accountId)).to.be.revertedWithCustomError(
            splitter, "DebtStillOpen"
        );
    });
});

// ---------------------------------------------------------------- A6: velocity brake

describe("The velocity brake", () => {
    it("caps originations per epoch and reopens next epoch", async () => {
        const { borrower, manager, accountId } = await setup();
        await manager.setVelocity(1);

        await manager.connect(borrower).requestAdvance(accountId, 1_000n);
        await manager.connect(borrower).repay(accountId, 1_050n);

        // Same epoch, second origination: refused regardless of the account's standing.
        await expect(
            manager.connect(borrower).requestAdvance(accountId, 1_000n)
        ).to.be.revertedWithCustomError(manager, "OriginationRateExceeded");

        await time.increase(DAY + 1);
        await expect(manager.connect(borrower).requestAdvance(accountId, 1_000n)).to.not.be.reverted;
    });
});

// ---------------------------------------------------------------- A7: the keeper's tip

describe("The keeper's tip", () => {
    it("pays the flat tip from the funded reserve on a successful mark", async () => {
        const { owner, borrower, keeper, fxrp, manager, accountId } = await setup();
        await manager.connect(borrower).requestAdvance(accountId, 100_000n);

        await fxrp.mint(owner.address, 10_000_000n);
        await fxrp.connect(owner).approve(await manager.getAddress(), 10_000_000n);
        await manager.connect(owner).fundKeeperReserve(10_000_000n);

        await time.increase(46 * DAY);
        const before = await fxrp.balanceOf(keeper.address);
        await expect(manager.connect(keeper).markDelinquent(accountId)).to.emit(manager, "KeeperTipped");
        expect((await fxrp.balanceOf(keeper.address)) - before).to.equal(5_000_000n);
    });

    it("a delinquency pays one tip: re-marking is refused, the reserve cannot be farmed", async () => {
        const { owner, borrower, keeper, fxrp, manager, accountId } = await setup();
        await manager.connect(borrower).requestAdvance(accountId, 100_000n);

        // Reserve funded for ten tips; the delinquency is real but singular.
        await fxrp.mint(owner.address, 50_000_000n);
        await fxrp.connect(owner).approve(await manager.getAddress(), 50_000_000n);
        await manager.connect(owner).fundKeeperReserve(50_000_000n);
        await time.increase(46 * DAY);

        await manager.connect(keeper).markDelinquent(accountId);
        // Both triggers stay true forever on a marked advance — the guard is the only thing
        // standing between one delinquency and the whole reserve.
        await expect(manager.connect(keeper).markDelinquent(accountId)).to.be.revertedWithCustomError(
            manager, "AccountDelinquent"
        );
        expect(await manager.keeperReserveFxrp()).to.equal(45_000_000n); // one tip out, nine intact
    });

    it("an empty reserve degrades the incentive, never the function", async () => {
        const { borrower, keeper, manager, accountId } = await setup();
        await manager.connect(borrower).requestAdvance(accountId, 100_000n);
        await time.increase(46 * DAY);
        await expect(manager.connect(keeper).markDelinquent(accountId)).to.emit(manager, "MarkedDelinquent");
    });

    it("delinquencyDue reports exactly the markable accounts", async () => {
        const { borrower, manager, accountId } = await setup();
        await manager.connect(borrower).requestAdvance(accountId, 100_000n);

        let due = await manager.delinquencyDue([accountId]);
        expect(due[0]).to.equal(false);

        await time.increase(46 * DAY);
        due = await manager.delinquencyDue([accountId]);
        expect(due[0]).to.equal(true);
    });
});

// ---------------------------------------------------------------- A8: the guardian

describe("The guardian's asymmetry", () => {
    it("the guardian pauses instantly; only the owner unpauses", async () => {
        const { owner, guardian, keeper, manager } = await setup();
        await manager.connect(owner).setGuardian(guardian.address);

        await expect(manager.connect(keeper).pause()).to.be.revertedWithCustomError(
            manager, "NotGuardianOrOwner"
        );
        await manager.connect(guardian).pause();
        expect(await manager.paused()).to.equal(true);

        await expect(manager.connect(guardian).unpause()).to.be.reverted; // onlyOwner
        await manager.connect(owner).unpause();
        expect(await manager.paused()).to.equal(false);
    });

    it("repayments run while paused, exactly as before", async () => {
        const { owner, borrower, guardian, manager, accountId } = await setup();
        await manager.connect(owner).setGuardian(guardian.address);
        await manager.connect(borrower).requestAdvance(accountId, 10_000n);

        await manager.connect(guardian).pause();
        await expect(manager.connect(borrower).repay(accountId, 5_000n)).to.not.be.reverted;
        await expect(
            manager.connect(borrower).requestAdvance(accountId, 1_000n)
        ).to.be.reverted; // originations stop
    });
});
