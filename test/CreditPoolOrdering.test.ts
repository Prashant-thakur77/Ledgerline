import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";

/**
 * Two ways credit and the pool can disagree about reality.
 *
 * Credit is banked from XRPL overpayments and settles a future advance at origination. Both paths below
 * move real FXRP out of the pool, so both have to leave the pool's books able to explain where it went.
 */

const DTO_TYPE = "tuple(string platform,string accountRef,uint256 revenueCents,uint256 periodStart,uint256 periodEnd,uint256 refundCents,uint256 disputeCount)";
const coder = AbiCoder.defaultAbiCoder();

const MONTH = 30 * 24 * 60 * 60;
const JAN = 1767225600;
const DROPS = 1_000_000n;
const XRP_USD = 1_000_000n; // $1 — cents and micro-FXRP line up, so the arithmetic stays readable
const PRICE_DECIMALS = 6;
const REF = "acct_1CreditOrder";
const XRPL_TREASURY = "rCreditTreasury1111111111111";
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
            requestBody: { transactionId: ethers.id(`credit-order-${txn++}`), inUtxo: 0, utxo: 0 },
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
    const [owner, lp, borrower] = await ethers.getSigners();

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

    await fxrp.mint(lp.address, 10_000_000_000n);
    await fxrp.connect(lp).approve(await pool.getAddress(), 10_000_000_000n);
    await pool.connect(lp).deposit(10_000_000_000n, lp.address);

    await fxrp.mint(borrower.address, 100_000_000_000n);
    await fxrp.connect(borrower).approve(await manager.getAddress(), 100_000_000_000n);

    const accountId = await oracle.accountIdFor("stripe", REF);
    await oracle.connect(borrower).submitAttestation(accountId, revenueProof(400_000, JAN, JAN + MONTH));

    return { owner, lp, borrower, oracle, fxrp, manager, pool, accountId };
}

describe("Credit, the pool, and where the FXRP actually went", () => {
    it("an advance closed entirely by credit still leaves the pool's books balanced", async () => {
        const { borrower, fxrp, manager, pool, accountId } = await setup();
        const poolAddr = await pool.getAddress();

        // Bank credit with no advance open: $300 of XRP arrives for this account.
        await manager.repayFromXrpl(accountId, paymentProof(300n * DROPS, accountId));
        expect(await manager.creditCents(accountId)).to.equal(30_000n);

        const idleBefore = await fxrp.balanceOf(poolAddr);
        const assetsBefore = await pool.totalAssets();

        // A $100 advance ($105 owed) opens and is instantly closed by the banked credit — but the FXRP
        // still leaves the pool and reaches the borrower.
        await manager.connect(borrower).requestAdvance(accountId, 10_000n);

        const advance = await manager.advanceOf(accountId);
        expect(advance.open, "advance closed by credit").to.equal(false);
        expect(advance.outstandingCents).to.equal(0n);

        const idleAfter = await fxrp.balanceOf(poolAddr);
        expect(idleBefore - idleAfter, "FXRP really left the pool").to.equal(advance.fxrpDisbursed);

        // The books must still add up: lent principal is only meaningful while an advance is open.
        const lent = await pool.lentFxrp();
        const retired = await manager.fxrpRetired(accountId);
        expect(lent, "nothing is still out on a closed advance").to.equal(
            advance.open ? advance.fxrpDisbursed - retired : 0n
        );

        // And totalAssets must not have grown out of thin air.
        expect(await pool.totalAssets(), "no phantom assets").to.be.lte(assetsBefore);
    });

    it("XRP that arrives with no advance open is still booked as the pool's claim", async () => {
        const { manager, pool, accountId } = await setup();

        const receivableBefore = await pool.xrplReceivableFxrp();

        // $300 of real XRP lands in the operator's XRPL treasury with nothing outstanding.
        await manager.repayFromXrpl(accountId, paymentProof(300n * DROPS, accountId));
        expect(await manager.creditCents(accountId)).to.equal(30_000n);

        // That XRP is the pool's — it is what will fund the advance this credit later opens. If it is not
        // booked, the credit spends money the pool never received.
        expect(
            (await pool.xrplReceivableFxrp()) - receivableBefore,
            "the XRP is booked as a receivable"
        ).to.equal(300n * DROPS);
    });
});
