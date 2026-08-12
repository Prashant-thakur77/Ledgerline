import { ethers } from "hardhat";

/**
 * Become the pool's first LP: pull any FXRP still sitting in the superseded V1 treasury, then deposit
 * everything the wallet holds into the LenderPool.
 *
 *   POOL_ADDRESS=0x… npx hardhat run scripts/ledgerline/fund-pool.ts --network coston2
 *
 * Env:
 *   POOL_ADDRESS      the LenderPool
 *   V1_MANAGER        a superseded AdvanceManager to drain first (optional)
 *   AMOUNT            FXRP to deposit, decimal. Defaults to everything held.
 */

const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7";

async function main() {
    const poolAddr = process.env.POOL_ADDRESS;
    if (!poolAddr) throw new Error("POOL_ADDRESS is required");

    const [signer] = await ethers.getSigners();
    const fxrp = await ethers.getContractAt(
        [
            "function approve(address,uint256) returns (bool)",
            "function balanceOf(address) view returns (uint256)",
            "function decimals() view returns (uint8)",
        ],
        FXRP
    );
    const decimals = await fxrp.decimals();

    // Drain the superseded treasury first, if asked. Owner-only on that contract, harmless if empty.
    const v1 = process.env.V1_MANAGER;
    if (v1) {
        const old = await ethers.getContractAt("AdvanceManager", v1);
        const held = await old.treasuryBalance();
        if (held > 0n) {
            console.log(`Withdrawing ${ethers.formatUnits(held, decimals)} FXRP from the superseded treasury…`);
            await (await old.withdrawTreasury(held)).wait();
        } else {
            console.log("Superseded treasury is empty — nothing to withdraw.");
        }
    }

    const pool = await ethers.getContractAt("LenderPool", poolAddr);
    const held = await fxrp.balanceOf(signer.address);
    const amount = process.env.AMOUNT ? ethers.parseUnits(process.env.AMOUNT, decimals) : held;
    if (amount === 0n) {
        console.log("Nothing to deposit. Claim from https://faucet.flare.network/coston2 and run again.");
        return;
    }

    console.log(`Depositing ${ethers.formatUnits(amount, decimals)} FXRP into the pool…`);
    await (await fxrp.approve(poolAddr, amount)).wait();
    const tx = await pool.deposit(amount, signer.address);
    const receipt = await tx.wait();
    console.log("  deposited, tx:", receipt!.hash);

    console.log("\npool");
    console.log("  totalAssets    ", ethers.formatUnits(await pool.totalAssets(), decimals), "FXRP");
    console.log("  availableToLend", ethers.formatUnits(await pool.availableToLend(), decimals), "FXRP");
    console.log("  your shares    ", ethers.formatUnits(await pool.balanceOf(signer.address), decimals + 3n));
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
