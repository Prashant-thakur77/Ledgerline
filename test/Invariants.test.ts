import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Phase 6: the invariants, held under fire.
 *
 * A seeded pseudo-random walk over every money path in pool mode — advances, partial and full FXRP
 * repayments, XRPL repayments with overpayment, credit consumption, delinquency and write-off — with the
 * books checked after every single step. The seed is fixed, so a failure replays exactly. A write-off
 * ends one account's story, not the walk: a fresh account rotates in and the pool-level invariants
 * carry straight across, the way a real book outlives any one borrower.
 *
 * The V6 walk also carries refunds: attested periods sometimes refund at warn level (the share steps up)
 * or freeze level (origination must revert), revenue-share application runs against a JS mirror of the
 * step-up arithmetic, and reserves release when the predicate allows.
 *
 * The invariants, stated once and asserted ~250 times:
 *   I1  a closed advance owes nothing:  !open ⇒ outstanding == 0
 *   I2  the pool's books balance:       totalAssets == idle balance + lentFxrp
 *   I3  lending is per-advance honest:  lentFxrp == fxrpDisbursed − fxrpRetired of the one open advance
 *   I4  debt only moves as designed:    outstanding never exceeds principal + fee
 *   I5  the share price never falls except where the design says it must — a write-off, or an XRPL-side
 *       settlement whose value lands off-pool
 *   I6  the manager strands nothing:    its FXRP balance == keeper reserve + escrowed rolling reserve
 */

const DTO_TYPE = "tuple(string platform,string accountRef,uint256 revenueCents,uint256 periodStart,uint256 periodEnd,uint256 refundCents,uint256 disputeCount)";
const coder = AbiCoder.defaultAbiCoder();

const MONTH = 30 * 24 * 60 * 60;
const JAN = 1767225600;
const DROPS = 1_000_000n;
const XRP_USD = 1_000_000n; // $1: cents and micro-FXRP coincide, so the mirror stays readable
const PRICE_DECIMALS = 6;
const REF = "acct_1WalkTest";
const XRPL_TREASURY = "rWalkTreasury111111111111111";
const TEST_XRP = ethers.encodeBytes32String("testXRP");

/** Deterministic PRNG (LCG) — the walk must replay identically or a failure is unactionable. */
function makeRng(seed: number) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

function revenueProof(ref: string, revenueCents: number, periodStart: number, periodEnd: number, refundCents = 0) {
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
            requestBody: { url: "", httpMethod: "GET", headers: "{}", queryParams: "{}", body: "{}", postProcessJq: "{}", abiSignature: "{}" },
            responseBody: { abiEncodedData },
        },
    };
}

let walkTx = 0;
function paymentProof(drops: bigint, reference: string) {
    return {
        merkleProof: [],
        data: {
            attestationType: ethers.encodeBytes32String("Payment"),
            sourceId: TEST_XRP,
            votingRound: 1,
            lowestUsedTimestamp: 0,
            requestBody: { transactionId: ethers.id(`walk-${walkTx++}`), inUtxo: 0, utxo: 0 },
            responseBody: {
                blockNumber: 1,
                blockTimestamp: JAN,
                sourceAddressHash: ethers.id("rWalker"),
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

describe("Invariants under a random walk", () => {
    it("holds I1–I6 across ~250 randomised money operations (seed 0xF1A4E)", async function () {
        this.timeout(120_000);

        const [owner, lp, borrower] = await ethers.getSigners();
        const rng = makeRng(0xf1a4e);

        const Oracle = await ethers.getContractFactory("RevenueOracleHarness");
        const oracle = await Oracle.deploy();
        const Token = await ethers.getContractFactory("MockFXRP");
        const fxrp = await Token.deploy();
        const Manager = await ethers.getContractFactory("AdvanceManagerHarness");
        const manager = await Manager.deploy(await oracle.getAddress(), await fxrp.getAddress());
        await manager.setXrpUsd(XRP_USD, PRICE_DECIMALS);
        await manager.setFactorSchedule(10_000, 0, 10_000, 0);
        await manager.setXrplTreasury(XRPL_TREASURY, TEST_XRP);

        const Pool = await ethers.getContractFactory("LenderPool");
        const pool = await Pool.deploy(await fxrp.getAddress());
        await pool.setManager(await manager.getAddress());
        await manager.setPool(await pool.getAddress());

        await fxrp.mint(lp.address, 10_000_000_000n); // 10,000 FXRP
        await fxrp.connect(lp).approve(await pool.getAddress(), 10_000_000_000n);
        await pool.connect(lp).deposit(10_000_000_000n, lp.address);

        await fxrp.mint(borrower.address, 100_000_000_000n);
        await fxrp.connect(borrower).approve(await manager.getAddress(), 100_000_000_000n);

        let ref = REF;
        let accountId = await oracle.accountIdFor("stripe", ref);
        let generation = 0;
        let periodEnd = JAN + MONTH;
        await oracle.connect(borrower).submitAttestation(accountId, revenueProof(ref, 400_000, JAN, periodEnd));

        const poolAddr = await pool.getAddress();
        const managerAddr = await manager.getAddress();
        const warnBps = await manager.refundWarnBps();
        const freezeBps = await manager.refundFreezeBps();
        const shareBps = await manager.repaymentShareBps();

        let expectDip = false; // set by ops whose value lands off-pool, consumed by the price check
        let juniorMayShrink = false; // only a write-off consumes the buffer
        let latestRatioBps = 0n; // the JS mirror of refundRatioBps, computed from what we attested
        let lastJunior = 0n;
        let lastPrice = 0n;

        async function assertInvariants(tag: string) {
            const a = await manager.advanceOf(accountId);

            // I1 — a closed advance owes nothing.
            if (!a.open) expect(a.outstandingCents, `I1 @ ${tag}`).to.equal(0n);

            // I4 — debt never exceeds what was owed at origination.
            expect(a.outstandingCents, `I4 @ ${tag}`).to.be.lte(a.principalCents + a.feeCents);

            // I2 — the pool's books balance to its actual holdings: idle plus lent plus the attested
            // XRPL receivable, minus the junior buffer.
            const idle = await fxrp.balanceOf(poolAddr);
            const lent = await pool.lentFxrp();
            const receivable = await pool.xrplReceivableFxrp();
            const junior = await pool.juniorAssets();
            // V6: the fee split feeds the junior buffer on every repayment; only a write-off may eat it.
            if (!juniorMayShrink) expect(junior, `junior never shrinks @ ${tag}`).to.be.gte(lastJunior);
            lastJunior = junior;
            juniorMayShrink = false;
            expect(await pool.totalAssets(), `I2 @ ${tag}`).to.equal(idle + lent + receivable - junior);

            // I3 — what the pool says is out equals what the one advance has not yet retired.
            const retired = await manager.fxrpRetired(accountId);
            const expectedLent = a.open ? a.fxrpDisbursed - retired : 0n;
            expect(lent, `I3 @ ${tag}`).to.equal(expectedLent);

            // I5 — the share price only falls where the design says it must.
            const supply = await pool.totalSupply();
            const price = supply === 0n ? 0n : ((idle + lent + receivable - junior) * 10n ** 18n) / supply;
            if (lastPrice !== 0n && !expectDip) {
                expect(price, `I5 @ ${tag}`).to.be.gte(lastPrice);
            }
            lastPrice = price;
            expectDip = false;

            // I6 — the manager strands nothing: every FXRP it holds is on a named ledger. With
            // account rotation, that means the keeper reserve plus EVERY generation's escrow, since
            // a retired account's reserve is still someone's money until it is released.
            let escrowed = 0n;
            for (let g = 0; g <= generation; g++) {
                const id = await oracle.accountIdFor("stripe", g === 0 ? REF : `${REF}-${g}`);
                escrowed += await manager.reserveFxrp(id);
            }
            expect(await fxrp.balanceOf(managerAddr), `I6 @ ${tag}`).to.equal(
                (await manager.keeperReserveFxrp()) + escrowed
            );
        }

        await assertInvariants("start");

        /** Attest the next month; sometimes refund-heavy, so the covenants fire mid-walk. */
        async function attestNext(refundCents: number) {
            const net = 400_000 - refundCents;
            const start = periodEnd;
            periodEnd = start + MONTH;
            await oracle.connect(borrower).submitAttestation(accountId, revenueProof(ref, net, start, periodEnd, refundCents));
            latestRatioBps = (BigInt(refundCents) * 10_000n) / 400_000n;
        }

        for (let step = 0; step < 250; step++) {
            const a = await manager.advanceOf(accountId);
            const roll = rng();
            const tag = `step ${step}`;


            if (!a.open && roll < 0.4) {
                // Open an advance for a random slice of the limit, if the account is still allowed one.
                if (a.delinquent) {
                    // Walk ends for this account's borrowing; keep exercising credit instead.
                    await manager.repayFromXrpl(accountId, paymentProof(BigInt(1 + Math.floor(rng() * 20)) * DROPS, accountId));
                    expectDip = false; // pure credit, no retire
                } else if (latestRatioBps >= freezeBps) {
                    // The freeze covenant must hold mid-walk: a hot latest month means no new money.
                    await expect(
                        manager.connect(borrower).requestAdvance(accountId, 1_000n),
                        `freeze @ ${tag}`
                    ).to.be.revertedWithCustomError(manager, "ExcessiveRefunds");
                } else {
                    const limit = await manager.advanceLimitCents(accountId);
                    const cents = 1n + BigInt(Math.floor(rng() * Number(limit - 1n)));
                    // Deep walks legitimately drain idle liquidity into receivables and write-offs;
                    // an origination the pool cannot fund must say so, not underwrite thin air.
                    if (cents * 10_000n > (await manager.availableFunds())) {
                        await expect(
                            manager.connect(borrower).requestAdvance(accountId, cents),
                            `illiquid @ ${tag}`
                        ).to.be.revertedWithCustomError(manager, "InsufficientTreasury");
                    } else {
                        await manager.connect(borrower).requestAdvance(accountId, cents);
                        await time.increase(3600); // spread originations across velocity epochs
                        // Banked credit may settle part or all of it at origination, off-pool.
                        if ((await manager.creditCents(accountId)) >= 0n) expectDip = true;
                    }
                }
            } else if (!a.open && !a.delinquent && roll < 0.5 && (await manager.reserveFxrp(accountId)) > 0n) {
                // A closed-clean reserve goes home, straight from manager escrow — the pool untouched.
                const reserve = await manager.reserveFxrp(accountId);
                const before = await fxrp.balanceOf(borrower.address);
                await manager.releaseReserve(accountId);
                expect((await fxrp.balanceOf(borrower.address)) - before, `release @ ${tag}`).to.equal(reserve);
            } else if (a.open && roll < 0.3) {
                // Partial or full FXRP repayment — inflow ≥ retired at $1, so never a dip.
                const cents = rng() < 0.3 ? a.outstandingCents : 1n + BigInt(Math.floor(rng() * Number(a.outstandingCents)));
                await manager.connect(borrower).repay(accountId, cents);
            } else if (a.open && !a.delinquent && roll < 0.42) {
                // Revenue-share application, checked against a JS mirror of the step-up arithmetic.
                const latest = await oracle.latestRevenue(accountId);
                if (latest.periodEnd > a.lastAppliedPeriodEnd) {
                    let eff = shareBps;
                    if (latestRatioBps >= warnBps) {
                        eff = (eff * 3n) / 2n;
                        if (eff > 10_000n) eff = 10_000n;
                    }
                    let expected = (latest.revenueCents * eff) / 10_000n;
                    if (expected > a.outstandingCents) expected = a.outstandingCents;
                    await manager.applyRevenueRepayment(accountId);
                    const after = await manager.advanceOf(accountId);
                    expect(a.outstandingCents - after.outstandingCents, `share mirror @ ${tag}`).to.equal(expected);
                } else {
                    await attestNext(0); // nothing fresh to apply; give it a month to apply next time
                }
            } else if (a.open && roll < 0.6) {
                // XRPL repayment, sometimes overpaying — value lands off-pool, a dip is designed in.
                const owedXrp = Number(a.outstandingCents / 100n) + 1;
                const xrp = 1 + Math.floor(rng() * owedXrp * 1.4);
                await manager.repayFromXrpl(accountId, paymentProof(BigInt(xrp) * DROPS, accountId));
                // The receivable keeps the price whole now — the dip moved to credit application.
            } else if (a.open && !a.delinquent && roll < 0.65) {
                // Let it rot: grace period passes, delinquency lands, sometimes the write-off too.
                await time.increase(46 * 24 * 60 * 60);
                await manager.markDelinquent(accountId);
                // The tip-farming attack, attempted at every delinquency: both triggers stay true
                // on a marked advance, so only the guard keeps a second mark from paying again.
                await expect(manager.markDelinquent(accountId), `re-mark @ ${tag}`)
                    .to.be.revertedWithCustomError(manager, "AccountDelinquent");
                if (rng() < 0.5) {
                    await time.increase(46 * 24 * 60 * 60);
                    await manager.connect(owner).writeOff(accountId);
                    expectDip = true;
                    juniorMayShrink = true; // absorbing exactly this is what the buffer is for
                }
            } else {
                // A fresh attested period: mostly clean, sometimes warn-level, sometimes freeze-level.
                const r = rng();
                await attestNext(r < 0.7 ? 0 : r < 0.9 ? 8_000 : 10_000);
            }

            await assertInvariants(tag);

            // Delinquency is terminal for the account, not for the walk: rotate a fresh account in
            // and keep going. Pool-level trackers (junior, price, I2) continue across generations.
            const after = await manager.advanceOf(accountId);
            if (after.delinquent && !after.open) {
                generation += 1;
                ref = `${REF}-${generation}`;
                accountId = await oracle.accountIdFor("stripe", ref);
                periodEnd = JAN + MONTH;
                latestRatioBps = 0n;
                await oracle.connect(borrower).submitAttestation(accountId, revenueProof(ref, 400_000, JAN, periodEnd));
            }
        }

        // However the walk ended, the books must balance and the pool must still honour withdrawals.
        const idle = await fxrp.balanceOf(poolAddr);
        expect(await pool.totalAssets()).to.equal(
            idle + (await pool.lentFxrp()) + (await pool.xrplReceivableFxrp()) - (await pool.juniorAssets())
        );
        const out = await pool.maxWithdraw(lp.address);
        if (out > 0n) await pool.connect(lp).withdraw(out, lp.address, lp.address);
    });
});
