import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * The on-chain half of the Confidential Compute path: an enclave-signed underwriting decision is stored
 * only if the signature verifies against the registered enclave key AND the registered code measurement.
 * These tests use an ordinary wallet as the "enclave key" — exactly the stand-in the contract's own
 * documentation admits to until platform registration upgrades who holds the key.
 */

const ACCOUNT = ethers.id("stripe/acct_private");
const CODE_HASH = ethers.id("ledgerline-underwrite-extension-v0.1.0");

async function setup() {
    const [owner, outsider] = await ethers.getSigners();
    const enclave = ethers.Wallet.createRandom(); // the enclave's signing key, held off-chain

    const Underwriter = await ethers.getContractFactory("PrivateUnderwriter");
    const underwriter = await Underwriter.deploy();
    await underwriter.setEnclave(enclave.address, CODE_HASH);

    return { owner, outsider, enclave, underwriter };
}

/** Sign a decision the way the enclave does: EIP-191 over the ABI-encoded decision + code hash. */
async function sign(
    enclave: ethers.HDNodeWallet,
    accountId: string,
    limitCents: bigint,
    factorBps: number,
    feeBps: number,
    computedAt: number,
    codeHash = CODE_HASH
) {
    const digest = ethers.keccak256(
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "uint256", "uint16", "uint16", "uint64", "bytes32"],
            [accountId, limitCents, factorBps, feeBps, computedAt, codeHash]
        )
    );
    return enclave.signMessage(ethers.getBytes(digest));
}

describe("PrivateUnderwriter", () => {
    it("stores a correctly signed decision — the limit, never the revenue", async () => {
        const { underwriter, enclave, outsider } = await setup();
        const now = await time.latest();

        const sig = await sign(enclave, ACCOUNT, 10_000n, 250, 890, now);
        // Anyone may deliver the decision; the signature is the authority, not the courier.
        await underwriter.connect(outsider).submitPrivateLimit(ACCOUNT, 10_000n, 250, 890, now, sig);

        const stored = await underwriter.privateLimitOf(ACCOUNT);
        expect(stored.limitCents).to.equal(10_000n);
        expect(stored.factorBps).to.equal(250);
        expect(stored.feeBps).to.equal(890);
    });

    it("refuses a decision signed by anyone but the enclave", async () => {
        const { underwriter } = await setup();
        const impostor = ethers.Wallet.createRandom();
        const now = await time.latest();

        const sig = await sign(impostor, ACCOUNT, 999_999n, 10_000, 500, now);
        await expect(
            underwriter.submitPrivateLimit(ACCOUNT, 999_999n, 10_000, 500, now, sig)
        ).to.be.revertedWithCustomError(underwriter, "NotEnclaveSigner");
    });

    it("refuses the right key signing for the wrong code measurement", async () => {
        const { underwriter, enclave } = await setup();
        const now = await time.latest();

        const sig = await sign(enclave, ACCOUNT, 10_000n, 250, 890, now, ethers.id("some-other-build"));
        await expect(
            underwriter.submitPrivateLimit(ACCOUNT, 10_000n, 250, 890, now, sig)
        ).to.be.revertedWithCustomError(underwriter, "NotEnclaveSigner");
    });

    it("refuses tampered figures under a genuine signature", async () => {
        const { underwriter, enclave } = await setup();
        const now = await time.latest();

        const sig = await sign(enclave, ACCOUNT, 10_000n, 250, 890, now);
        await expect(
            underwriter.submitPrivateLimit(ACCOUNT, 1_000_000n, 250, 890, now, sig)
        ).to.be.revertedWithCustomError(underwriter, "NotEnclaveSigner");
    });

    it("refuses stale, future and replayed decisions", async () => {
        const { underwriter, enclave } = await setup();
        const now = await time.latest();

        const old = now - 2 * 24 * 60 * 60;
        await expect(
            underwriter.submitPrivateLimit(ACCOUNT, 1n, 1, 1, old, await sign(enclave, ACCOUNT, 1n, 1, 1, old))
        ).to.be.revertedWithCustomError(underwriter, "StaleDecision");

        const future = now + 60 * 60;
        await expect(
            underwriter.submitPrivateLimit(
                ACCOUNT, 1n, 1, 1, future, await sign(enclave, ACCOUNT, 1n, 1, 1, future)
            )
        ).to.be.revertedWithCustomError(underwriter, "FutureDecision");

        const sig = await sign(enclave, ACCOUNT, 10_000n, 250, 890, now);
        await underwriter.submitPrivateLimit(ACCOUNT, 10_000n, 250, 890, now, sig);
        await expect(
            underwriter.submitPrivateLimit(ACCOUNT, 10_000n, 250, 890, now, sig)
        ).to.be.revertedWithCustomError(underwriter, "ReplayedDecision");
    });

    it("a newer decision supersedes an older one", async () => {
        const { underwriter, enclave } = await setup();
        const now = await time.latest();

        await underwriter.submitPrivateLimit(
            ACCOUNT, 10_000n, 250, 890, now, await sign(enclave, ACCOUNT, 10_000n, 250, 890, now)
        );
        await time.increase(60 * 60);
        const later = await time.latest();
        await underwriter.submitPrivateLimit(
            ACCOUNT, 234_000n, 5_850, 666, later, await sign(enclave, ACCOUNT, 234_000n, 5_850, 666, later)
        );

        expect((await underwriter.privateLimitOf(ACCOUNT)).limitCents).to.equal(234_000n);
    });

    it("does nothing at all until governance registers an enclave", async () => {
        const [owner] = await ethers.getSigners();
        void owner;
        const Underwriter = await ethers.getContractFactory("PrivateUnderwriter");
        const bare = await Underwriter.deploy();
        const now = await time.latest();

        await expect(
            bare.submitPrivateLimit(ACCOUNT, 1n, 1, 1, now, "0x")
        ).to.be.revertedWithCustomError(bare, "EnclaveUnset");
    });
});
