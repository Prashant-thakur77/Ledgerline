import { ethers, run } from "hardhat";
import * as fs from "fs";

/**
 * Deploy PrivateUnderwriter and register the enclave: its signing key and the keccak256 of the built
 * extension handler — a real measurement of the code that computes decisions, not a made-up constant.
 *
 *   ENCLAVE_SIGNER=0x… CODE_HASH=0x… npx hardhat run scripts/ledgerline/deploy-private-underwriter.ts --network coston2
 *
 * Standalone by design: touches no other contract, so deploying it carries zero risk to the live product.
 */
async function main() {
    const signer = process.env.ENCLAVE_SIGNER;
    const codeHash =
        process.env.CODE_HASH ??
        fs.readFileSync(
            "/tmp/claude-1000/-home-prashant-projects-flare/6ac0ab1f-ca60-43d2-adf0-309fb9d30d3a/scratchpad/codehash.txt",
            "utf8"
        ).trim();
    if (!signer || !/^0x[0-9a-fA-F]{40}$/.test(signer)) throw new Error("ENCLAVE_SIGNER required");
    if (!/^0x[0-9a-fA-F]{64}$/.test(codeHash)) throw new Error("CODE_HASH must be bytes32");

    const Underwriter = await ethers.getContractFactory("PrivateUnderwriter");
    const underwriter = await Underwriter.deploy();
    await underwriter.waitForDeployment();
    const addr = await underwriter.getAddress();
    console.log("PrivateUnderwriter:", addr);

    await (await underwriter.setEnclave(signer, codeHash)).wait();
    console.log("enclave signer    :", signer);
    console.log("code hash         :", codeHash);

    try {
        await run("verify:verify", { address: addr, constructorArguments: [] });
        console.log("verified");
    } catch (e) {
        console.log("verify:", (e as Error).message.split("\n")[0]);
    }
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
