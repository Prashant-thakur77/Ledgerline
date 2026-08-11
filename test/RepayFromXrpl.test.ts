import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";

/**
 * Repaying from the XRP Ledger, proven by FDC's Payment attestation.
 *
 * This is the return leg of `requestAdvanceToXrpl`: the borrower is funded in real XRP and repays in real
 * XRP, while the obligation itself stays on Flare and stays denominated in dollars. It is also the second
 * FDC attestation type in the product — revenue arrives as Web2Json, repayment as Payment — so the tests
 * here are mostly about what the contract refuses, since an attestation the network signed still says
 * nothing about *which* debt it settles.
 */

const DTO_TYPE = "tuple(string platform,string accountRef,uint256 revenueCents,uint256 periodStart,uint256 periodEnd)";
const coder = AbiCoder.defaultAbiCoder();

const MONTH = 30 * 24 * 60 * 60;
const JAN = 1767225600;
const FXRP_DECIMALS = 6;
const XRP_USD = 1_041_868n;
const PRICE_DECIMALS = 6;
const DROPS_PER_XRP = 1_000_000n;

const LOT = 10n * 10n ** BigInt(FXRP_DECIMALS);

/** The treasury account borrowers repay to, and the chain the payment must have happened on. */
const XRPL_TREASURY = "rpcBsvdaL4eCkK64nNsQB1PQf4hm2Dq3Sc";
const TEST_XRP = ethers.encodeBytes32String("testXRP");
const OTHER_XRPL_ACCOUNT = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";

function revenueProof(revenueCents: number, index: number) {
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

/**
 * An XRPL Payment as FDC reports it. Defaults describe a well-formed payment of `drops` into the treasury
 * account carrying `accountId` as its payment reference; each test overrides only the field it is about.
 */
function paymentProof(
    drops: bigint,
    paymentReference: string,
    overrides: Partial<{
        transactionId: string;
        sourceId: string;
        receivingAddress: string;
        status: number;
    }> = {}
) {
    return {
        merkleProof: [],
        data: {
            attestationType: ethers.encodeBytes32String("Payment"),
            sourceId: overrides.sourceId ?? TEST_XRP,
            votingRound: 1,
            lowestUsedTimestamp: 0,
            requestBody: {
                transactionId: overrides.transactionId ?? ethers.id("xrpl-tx-1"),
                inUtxo: 0,
                utxo: 0,
            },
            responseBody: {
                blockNumber: 1,
                blockTimestamp: JAN,
                sourceAddressHash: ethers.id(OTHER_XRPL_ACCOUNT),
                sourceAddressesRoot: ethers.ZeroHash,
                receivingAddressHash: ethers.id(overrides.receivingAddress ?? XRPL_TREASURY),
                intendedReceivingAddressHash: ethers.id(overrides.receivingAddress ?? XRPL_TREASURY),
                spentAmount: drops,
                intendedSpentAmount: drops,
                receivedAmount: drops,
                intendedReceivedAmount: drops,
                standardPaymentReference: paymentReference,
                oneToOne: true,
                status: overrides.status ?? 0,
            },
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
    await manager.setXrplTreasury(XRPL_TREASURY, TEST_XRP);

    const treasury = 100n * LOT;
    await fxrp.mint(owner.address, treasury);
    await fxrp.approve(await manager.getAddress(), treasury);
    await manager.depositTreasury(treasury);

    const accountId = await oracle.accountIdFor("stripe", "acct_1TestAbc123");
    await oracle.connect(borrower).submitAttestation(accountId, revenueProof(400_000, 0));

    // Fund the borrower on the XRP Ledger side: one lot out, so there is a dollar debt to settle.
    await manager.connect(borrower).requestAdvanceToXrpl(accountId, 1, XRPL_TREASURY);

    return { oracle, fxrp, assetManager, manager, owner, borrower, accountId };
}

describe("Repaying from the XRP Ledger", () => {
    describe("converting drops to dollars", () => {
        it("prices a payment in dollars at the FTSO rate", async () => {
            const { manager } = await setup();
            // 10 XRP at $1.041868 = $10.41868, truncated to cents
            expect(await manager.xrpDropsToUsdCents(10n * DROPS_PER_XRP, XRP_USD, PRICE_DECIMALS)).to.equal(1041n);
        });

        it("gives the same answer whatever decimals the feed reports", async () => {
            const { manager } = await setup();
            const at6 = await manager.xrpDropsToUsdCents(10n * DROPS_PER_XRP, 1_041_868n, 6);
            const at8 = await manager.xrpDropsToUsdCents(10n * DROPS_PER_XRP, 104_186_800n, 8);
            expect(at6).to.equal(at8);
        });

        /*
         * The conversion is what stands between a borrower and a debt that moves with the market, so it is
         * tested against a move large enough that any scaling error would be obvious rather than subtle.
         */
        it("tracks a 3x price move, because it prices XRP at the moment of payment", async () => {
            const { manager } = await setup();
            // 10 XRP at $1.041868 is $10.41868 -> 1041 cents; at 3x it is $31.25604 -> 3125 cents.
            expect(await manager.xrpDropsToUsdCents(10n * DROPS_PER_XRP, XRP_USD, PRICE_DECIMALS)).to.equal(1041n);
            expect(await manager.xrpDropsToUsdCents(10n * DROPS_PER_XRP, XRP_USD * 3n, PRICE_DECIMALS)).to.equal(3125n);

            // Tripling the price triples the value; the two cents of drift are truncation to whole cents,
            // which is why this is asserted against the exact figures rather than against 3x the first.
            expect(3125n - 1041n * 3n).to.equal(2n);
        });

        it("refuses to price anything at all when the feed reads zero", async () => {
            const { manager } = await setup();
            await expect(
                manager.xrpDropsToUsdCents(10n * DROPS_PER_XRP, 0n, PRICE_DECIMALS)
            ).to.be.revertedWithCustomError(manager, "InvalidPrice");
        });
    });

    describe("settling a debt", () => {
        it("reduces the dollar debt by what the XRP was worth", async () => {
            const { manager, borrower, accountId } = await setup();
            const before = (await manager.advanceOf(accountId)).outstandingCents;

            await manager.connect(borrower).repayFromXrpl(accountId, paymentProof(5n * DROPS_PER_XRP, accountId));

            // 5 XRP at $1.041868 = $5.20934 -> 520 cents
            expect((await manager.advanceOf(accountId)).outstandingCents).to.equal(before - 520n);
        });

        it("closes the advance when the payment covers it", async () => {
            const { manager, borrower, accountId } = await setup();

            await manager.connect(borrower).repayFromXrpl(accountId, paymentProof(20n * DROPS_PER_XRP, accountId));

            expect((await manager.advanceOf(accountId)).outstandingCents).to.equal(0n);
            expect(await manager.hasOpenAdvance(accountId)).to.equal(false);
        });

        /*
         * An XRPL payment cannot be retracted. Reverting on an overpayment would take the borrower's money
         * and leave the debt standing, so the contract takes what it is owed and closes.
         */
        it("takes only what is owed when the borrower overpays, rather than reverting", async () => {
            const { manager, borrower, accountId } = await setup();
            const owed = (await manager.advanceOf(accountId)).outstandingCents;

            await expect(manager.connect(borrower).repayFromXrpl(accountId, paymentProof(1000n * DROPS_PER_XRP, accountId)))
                .to.emit(manager, "RepaidFromXrpl")
                .withArgs(accountId, ethers.id("xrpl-tx-1"), 1000n * DROPS_PER_XRP, owed, XRP_USD, PRICE_DECIMALS, 0n);

            expect(await manager.hasOpenAdvance(accountId)).to.equal(false);
        });

        /*
         * The XRP landed in an XRP Ledger account, not as FXRP on Flare. Crediting the Flare-side treasury
         * would put a number in storage that no balance backs.
         */
        it("does not pretend the Flare treasury grew", async () => {
            const { manager, borrower, accountId } = await setup();
            const before = await manager.treasuryBalance();

            await manager.connect(borrower).repayFromXrpl(accountId, paymentProof(5n * DROPS_PER_XRP, accountId));

            expect(await manager.treasuryBalance()).to.equal(before);
        });

        it("lets anyone submit the proof, since the proof itself names the debt", async () => {
            const { manager, owner, accountId } = await setup();
            const before = (await manager.advanceOf(accountId)).outstandingCents;

            await manager.connect(owner).repayFromXrpl(accountId, paymentProof(5n * DROPS_PER_XRP, accountId));

            expect((await manager.advanceOf(accountId)).outstandingCents).to.be.lessThan(before);
        });
    });

    describe("what it refuses", () => {
        it("refuses a payment to somebody else's XRPL account", async () => {
            const { manager, borrower, accountId } = await setup();
            await expect(
                manager
                    .connect(borrower)
                    .repayFromXrpl(accountId, paymentProof(5n * DROPS_PER_XRP, accountId, { receivingAddress: OTHER_XRPL_ACCOUNT }))
            ).to.be.revertedWithCustomError(manager, "WrongPaymentRecipient");
        });

        /* Without this, any payment into the treasury could be claimed against any account's debt. */
        it("refuses a payment whose reference names a different account", async () => {
            const { manager, borrower, accountId } = await setup();
            const someoneElse = ethers.id("another-account");
            await expect(
                manager.connect(borrower).repayFromXrpl(accountId, paymentProof(5n * DROPS_PER_XRP, someoneElse))
            ).to.be.revertedWithCustomError(manager, "WrongPaymentReference");
        });

        it("refuses a payment attested on the wrong chain", async () => {
            const { manager, borrower, accountId } = await setup();
            const btc = ethers.encodeBytes32String("testBTC");
            await expect(
                manager.connect(borrower).repayFromXrpl(accountId, paymentProof(5n * DROPS_PER_XRP, accountId, { sourceId: btc }))
            ).to.be.revertedWithCustomError(manager, "WrongPaymentChain");
        });

        it("refuses a payment that failed on the XRP Ledger", async () => {
            const { manager, borrower, accountId } = await setup();
            await expect(
                manager.connect(borrower).repayFromXrpl(accountId, paymentProof(5n * DROPS_PER_XRP, accountId, { status: 1 }))
            ).to.be.revertedWithCustomError(manager, "PaymentNotSuccessful");
        });

        it("refuses the same XRPL payment twice", async () => {
            const { manager, borrower, accountId } = await setup();
            const proof = paymentProof(2n * DROPS_PER_XRP, accountId);

            await manager.connect(borrower).repayFromXrpl(accountId, proof);
            await expect(
                manager.connect(borrower).repayFromXrpl(accountId, proof)
            ).to.be.revertedWithCustomError(manager, "XrplPaymentAlreadyUsed");
        });

        /* Every field can be right and the payment still never have happened. */
        it("refuses a proof the network does not verify, however well formed", async () => {
            const { manager, borrower, accountId } = await setup();
            await manager.setPaymentVerifies(false);

            await expect(
                manager.connect(borrower).repayFromXrpl(accountId, paymentProof(5n * DROPS_PER_XRP, accountId))
            ).to.be.revertedWithCustomError(manager, "InvalidPaymentProof");
        });

        it("refuses when there is no advance to settle", async () => {
            const { manager, borrower, accountId } = await setup();
            await manager.connect(borrower).repayFromXrpl(accountId, paymentProof(20n * DROPS_PER_XRP, accountId));

            await expect(
                manager
                    .connect(borrower)
                    .repayFromXrpl(accountId, paymentProof(5n * DROPS_PER_XRP, accountId, { transactionId: ethers.id("xrpl-tx-2") }))
            ).to.be.revertedWithCustomError(manager, "NoOpenAdvance");
        });

        it("refuses a payment too small to be worth a cent", async () => {
            const { manager, borrower, accountId } = await setup();
            await expect(
                manager.connect(borrower).repayFromXrpl(accountId, paymentProof(1n, accountId))
            ).to.be.revertedWithCustomError(manager, "InvalidAmount");
        });

        it("is unavailable until an XRPL treasury account is configured", async () => {
            const { oracle, fxrp, borrower, accountId, owner } = await setup();
            const Manager = await ethers.getContractFactory("AdvanceManagerHarness");
            const bare = await Manager.deploy(await oracle.getAddress(), await fxrp.getAddress());
            await bare.setXrpUsd(XRP_USD, PRICE_DECIMALS);
            await fxrp.mint(owner.address, 10n * LOT);
            await fxrp.approve(await bare.getAddress(), 10n * LOT);
            await bare.depositTreasury(10n * LOT);

            await expect(
                bare.connect(borrower).repayFromXrpl(accountId, paymentProof(5n * DROPS_PER_XRP, accountId))
            ).to.be.revertedWithCustomError(bare, "XrplRepaymentUnavailable");
        });

        it("only lets the owner set the XRPL treasury account", async () => {
            const { manager, borrower } = await setup();
            await expect(
                manager.connect(borrower).setXrplTreasury(OTHER_XRPL_ACCOUNT, TEST_XRP)
            ).to.be.revertedWithCustomError(manager, "OwnableUnauthorizedAccount");
        });
    });
});
