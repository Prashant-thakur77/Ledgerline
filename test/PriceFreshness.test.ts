import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";

/**
 * The price is the whole dollar denomination, so a stale feed is not a rounding problem.
 *
 * Every advance and every repayment converts through XRP/USD. If the feed stops updating, the contract
 * would keep pricing against whatever it last said — sizing advances by yesterday's XRP and settling
 * repayments at a rate that cheats whichever side the market moved against. Refusing is the correct
 * behaviour: nobody is harmed by a transaction that does not happen.
 */

const DTO_TYPE = "tuple(string platform,string accountRef,uint256 revenueCents,uint256 periodStart,uint256 periodEnd,uint256 refundCents,uint256 disputeCount)";
const coder = AbiCoder.defaultAbiCoder();

const MONTH = 30 * 24 * 60 * 60;
const JAN = 1767225600;
const XRP_USD = 1_000_000n;
const PRICE_DECIMALS = 6;
const REF = "acct_1Freshness";

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
    const Token = await ethers.getContractFactory("MockFXRP");
    const fxrp = await Token.deploy();
    const Manager = await ethers.getContractFactory("AdvanceManagerHarness");
    const manager = await Manager.deploy(await oracle.getAddress(), await fxrp.getAddress());
    await manager.setXrpUsd(XRP_USD, PRICE_DECIMALS);
    await manager.setFactorSchedule(10_000, 0, 10_000, 0);

    await fxrp.mint(await manager.getAddress(), 0n);
    const owner = (await ethers.getSigners())[0];
    await fxrp.mint(owner.address, 10_000_000_000n);
    await fxrp.connect(owner).approve(await manager.getAddress(), 10_000_000_000n);
    await manager.depositTreasury(10_000_000_000n);

    await fxrp.mint(borrower.address, 10_000_000_000n);
    await fxrp.connect(borrower).approve(await manager.getAddress(), 10_000_000_000n);

    const accountId = await oracle.accountIdFor("stripe", REF);
    await oracle.connect(borrower).submitAttestation(accountId, revenueProof(400_000, JAN, JAN + MONTH));

    return { borrower, manager, accountId };
}

describe("The XRP/USD feed has to be fresh", () => {
    it("prices normally while the feed is current", async () => {
        const { borrower, manager, accountId } = await setup();
        await expect(manager.connect(borrower).requestAdvance(accountId, 10_000n)).to.not.be.reverted;
    });

    it("refuses to open an advance against a stale feed", async () => {
        const { borrower, manager, accountId } = await setup();
        await manager.setPriceAge(2 * 60 * 60); // two hours, against a one-hour tolerance

        await expect(manager.connect(borrower).requestAdvance(accountId, 10_000n)).to.be.revertedWithCustomError(
            manager,
            "StalePrice"
        );
    });

    it("refuses to price a repayment against a stale feed", async () => {
        const { borrower, manager, accountId } = await setup();
        await manager.connect(borrower).requestAdvance(accountId, 10_000n);

        await manager.setPriceAge(2 * 60 * 60);
        await expect(manager.connect(borrower).repay(accountId, 1_000n)).to.be.revertedWithCustomError(
            manager,
            "StalePrice"
        );
    });

    it("refuses a feed timestamped in the future", async () => {
        const { borrower, manager, accountId } = await setup();
        // A feed clock ahead of the block is nonsense, and must not be accepted as "very fresh".
        const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
        await manager.setPriceTimestamp(now + 600n);

        await expect(manager.connect(borrower).requestAdvance(accountId, 10_000n)).to.be.revertedWithCustomError(
            manager,
            "StalePrice"
        );
    });

    it("the tolerance is governable, and widening it lets the same price through", async () => {
        const { borrower, manager, accountId } = await setup();
        await manager.setPriceAge(2 * 60 * 60);
        await expect(manager.connect(borrower).requestAdvance(accountId, 10_000n)).to.be.reverted;

        await manager.setMaxPriceAge(3 * 60 * 60);
        await expect(manager.connect(borrower).requestAdvance(accountId, 10_000n)).to.not.be.reverted;
    });
});
