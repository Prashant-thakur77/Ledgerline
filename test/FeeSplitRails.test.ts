import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * Which rails split, pinned as design.
 *
 * The fee split is an FXRP-rail mechanism: it divides money that actually arrives at the manager.
 * An XRPL-side repayment's value lands off-pool — the pool books a receivable, and no FXRP passes
 * through the manager to divide — so the junior buffer and keeper reserve take no cut on that rail.
 * That is a deliberate asymmetry, not an oversight: splitting a claim would credit the keeper ledger
 * with money the contract does not hold, and the manager's balance must always cover its ledgers.
 * This suite exists so a future change that silently alters the asymmetry has to say so.
 */

const DTO_TYPE = "tuple(string platform,string accountRef,uint256 revenueCents,uint256 periodStart,uint256 periodEnd,uint256 refundCents,uint256 disputeCount)";
const coder = AbiCoder.defaultAbiCoder();

const DAY = 24 * 60 * 60;
const MONTH = 30 * DAY;
const JAN = 1767225600;
const DROPS = 1_000_000n;
const XRP_USD = 1_000_000n; // $1: cents and micro-FXRP coincide
const PRICE_DECIMALS = 6;
const REF = "acct_1SplitRails";
const XRPL_TREASURY = "rSplitRails11111111111111111";
const TEST_XRP = ethers.encodeBytes32String("testXRP");

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

let txn = 0;
function paymentProof(drops: bigint, reference: string) {
    return {
        merkleProof: [],
        data: {
            attestationType: ethers.encodeBytes32String("Payment"),
            sourceId: TEST_XRP,
            votingRound: 1,
            lowestUsedTimestamp: 0,
            requestBody: { transactionId: ethers.id(`split-rails-${txn++}`), inUtxo: 0, utxo: 0 },
            responseBody: {
                blockNumber: 1,
                blockTimestamp: JAN,
                sourceAddressHash: ethers.id("rPayer"),
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
    const [, borrower, lp] = await ethers.getSigners();

    const Oracle = await ethers.getContractFactory("RevenueOracleHarness");
    const oracle = await Oracle.deploy();
    const Token = await ethers.getContractFactory("MockFXRP");
    const fxrp = await Token.deploy();
    const Manager = await ethers.getContractFactory("AdvanceManagerHarness");
    const manager = await Manager.deploy(await oracle.getAddress(), await fxrp.getAddress());
    await manager.setXrpUsd(XRP_USD, PRICE_DECIMALS);
    await manager.setFactorSchedule(10_000, 0, 10_000, 0);
    await manager.setReserveTerms(0, 1);
    await manager.setXrplTreasury(XRPL_TREASURY, TEST_XRP);

    const Pool = await ethers.getContractFactory("LenderPool");
    const pool = await Pool.deploy(await fxrp.getAddress());
    await pool.setManager(await manager.getAddress());
    await manager.setPool(await pool.getAddress());
    await fxrp.mint(lp.address, 100_000_000_000n);
    await fxrp.connect(lp).approve(await pool.getAddress(), 100_000_000_000n);
    await pool.connect(lp).deposit(100_000_000_000n, lp.address);

    await fxrp.mint(borrower.address, 100_000_000_000n);
    await fxrp.connect(borrower).approve(await manager.getAddress(), 100_000_000_000n);

    const accountId = await oracle.accountIdFor("stripe", REF);
    const now = await time.latest();
    const end = now - 121 * DAY;
    await oracle.connect(borrower).submitAttestation(accountId, revenueProof(400_000, end - MONTH, end));

    return { borrower, oracle, fxrp, manager, pool, accountId };
}

describe("The fee split and the two rails", () => {
    it("the XRPL rail books the whole payment as a receivable and splits nothing", async () => {
        const { borrower, manager, pool, accountId } = await setup();
        await manager.connect(borrower).requestAdvance(accountId, 100_000n); // owes $1,050

        const receivableBefore = await pool.xrplReceivableFxrp();
        await manager.repayFromXrpl(accountId, paymentProof(1_050n * DROPS, accountId));

        // Debt closed, the full value is the pool's claim, and no cut was carved from a claim.
        expect((await manager.advanceOf(accountId)).open).to.equal(false);
        expect((await pool.xrplReceivableFxrp()) - receivableBefore).to.equal(1_050n * DROPS);
        expect(await pool.juniorAssets()).to.equal(0n);
        expect(await manager.keeperReserveFxrp()).to.equal(0n);
    });

    it("the same debt repaid over both rails splits only the FXRP-rail share of the fee", async () => {
        const { borrower, manager, pool, accountId } = await setup();
        await manager.connect(borrower).requestAdvance(accountId, 100_000n); // $50 fee inside $1,050

        // Half the debt arrives as XRP, half as FXRP.
        await manager.repayFromXrpl(accountId, paymentProof(525n * DROPS, accountId));
        await manager.connect(borrower).repay(accountId, 52_500n);

        // The FXRP rail moved $525, carrying $25 of fee content: junior 20% = $5, keeper 10% = $2.50.
        expect(await pool.juniorAssets()).to.equal(5_000_000n);
        expect(await manager.keeperReserveFxrp()).to.equal(2_500_000n);
        expect((await manager.advanceOf(accountId)).open).to.equal(false);
    });
});
