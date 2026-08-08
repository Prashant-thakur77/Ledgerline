import { expect } from "chai";
import { ethers } from "hardhat";
import { AbiCoder } from "ethers";

// The DTO the jq reduction produces, and which `abiSignature` describes.
// Keep in sync with RevenueOracle.RevenueDTO and with scripts/ledgerline/revenue-source.ts.
const DTO_TYPE = "tuple(string platform,string accountRef,uint256 revenueCents,uint256 periodStart,uint256 periodEnd)";

const coder = AbiCoder.defaultAbiCoder();

const MONTH = 30 * 24 * 60 * 60;
const JAN = 1767225600; // 2026-01-01T00:00:00Z

interface Dto {
    platform: string;
    accountRef: string;
    revenueCents: bigint | number;
    periodStart: number;
    periodEnd: number;
}

function dto(over: Partial<Dto> = {}): Dto {
    return {
        platform: "stripe",
        accountRef: "acct_1TestAbc123",
        revenueCents: 400_000, // $4,000.00 — the brief's example creator
        periodStart: JAN,
        periodEnd: JAN + MONTH,
        ...over,
    };
}

// Build an IWeb2Json.Proof whose responseBody carries the encoded DTO.
// The merkle proof itself is irrelevant here: the harness stubs verification, because whether
// Flare's verifier accepts a proof was proven on chain in Phase 0.1, not in a unit test.
function proofFor(d: Dto) {
    const abiEncodedData = coder.encode(
        [DTO_TYPE],
        [[d.platform, d.accountRef, d.revenueCents, d.periodStart, d.periodEnd]]
    );
    return {
        merkleProof: [],
        data: {
            attestationType: ethers.encodeBytes32String("Web2Json"),
            sourceId: ethers.encodeBytes32String("PublicWeb2"),
            votingRound: 1419928,
            lowestUsedTimestamp: 0,
            requestBody: {
                url: "https://api.stripe.com/v1/payouts",
                httpMethod: "GET",
                headers: "{}",
                queryParams: "{}",
                body: "{}",
                postProcessJq: "{ platform: \"stripe\" }",
                abiSignature: "{}",
            },
            responseBody: { abiEncodedData },
        },
    };
}

async function deploy() {
    const [deployer, borrower, attacker] = await ethers.getSigners();
    const Harness = await ethers.getContractFactory("RevenueOracleHarness");
    const oracle = await Harness.deploy();
    await oracle.waitForDeployment();
    return { oracle, deployer, borrower, attacker };
}

describe("RevenueOracle", () => {
    describe("storing a proven figure", () => {
        it("stores the revenue figure from a valid attestation", async () => {
            const { oracle, borrower } = await deploy();
            const d = dto();
            const accountId = await oracle.accountIdFor(d.platform, d.accountRef);

            await oracle.connect(borrower).submitAttestation(accountId, proofFor(d));

            const latest = await oracle.latestRevenue(accountId);
            expect(latest.revenueCents).to.equal(400_000n);
            expect(latest.periodStart).to.equal(d.periodStart);
            expect(latest.periodEnd).to.equal(d.periodEnd);
            expect(latest.provenAt).to.be.greaterThan(0n);
        });

        it("binds the account to the first wallet that proves it", async () => {
            const { oracle, borrower } = await deploy();
            const d = dto();
            const accountId = await oracle.accountIdFor(d.platform, d.accountRef);

            await oracle.connect(borrower).submitAttestation(accountId, proofFor(d));

            expect(await oracle.accountOwner(accountId)).to.equal(borrower.address);
        });

        it("keeps the full history so underwriting can read a trend", async () => {
            const { oracle, borrower } = await deploy();
            const accountId = await oracle.accountIdFor("stripe", "acct_1TestAbc123");

            for (let i = 0; i < 3; i++) {
                await oracle.connect(borrower).submitAttestation(
                    accountId,
                    proofFor(dto({
                        revenueCents: 300_000 + i * 50_000,
                        periodStart: JAN + i * MONTH,
                        periodEnd: JAN + (i + 1) * MONTH,
                    }))
                );
            }

            const history = await oracle.revenueHistory(accountId);
            expect(history.length).to.equal(3);
            expect(history.map((r: any) => r.revenueCents)).to.deep.equal([300_000n, 350_000n, 400_000n]);
        });

        it("records the FDC voting round the figure was proven in", async () => {
            const { oracle, borrower } = await deploy();
            const d = dto();
            const accountId = await oracle.accountIdFor(d.platform, d.accountRef);

            await oracle.connect(borrower).submitAttestation(accountId, proofFor(d));

            expect((await oracle.latestRevenue(accountId)).votingRound).to.equal(1419928n);
        });

        it("records the merkle root the proof resolves to, so it can be checked against the round", async () => {
            const { oracle, borrower } = await deploy();
            const d = dto();
            const accountId = await oracle.accountIdFor(d.platform, d.accountRef);
            const proof = proofFor(d);

            await oracle.connect(borrower).submitAttestation(accountId, proof);

            // With no sibling nodes the root is the leaf itself: keccak of the encoded response.
            const RESPONSE_TYPE =
                "tuple(bytes32 attestationType,bytes32 sourceId,uint64 votingRound,uint64 lowestUsedTimestamp," +
                "tuple(string url,string httpMethod,string headers,string queryParams,string body,string postProcessJq,string abiSignature) requestBody," +
                "tuple(bytes abiEncodedData) responseBody)";
            const d0 = proof.data;
            const encoded = coder.encode(
                [RESPONSE_TYPE],
                [
                    [
                        d0.attestationType,
                        d0.sourceId,
                        d0.votingRound,
                        d0.lowestUsedTimestamp,
                        [
                            d0.requestBody.url,
                            d0.requestBody.httpMethod,
                            d0.requestBody.headers,
                            d0.requestBody.queryParams,
                            d0.requestBody.body,
                            d0.requestBody.postProcessJq,
                            d0.requestBody.abiSignature,
                        ],
                        [d0.responseBody.abiEncodedData],
                    ],
                ]
            );
            expect((await oracle.latestRevenue(accountId)).merkleRoot).to.equal(ethers.keccak256(encoded));
        });

        it("distinguishes the same account reference on different platforms", async () => {
            const { oracle } = await deploy();
            expect(await oracle.accountIdFor("stripe", "acct_1"))
                .to.not.equal(await oracle.accountIdFor("shopify", "acct_1"));
        });
    });

    describe("guards", () => {
        it("reverts when the attested account does not match the claimed one", async () => {
            const { oracle, borrower } = await deploy();
            const wrongAccountId = await oracle.accountIdFor("stripe", "acct_SomebodyElse");

            await expect(
                oracle.connect(borrower).submitAttestation(wrongAccountId, proofFor(dto()))
            ).to.be.revertedWithCustomError(oracle, "AccountMismatch");
        });

        it("reverts when the proof does not verify", async () => {
            const { oracle, borrower } = await deploy();
            const d = dto();
            const accountId = await oracle.accountIdFor(d.platform, d.accountRef);
            await oracle.setProofValid(false);

            await expect(
                oracle.connect(borrower).submitAttestation(accountId, proofFor(d))
            ).to.be.revertedWithCustomError(oracle, "InvalidProof");
        });

        it("reverts when the same attestation is replayed", async () => {
            const { oracle, borrower } = await deploy();
            const d = dto();
            const accountId = await oracle.accountIdFor(d.platform, d.accountRef);
            await oracle.connect(borrower).submitAttestation(accountId, proofFor(d));

            await expect(
                oracle.connect(borrower).submitAttestation(accountId, proofFor(d))
            ).to.be.revertedWithCustomError(oracle, "AttestationAlreadyUsed");
        });

        it("does not let an older period overwrite a newer one", async () => {
            const { oracle, borrower } = await deploy();
            const accountId = await oracle.accountIdFor("stripe", "acct_1TestAbc123");
            await oracle.connect(borrower).submitAttestation(
                accountId,
                proofFor(dto({ periodStart: JAN + MONTH, periodEnd: JAN + 2 * MONTH, revenueCents: 400_000 }))
            );

            await expect(
                oracle.connect(borrower).submitAttestation(
                    accountId,
                    proofFor(dto({ periodStart: JAN, periodEnd: JAN + MONTH, revenueCents: 100 }))
                )
            ).to.be.revertedWithCustomError(oracle, "StalePeriod");

            expect((await oracle.latestRevenue(accountId)).revenueCents).to.equal(400_000n);
        });

        it("does not let a second wallet claim an already bound account", async () => {
            const { oracle, borrower, attacker } = await deploy();
            const accountId = await oracle.accountIdFor("stripe", "acct_1TestAbc123");
            await oracle.connect(borrower).submitAttestation(accountId, proofFor(dto()));

            await expect(
                oracle.connect(attacker).submitAttestation(
                    accountId,
                    proofFor(dto({ periodStart: JAN + MONTH, periodEnd: JAN + 2 * MONTH }))
                )
            ).to.be.revertedWithCustomError(oracle, "NotAccountOwner");
        });

        it("rejects a period that ends before it starts", async () => {
            const { oracle, borrower } = await deploy();
            const accountId = await oracle.accountIdFor("stripe", "acct_1TestAbc123");

            await expect(
                oracle.connect(borrower).submitAttestation(
                    accountId,
                    proofFor(dto({ periodStart: JAN + MONTH, periodEnd: JAN }))
                )
            ).to.be.revertedWithCustomError(oracle, "InvalidPeriod");
        });
    });

    describe("views before any attestation", () => {
        it("reports no history for an unknown account", async () => {
            const { oracle } = await deploy();
            const accountId = await oracle.accountIdFor("stripe", "acct_Unknown");

            expect(await oracle.attestationCount(accountId)).to.equal(0n);
            await expect(oracle.latestRevenue(accountId)).to.be.revertedWithCustomError(oracle, "NoRevenueProven");
        });
    });
});
