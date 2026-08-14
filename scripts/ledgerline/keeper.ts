/**
 * The keeper: one pass over every account the protocol has ever advanced, doing the two jobs
 * anyone may do and someone should.
 *
 *   npx hardhat run scripts/ledgerline/keeper.ts --network coston2
 *
 * 1. Delinquency. `delinquencyDue` is the checkUpkeep-shaped view; a successful mark pays the
 *    caller the flat tip if the reserve is funded, which makes a cron of this script self-funding.
 * 2. The repayment floor. An account behind its curve is declared, which springs the splitter to
 *    full withholding until it cures. Declaring is permissionless because the shortfall is an
 *    on-chain fact.
 * 3. Reserve release. A rolling reserve whose advance closed clean, or whose refund window has
 *    passed, belongs to the borrower — releaseReserve is permissionless and pays them directly,
 *    so nobody's money sits escrowed a day longer than the policy requires.
 * 4. Revenue application. Deduction at source is the product's promise, and applyRevenueRepayment
 *    is permissionless for exactly this reason: when a fresh attested period sits unapplied against
 *    an open advance, anyone may make the promise true. The keeper does.
 *
 * Candidates come from the explorer's log index (AdvanceIssued), because the contracts deliberately
 * keep no account enumeration and the public RPC caps eth_getLogs at 30 blocks.
 */
import { ethers } from "hardhat";

const MANAGER = process.env.MANAGER_ADDRESS ?? "0x1187B737EFef8C1D2563C0001553Bf6E7afe25af";
const DEPLOY_BLOCK = process.env.DEPLOY_BLOCK ?? "34012225";
const EXPLORER_API = process.env.COSTON2_EXPLORER_API ?? "https://coston2-explorer.flare.network/api";

// keccak256("AdvanceIssued(bytes32,address,uint256,uint256,uint256,uint256,int8)")
const ADVANCE_ISSUED_TOPIC = ethers.id("AdvanceIssued(bytes32,address,uint256,uint256,uint256,uint256,int8)");

async function main() {
    const manager = await ethers.getContractAt("AdvanceManager", MANAGER);

    const url =
        `${EXPLORER_API}?module=logs&action=getLogs&fromBlock=${DEPLOY_BLOCK}&toBlock=latest` +
        `&address=${MANAGER}&topic0=${ADVANCE_ISSUED_TOPIC}`;
    const body = (await (await fetch(url)).json()) as { result?: { topics: string[] }[] };
    const accounts = [...new Set((body.result ?? []).map((l) => l.topics[1]))] as `0x${string}`[];
    console.log(`accounts ever advanced: ${accounts.length}`);
    if (accounts.length === 0) return;

    // Job 1: delinquency.
    const due = await manager.delinquencyDue(accounts);
    for (let i = 0; i < accounts.length; i++) {
        if (!due[i]) continue;
        console.log(`marking delinquent: ${accounts[i]}`);
        const tx = await manager.markDelinquent(accounts[i], { gasLimit: 1_000_000 });
        const receipt = await tx.wait();
        console.log(`  marked · ${receipt!.hash}`);
    }

    // Job 2: the floor.
    for (const id of accounts) {
        const advance = await manager.advanceOf(id);
        if (!advance.open || advance.delinquent) continue;
        if (await manager.floorBreached(id)) continue;
        const [shortfall, required] = await manager.floorShortfallCents(id);
        if (shortfall === 0n) continue;
        console.log(`floor breach: ${id} · $${Number(shortfall) / 100} behind a $${Number(required) / 100} floor`);
        const tx = await manager.declareFloorBreach(id, { gasLimit: 800_000 });
        const receipt = await tx.wait();
        console.log(`  declared · ${receipt!.hash}`);
    }

    // Job 4 (run before release, since applying may close an advance and free its reserve):
    // fresh attested revenue sitting unapplied against an open advance. The static call IS the
    // predicate — it reverts for every not-due case (nothing open, period already applied, a
    // zero-revenue period) and works against V5 and V6 alike, where decoding the oracle's record
    // client-side would tie the keeper to one ABI generation.
    for (const id of accounts) {
        const advance = await manager.advanceOf(id);
        if (!advance.open || advance.delinquent) continue;
        try {
            await manager.applyRevenueRepayment.staticCall(id);
        } catch {
            continue;
        }
        console.log(`unapplied revenue: ${id}`);
        const tx = await manager.applyRevenueRepayment(id, { gasLimit: 2_000_000 });
        const receipt = await tx.wait();
        console.log(`  applied · ${receipt!.hash}`);
    }

    // Job 3: reserves nobody has claimed. Mirror the contract's predicate exactly, then let the
    // node's estimate stand guard: a static call catches any race between our read and the send.
    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    const refundWindow = await manager.refundWindowSeconds();
    for (const id of accounts) {
        const reserve = await manager.reserveFxrp(id);
        if (reserve === 0n) continue;
        const advance = await manager.advanceOf(id);
        if (advance.delinquent) continue;
        const closedClean = !advance.open;
        const windowPassed = now > BigInt(advance.openedAt) + refundWindow;
        if (!closedClean && !windowPassed) continue;
        console.log(`reserve releasable: ${id} · ${ethers.formatUnits(reserve, 6)} FXRP`);
        await manager.releaseReserve.staticCall(id);
        const tx = await manager.releaseReserve(id, { gasLimit: 800_000 });
        const receipt = await tx.wait();
        console.log(`  released · ${receipt!.hash}`);
    }

    console.log("keeper pass complete: nothing else due");
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
