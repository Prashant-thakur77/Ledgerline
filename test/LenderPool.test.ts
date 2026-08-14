import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Phase 2: the lender side.
 *
 * The pool's whole promise is that its share price never lies: yield lands in it, losses land in it, and
 * illiquidity is admitted by `maxWithdraw` instead of discovered by a failed transfer. Most of these tests
 * are that promise, checked.
 */

const DTO_TYPE = "tuple(string platform,string accountRef,uint256 revenueCents,uint256 periodStart,uint256 periodEnd,uint256 refundCents,uint256 disputeCount)";
const coder = AbiCoder.defaultAbiCoder();

const MONTH = 30 * 24 * 60 * 60;
const JAN = 1767225600;
const FXRP = (n: number) => BigInt(Math.round(n * 1e6));
const XRP_USD = 1_000_000n; // $1, so dollars and FXRP line up
const PRICE_DECIMALS = 6;
const REF = "acct_1PoolTest";
const XRPL_TREASURY = "rPoolTreasury111111111111111";
const TEST_XRP = ethers.encodeBytes32String("testXRP");

function revenueProof(revenueCents: number, index: number) {
    const abiEncodedData = coder.encode(
        [DTO_TYPE],
        [["stripe", REF, revenueCents, JAN + index * MONTH, JAN + (index + 1) * MONTH, 0, 0]]
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

function paymentProof(drops: bigint, reference: string, transactionId = ethers.id("xrpl-pool-1")) {
    return {
        merkleProof: [],
        data: {
            attestationType: ethers.encodeBytes32String("Payment"),
            sourceId: TEST_XRP,
            votingRound: 1,
            lowestUsedTimestamp: 0,
            requestBody: { transactionId, inUtxo: 0, utxo: 0 },
            responseBody: {
                blockNumber: 1,
                blockTimestamp: JAN,
                sourceAddressHash: ethers.id("rBorrower"),
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
    const [owner, lp, borrower] = await ethers.getSigners();

    const Oracle = await ethers.getContractFactory("RevenueOracleHarness");
    const oracle = await Oracle.deploy();
    const Token = await ethers.getContractFactory("MockFXRP");
    const fxrp = await Token.deploy();
    const Manager = await ethers.getContractFactory("AdvanceManagerHarness");
    const manager = await Manager.deploy(await oracle.getAddress(), await fxrp.getAddress());
    await manager.setXrpUsd(XRP_USD, PRICE_DECIMALS);
        // These suites test the core mechanics; Phase A features have their own suite.
        await manager.setReserveTerms(0, 1);
        await manager.setFeeSplit(0, 0);
    await manager.setFactorSchedule(10_000, 0, 10_000, 0); // flat 1.0x: these tests are about the pool

    const Pool = await ethers.getContractFactory("LenderPool");
    const pool = await Pool.deploy(await fxrp.getAddress());
    await pool.setManager(await manager.getAddress());
    await manager.setPool(await pool.getAddress());

    // The LP funds the pool with 1,000 FXRP.
    await fxrp.mint(lp.address, FXRP(1_000));
    await fxrp.connect(lp).approve(await pool.getAddress(), FXRP(1_000));
    await pool.connect(lp).deposit(FXRP(1_000), lp.address);

    // The borrower has three proven months of $4,000.
    const accountId = await oracle.accountIdFor("stripe", REF);
    for (let i = 0; i < 3; i++) {
        await oracle.connect(borrower).submitAttestation(accountId, revenueProof(400_000, i));
    }

    return { owner, lp, borrower, oracle, fxrp, manager, pool, accountId };
}

/** The LP's claim in FXRP, at the current share price. */
async function lpAssets(pool: Awaited<ReturnType<typeof setup>>["pool"], lp: { address: string }) {
    return pool.convertToAssets(await pool.balanceOf(lp.address));
}

describe("LenderPool", () => {
    describe("shares", () => {
        it("a deposit is worth what was deposited", async () => {
            const { pool, lp } = await setup();
            expect(await lpAssets(pool, lp)).to.be.closeTo(FXRP(1_000), 2n);
            expect(await pool.totalAssets()).to.equal(FXRP(1_000));
        });

        it("withdrawal round-trips when nothing is lent", async () => {
            const { pool, fxrp, lp } = await setup();
            await pool.connect(lp).withdraw(FXRP(1_000) - 1n, lp.address, lp.address);
            expect(await fxrp.balanceOf(lp.address)).to.be.closeTo(FXRP(1_000), 2n);
        });
    });

    describe("lending discipline", () => {
        it("only the manager can lend", async () => {
            const { pool, owner } = await setup();
            await expect(pool.connect(owner).lend(owner.address, 1n))
                .to.be.revertedWithCustomError(pool, "NotManager")
                .withArgs(owner.address);
        });

        it("refuses to lend past the utilisation cap", async () => {
            const { pool, manager, borrower, accountId } = await setup();
            // 80% of 1,000 FXRP is 800: an $800 advance fits exactly, $801 does not.
            expect(await pool.availableToLend()).to.equal(FXRP(800));
            await manager.connect(borrower).requestAdvance(accountId, 80_000);
            expect(await pool.lentFxrp()).to.equal(FXRP(800));
            expect(await pool.availableToLend()).to.equal(0n);

            await expect(
                manager.connect(borrower).requestAdvance(accountId, 1)
            ).to.be.revertedWithCustomError(manager, "AdvanceAlreadyOpen");
        });

        it("admits illiquidity: maxWithdraw is idle liquidity, not the paper total", async () => {
            const { pool, manager, borrower, lp, accountId } = await setup();
            await manager.connect(borrower).requestAdvance(accountId, 60_000); // 600 FXRP out

            expect(await pool.totalAssets()).to.equal(FXRP(1_000)); // lent is still an asset
            expect(await pool.maxWithdraw(lp.address)).to.equal(FXRP(400)); // but only idle can leave

            await expect(
                pool.connect(lp).withdraw(FXRP(401), lp.address, lp.address)
            ).to.be.revertedWithCustomError(pool, "ERC4626ExceededMaxWithdraw");
            await expect(pool.connect(lp).withdraw(FXRP(400), lp.address, lp.address)).to.not.be.reverted;
        });
    });

    describe("the share price tells the truth", () => {
        it("yield from a repaid advance raises it", async () => {
            const { pool, manager, fxrp, borrower, lp, accountId } = await setup();
            const before = await lpAssets(pool, lp);

            await manager.connect(borrower).requestAdvance(accountId, 10_000); // $100 out
            const a = await manager.advanceOf(accountId);

            await fxrp.mint(borrower.address, FXRP(200));
            await fxrp.connect(borrower).approve(await manager.getAddress(), FXRP(200));
            await manager.connect(borrower).repay(accountId, a.outstandingCents); // $105 back

            // 100 FXRP left, 105 returned: the pool gained the $5 fee.
            expect(await pool.lentFxrp()).to.equal(0n);
            expect(await pool.totalAssets()).to.equal(FXRP(1_005));
            expect(await lpAssets(pool, lp)).to.be.gt(before);
        });

        it("a write-off lowers it, for every share at once", async () => {
            const { pool, manager, borrower, lp, owner, accountId } = await setup();
            await manager.connect(borrower).requestAdvance(accountId, 10_000); // $100 out

            await time.increase(46 * 24 * 60 * 60);
            await manager.markDelinquent(accountId);
            await time.increase(46 * 24 * 60 * 60);
            await manager.connect(owner).writeOff(accountId);

            // The 100 FXRP is gone and the books say so.
            expect(await pool.lentFxrp()).to.equal(0n);
            expect(await pool.totalAssets()).to.equal(FXRP(900));
            expect(await lpAssets(pool, lp)).to.be.closeTo(FXRP(900), 2n);
            expect((await manager.advanceOf(accountId)).open).to.equal(false);
        });

        it("a write-off needs delinquency plus a second grace period, and the owner", async () => {
            const { manager, borrower, owner, accountId } = await setup();
            await manager.connect(borrower).requestAdvance(accountId, 10_000);

            await expect(manager.connect(owner).writeOff(accountId)).to.be.revertedWithCustomError(
                manager,
                "NotDelinquent"
            );

            await time.increase(46 * 24 * 60 * 60);
            await manager.markDelinquent(accountId);
            await expect(manager.connect(owner).writeOff(accountId)).to.be.revertedWithCustomError(
                manager,
                "GracePeriodNotElapsed"
            );

            await time.increase(46 * 24 * 60 * 60);
            await expect(manager.connect(borrower).writeOff(accountId)).to.be.revertedWithCustomError(
                manager,
                "NotDelegateOrOwner"
            );
            await expect(manager.connect(owner).writeOff(accountId)).to.not.be.reverted;
        });

        it("an XRPL repayment books a receivable, and settling it delivers the FXRP", async () => {
            const { pool, manager, fxrp, borrower, owner, accountId } = await setup();
            const Am = await ethers.getContractFactory("MockAssetManager");
            const am = await Am.deploy(await fxrp.getAddress(), FXRP(10));
            await manager.setAssetManager(await am.getAddress());
            await manager.setXrplTreasury(XRPL_TREASURY, TEST_XRP);

            // One lot out to the XRP Ledger: 10 FXRP lent, $10.50 owed at $1/XRP.
            await manager.connect(borrower).requestAdvanceToXrpl(accountId, 1, "rBorrower");
            expect(await pool.lentFxrp()).to.equal(FXRP(10));

            // Repaid exactly from the XRP Ledger. The XRP is real and attested; it just is not here yet.
            const a = await manager.advanceOf(accountId);
            const drops = (a.outstandingCents * 1_000_000n) / 100n; // $10.50 -> 10.5 XRP
            await manager.repayFromXrpl(accountId, paymentProof(drops, accountId));

            expect((await manager.advanceOf(accountId)).open).to.equal(false);
            expect(await pool.lentFxrp()).to.equal(0n);
            expect(await pool.xrplReceivableFxrp()).to.equal(drops);
            // No dip: the claim is stated as an asset. 990 idle + 10.5 receivable, the 0.5 is fee yield.
            expect(await pool.totalAssets()).to.equal(FXRP(1_000.5));

            // The operator re-mints and settles: receivable becomes balance, totals unchanged.
            await fxrp.mint(owner.address, drops);
            await fxrp.connect(owner).approve(await pool.getAddress(), drops);
            await pool.connect(owner).settleReceivable(drops);
            expect(await pool.xrplReceivableFxrp()).to.equal(0n);
            expect(await pool.totalAssets()).to.equal(FXRP(1_000.5));
        });

        it("an impaired receivable consumes the junior buffer before the share price", async () => {
            const { pool, manager, fxrp, borrower, owner, lp, accountId } = await setup();
            const Am = await ethers.getContractFactory("MockAssetManager");
            const am = await Am.deploy(await fxrp.getAddress(), FXRP(10));
            await manager.setAssetManager(await am.getAddress());
            await manager.setXrplTreasury(XRPL_TREASURY, TEST_XRP);

            // A 5 FXRP junior buffer under the LPs.
            await fxrp.mint(owner.address, FXRP(5));
            await fxrp.connect(owner).approve(await pool.getAddress(), FXRP(5));
            await pool.connect(owner).fundJunior(FXRP(5));

            await manager.connect(borrower).requestAdvanceToXrpl(accountId, 1, "rBorrower");
            const a = await manager.advanceOf(accountId);
            const drops = (a.outstandingCents * 1_000_000n) / 100n;
            await manager.repayFromXrpl(accountId, paymentProof(drops, accountId));

            const before = await pool.totalAssets();

            // The operator never delivers. Governance admits it: junior eats 5, seniors only the rest.
            await pool.connect(owner).impairReceivable(drops);
            expect(await pool.xrplReceivableFxrp()).to.equal(0n);
            expect(await pool.juniorAssets()).to.equal(0n);
            expect(before - (await pool.totalAssets())).to.equal(drops - FXRP(5));
            void lp;
        });
    });

    describe("the junior tranche", () => {
        it("a write-off inside the buffer leaves senior LPs whole", async () => {
            const { pool, manager, fxrp, borrower, owner, lp, accountId } = await setup();

            await fxrp.mint(owner.address, FXRP(200));
            await fxrp.connect(owner).approve(await pool.getAddress(), FXRP(200));
            await pool.connect(owner).fundJunior(FXRP(200));

            const seniorBefore = await pool.totalAssets();
            expect(seniorBefore).to.equal(FXRP(1_000)); // junior backs losses, not shares

            await manager.connect(borrower).requestAdvance(accountId, 10_000); // $100 out
            await time.increase(46 * 24 * 60 * 60);
            await manager.markDelinquent(accountId);
            await time.increase(46 * 24 * 60 * 60);
            await manager.connect(owner).writeOff(accountId);

            // 100 FXRP lost, all absorbed: seniors see the same total; the buffer shows the wound.
            expect(await pool.totalAssets()).to.equal(FXRP(1_000));
            expect(await pool.juniorAssets()).to.equal(FXRP(100));
            expect(await pool.convertToAssets(await pool.balanceOf(lp.address))).to.be.closeTo(FXRP(1_000), 2n);
        });

        it("a loss beyond the buffer passes the remainder to the share price", async () => {
            const { pool, manager, fxrp, borrower, owner, accountId } = await setup();

            await fxrp.mint(owner.address, FXRP(30));
            await fxrp.connect(owner).approve(await pool.getAddress(), FXRP(30));
            await pool.connect(owner).fundJunior(FXRP(30));

            await manager.connect(borrower).requestAdvance(accountId, 10_000); // 100 FXRP out
            await time.increase(46 * 24 * 60 * 60);
            await manager.markDelinquent(accountId);
            await time.increase(46 * 24 * 60 * 60);
            await manager.connect(owner).writeOff(accountId);

            // Junior ate 30; seniors ate the remaining 70.
            expect(await pool.juniorAssets()).to.equal(0n);
            expect(await pool.totalAssets()).to.equal(FXRP(930));
        });

        it("LP withdrawals cannot touch the junior buffer", async () => {
            const { pool, fxrp, owner, lp } = await setup();

            await fxrp.mint(owner.address, FXRP(50));
            await fxrp.connect(owner).approve(await pool.getAddress(), FXRP(50));
            await pool.connect(owner).fundJunior(FXRP(50));

            // Idle is 1,050 but 50 of it is the buffer: LPs can take at most their 1,000.
            expect(await pool.maxWithdraw(lp.address)).to.be.closeTo(FXRP(1_000), 2n);
        });

        it("only the owner thins the buffer, and never below what is idle", async () => {
            const { pool, fxrp, owner, lp } = await setup();
            await fxrp.mint(owner.address, FXRP(10));
            await fxrp.connect(owner).approve(await pool.getAddress(), FXRP(10));
            await pool.connect(owner).fundJunior(FXRP(10));

            await expect(pool.connect(lp).withdrawJunior(FXRP(1))).to.be.revertedWithCustomError(
                pool,
                "OwnableUnauthorizedAccount"
            );
            await expect(pool.connect(owner).withdrawJunior(FXRP(11)))
                .to.be.revertedWithCustomError(pool, "ExceedsJunior")
                .withArgs(FXRP(11), FXRP(10));
            await expect(pool.connect(owner).withdrawJunior(FXRP(10))).to.not.be.reverted;
        });
    });

    describe("pause", () => {
        it("stops originations and nothing else", async () => {
            const { pool, manager, fxrp, borrower, owner, accountId } = await setup();
            await manager.connect(borrower).requestAdvance(accountId, 10_000);

            await manager.connect(owner).pause();
            // no second advance while paused (also blocked by the open one, so use the error to prove order)
            await expect(
                manager.connect(borrower).requestAdvance(accountId, 1_000)
            ).to.be.revertedWithCustomError(manager, "EnforcedPause");

            // ...but repayment flows.
            const a = await manager.advanceOf(accountId);
            await fxrp.mint(borrower.address, FXRP(200));
            await fxrp.connect(borrower).approve(await manager.getAddress(), FXRP(200));
            await expect(manager.connect(borrower).repay(accountId, a.outstandingCents)).to.not.be.reverted;

            await manager.connect(owner).unpause();
            await expect(manager.connect(borrower).requestAdvance(accountId, 1_000)).to.not.be.reverted;
        });
    });

    describe("one funding source at a time", () => {
        it("treasury deposits refuse to run in pool mode", async () => {
            const { manager, fxrp, owner } = await setup();
            await fxrp.mint(owner.address, FXRP(10));
            await fxrp.approve(await manager.getAddress(), FXRP(10));
            await expect(manager.depositTreasury(FXRP(10))).to.be.revertedWithCustomError(
                manager,
                "TreasuryModeDisabled"
            );
        });

        it("a pool cannot be attached while the owner treasury holds funds", async () => {
            const [owner] = await ethers.getSigners();
            const Oracle = await ethers.getContractFactory("RevenueOracleHarness");
            const oracle = await Oracle.deploy();
            const Token = await ethers.getContractFactory("MockFXRP");
            const fxrp = await Token.deploy();
            const Manager = await ethers.getContractFactory("AdvanceManagerHarness");
            const manager = await Manager.deploy(await oracle.getAddress(), await fxrp.getAddress());

            await fxrp.mint(owner.address, FXRP(10));
            await fxrp.approve(await manager.getAddress(), FXRP(10));
            await manager.depositTreasury(FXRP(10));

            const Pool = await ethers.getContractFactory("LenderPool");
            const pool = await Pool.deploy(await fxrp.getAddress());
            await expect(manager.setPool(await pool.getAddress())).to.be.revertedWithCustomError(
                manager,
                "TreasuryModeDisabled"
            );
        });
    });
});
