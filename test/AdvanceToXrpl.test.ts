import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";

const DTO_TYPE = "tuple(string platform,string accountRef,uint256 revenueCents,uint256 periodStart,uint256 periodEnd)";
const coder = AbiCoder.defaultAbiCoder();

const MONTH = 30 * 24 * 60 * 60;
const JAN = 1767225600;
const FXRP_DECIMALS = 6;
const XRP_USD = 1_041_868n;
const PRICE_DECIMALS = 6;

/** Coston2's real lot size: 10 XRP. Redemption is in whole lots only. */
const LOT = 10n * 10n ** BigInt(FXRP_DECIMALS);

const XRPL_ADDRESS = "rpcBsvdaL4eCkK64nNsQB1PQf4hm2Dq3Sc";

function proofFor(revenueCents: number, index: number) {
    const abiEncodedData = coder.encode(
        [DTO_TYPE],
        [["stripe", "acct_1TestAbc123", revenueCents, JAN + index * MONTH, JAN + (index + 1) * MONTH]]
    );
    return {
        merkleProof: [],
        data: {
            attestationType: ethers.encodeBytes32String("Web2Json"),
            sourceId: ethers.encodeBytes32String("PublicWeb2"),
            votingRound: 1,
            lowestUsedTimestamp: 0,
            requestBody: {
                url: "",
                httpMethod: "GET",
                headers: "{}",
                queryParams: "{}",
                body: "{}",
                postProcessJq: "{}",
                abiSignature: "{}",
            },
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
    const Am = await ethers.getContractFactory("MockAssetManager");
    const assetManager = await Am.deploy(await fxrp.getAddress(), LOT);

    const Manager = await ethers.getContractFactory("AdvanceManagerHarness");
    const manager = await Manager.deploy(await oracle.getAddress(), await fxrp.getAddress());
    await manager.setXrpUsd(XRP_USD, PRICE_DECIMALS);
    await manager.setAssetManager(await assetManager.getAddress());

    const treasury = 100n * LOT;
    await fxrp.mint(owner.address, treasury);
    await fxrp.approve(await manager.getAddress(), treasury);
    await manager.depositTreasury(treasury);

    const accountId = await oracle.accountIdFor("stripe", "acct_1TestAbc123");
    await oracle.connect(borrower).submitAttestation(accountId, proofFor(400_000, 0));

    return { oracle, fxrp, assetManager, manager, owner, borrower, accountId };
}

describe("Advancing to the XRP Ledger", () => {
    it("redeems whole lots to the borrower's XRPL address instead of sending FXRP", async () => {
        const { fxrp, assetManager, manager, borrower, accountId } = await setup();
        const balBefore = await fxrp.balanceOf(borrower.address);

        await manager.connect(borrower).requestAdvanceToXrpl(accountId, 1, XRPL_ADDRESS);

        // The borrower receives nothing on the EVM side — the whole point.
        expect(await fxrp.balanceOf(borrower.address)).to.equal(balBefore);
        expect(await assetManager.lastLots()).to.equal(1n);
        expect(await assetManager.lastUnderlyingAddress()).to.equal(XRPL_ADDRESS);
        expect(await fxrp.balanceOf(await assetManager.getAddress())).to.equal(LOT);
    });

    it("denominates the resulting debt in dollars at the FTSO rate", async () => {
        const { manager, borrower, accountId } = await setup();

        await manager.connect(borrower).requestAdvanceToXrpl(accountId, 1, XRPL_ADDRESS);

        // 10 XRP at $1.041868 = $10.41868, truncated to cents = 1041
        const expectedCents = 1041n;
        const advance = await manager.advanceOf(accountId);
        const fee = (expectedCents * (await manager.feeBps())) / 10_000n;
        expect(advance.principalCents).to.equal(expectedCents);
        expect(advance.outstandingCents).to.equal(expectedCents + fee);
        expect(advance.fxrpDisbursed).to.equal(LOT);
    });

    it("scales with the number of lots", async () => {
        const { manager, borrower, accountId } = await setup();

        await manager.connect(borrower).requestAdvanceToXrpl(accountId, 3, XRPL_ADDRESS);

        const advance = await manager.advanceOf(accountId);
        expect(advance.fxrpDisbursed).to.equal(3n * LOT);
        expect(advance.principalCents).to.equal(3125n); // 30 XRP at $1.041868 = $31.25604
    });

    it("reverts when the dollar value of the lots exceeds the limit", async () => {
        const { manager, borrower, accountId } = await setup();
        // limit is $4,000; 400 lots = 4000 XRP is about $4,167
        await expect(
            manager.connect(borrower).requestAdvanceToXrpl(accountId, 400, XRPL_ADDRESS)
        ).to.be.revertedWithCustomError(manager, "ExceedsLimit");
    });

    it("reverts on zero lots rather than redeeming nothing", async () => {
        const { manager, borrower, accountId } = await setup();
        await expect(
            manager.connect(borrower).requestAdvanceToXrpl(accountId, 0, XRPL_ADDRESS)
        ).to.be.revertedWithCustomError(manager, "InvalidAmount");
    });

    it("reverts on an empty XRPL address", async () => {
        const { manager, borrower, accountId } = await setup();
        await expect(
            manager.connect(borrower).requestAdvanceToXrpl(accountId, 1, "")
        ).to.be.revertedWithCustomError(manager, "InvalidXrplAddress");
    });

    it("reverts when the treasury holds less than the requested lots", async () => {
        const { manager, owner, borrower, accountId } = await setup();
        await manager.connect(owner).withdrawTreasury(await manager.treasuryBalance());

        await expect(
            manager.connect(borrower).requestAdvanceToXrpl(accountId, 1, XRPL_ADDRESS)
        ).to.be.revertedWithCustomError(manager, "InsufficientTreasury");
    });

    it("is still one advance at a time, whichever leg it went out on", async () => {
        const { manager, borrower, accountId } = await setup();
        await manager.connect(borrower).requestAdvanceToXrpl(accountId, 1, XRPL_ADDRESS);

        await expect(
            manager.connect(borrower).requestAdvance(accountId, 100n)
        ).to.be.revertedWithCustomError(manager, "AdvanceAlreadyOpen");
    });

    it("is repaid in the same dollars as any other advance", async () => {
        const { fxrp, manager, borrower, accountId } = await setup();
        await manager.connect(borrower).requestAdvanceToXrpl(accountId, 1, XRPL_ADDRESS);
        const owed = (await manager.advanceOf(accountId)).outstandingCents;

        await fxrp.mint(borrower.address, 100n * LOT);
        await fxrp.connect(borrower).approve(await manager.getAddress(), ethers.MaxUint256);
        await manager.connect(borrower).repay(accountId, owed);

        expect((await manager.advanceOf(accountId)).outstandingCents).to.equal(0n);
        expect(await manager.hasOpenAdvance(accountId)).to.equal(false);
    });

    it("reverts when no asset manager is configured", async () => {
        const { oracle, fxrp, borrower, accountId, owner } = await setup();
        const Manager = await ethers.getContractFactory("AdvanceManagerHarness");
        const bare = await Manager.deploy(await oracle.getAddress(), await fxrp.getAddress());
        await bare.setXrpUsd(XRP_USD, PRICE_DECIMALS);
        await fxrp.mint(owner.address, 10n * LOT);
        await fxrp.approve(await bare.getAddress(), 10n * LOT);
        await bare.depositTreasury(10n * LOT);

        await expect(
            bare.connect(borrower).requestAdvanceToXrpl(accountId, 1, XRPL_ADDRESS)
        ).to.be.revertedWithCustomError(bare, "XrplDisbursementUnavailable");
    });
});
