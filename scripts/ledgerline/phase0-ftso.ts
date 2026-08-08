// Phase 0.3 — read XRP/USD from FTSOv2 on Coston2.
// Read-only: needs no funded wallet.
//   yarn hardhat run scripts/ledgerline/phase0-ftso.ts --network coston2
import { ethers } from "hardhat";

// Flare feed id = 1 byte category (0x01 = crypto) + ascii name padded right to 20 bytes.
function feedId(name: string): string {
    const ascii = Buffer.from(name, "ascii").toString("hex");
    return "0x01" + ascii.padEnd(40, "0");
}

const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019"; // same on every Flare network

async function main() {
    const registry = await ethers.getContractAt(
        ["function getContractAddressByName(string) view returns (address)"],
        REGISTRY
    );
    const ftsoV2Addr: string = await registry.getContractAddressByName("FtsoV2");
    console.log("ContractRegistry :", REGISTRY);
    console.log("FtsoV2           :", ftsoV2Addr);

    const ftsoV2 = await ethers.getContractAt(
        [
            "function getFeedById(bytes21) view returns (uint256 value, int8 decimals, uint64 timestamp)",
            "function getFeedByIdInWei(bytes21) view returns (uint256 value, uint64 timestamp)",
        ],
        ftsoV2Addr
    );

    for (const name of ["XRP/USD", "FLR/USD"]) {
        const id = feedId(name);
        const [value, decimals, timestamp] = await ftsoV2.getFeedById.staticCall(id);
        const human = Number(value) / 10 ** Number(decimals);
        console.log(
            `\n${name}\n  feedId    : ${id}\n  value     : ${value}\n  decimals  : ${decimals}\n  price     : $${human}\n  timestamp : ${new Date(Number(timestamp) * 1000).toISOString()}`
        );
    }
}

void main().then(() => process.exit(0));
