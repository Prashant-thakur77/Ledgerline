import { ethers } from "hardhat";

/**
 * Move FXRP from the deployer's wallet into the AdvanceManager treasury, so advances can be issued.
 *
 *   npx hardhat run scripts/ledgerline/fund-treasury.ts --network coston2
 *
 * Deposits the whole FXRP balance by default; set AMOUNT to deposit a specific number of FXRP instead.
 * Claim FXRP first at https://faucet.flare.network/coston2 — 10 FXRP per address per 24 hours.
 *
 * Env:
 *   MANAGER_ADDRESS  deployed AdvanceManager
 *   AMOUNT           FXRP to deposit, as a decimal figure (e.g. "10"). Defaults to everything held.
 */

const MANAGER_ADDRESS = process.env.MANAGER_ADDRESS ?? "0x1187B737EFef8C1D2563C0001553Bf6E7afe25af";
const FXRP = "0x0b6A3645c240605887a5532109323A3E12273dc7";

async function main() {
    const [signer] = await ethers.getSigners();
    const manager = await ethers.getContractAt("AdvanceManager", MANAGER_ADDRESS);

    const fxrp = await ethers.getContractAt(
        [
            "function approve(address,uint256) returns (bool)",
            "function allowance(address,address) view returns (uint256)",
            "function balanceOf(address) view returns (uint256)",
            "function decimals() view returns (uint8)",
        ],
        FXRP
    );

    const decimals = await fxrp.decimals();
    const held = await fxrp.balanceOf(signer.address);
    const amount = process.env.AMOUNT ? ethers.parseUnits(process.env.AMOUNT, decimals) : held;

    console.log("Wallet        :", signer.address);
    console.log("FXRP held     :", ethers.formatUnits(held, decimals));
    console.log("Treasury now  :", ethers.formatUnits(await manager.treasuryBalance(), decimals));

    if (amount === 0n) {
        console.log("\nNothing to deposit. Claim FXRP at https://faucet.flare.network/coston2 and run this again.");
        return;
    }
    if (amount > held) {
        throw new Error(
            `Asked to deposit ${ethers.formatUnits(amount, decimals)} FXRP but the wallet holds ` +
                `${ethers.formatUnits(held, decimals)}.`
        );
    }

    console.log("\nDepositing    :", ethers.formatUnits(amount, decimals), "FXRP");

    // depositTreasury pulls with transferFrom, so it needs an allowance first.
    const allowance = await fxrp.allowance(signer.address, MANAGER_ADDRESS);
    if (allowance < amount) {
        await (await fxrp.approve(MANAGER_ADDRESS, amount)).wait();
        console.log("  approved");
    }

    const tx = await manager.depositTreasury(amount);
    const receipt = await tx.wait();
    console.log("  deposited, tx:", receipt!.hash);

    console.log("\nTreasury      :", ethers.formatUnits(await manager.treasuryBalance(), decimals), "FXRP");
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
