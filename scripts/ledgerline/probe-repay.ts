import { ethers } from "hardhat";
const MANAGER = "0x1187B737EFef8C1D2563C0001553Bf6E7afe25af";
async function main() {
    const manager = await ethers.getContractAt("AdvanceManager", MANAGER);
    const id = "0xc60c21e2a23621d80f81fb78ea358bf00d90136a98bb40a95ed3e49e6f5a6d77";
    try {
        await manager.repay.staticCall(id, 504n);
        console.log("repay would succeed");
    } catch (e: any) {
        console.log("revert:", e.shortMessage ?? e.message);
        if (e.data) {
            try { console.log("decoded:", manager.interface.parseError(e.data)?.name); } catch {}
        }
    }
}
main().catch(console.error);
