"use client";

import { useReadContract } from "wagmi";
import { usd, day } from "@/lib/contracts";

/**
 * The enclave's stored decision, read live from PrivateUnderwriter.
 *
 * The point of showing it here is that nothing on this page is a claim about the past: the decision the
 * enclave signed is on chain right now, and this component is an eth_call away from it. Green marks it
 * because a verifier contract accepted it under the registered code measurement.
 */

const PRIVATE_UNDERWRITER = "0x66cB73a6326F7e6541DA95f5fB2236d8b4f4fc4a" as const;
const ACCOUNT_ID = "0xc60c21e2a23621d80f81fb78ea358bf00d90136a98bb40a95ed3e49e6f5a6d77" as const;

const abi = [
    {
        type: "function",
        name: "privateLimitOf",
        stateMutability: "view",
        inputs: [{ name: "accountId", type: "bytes32" }],
        outputs: [
            {
                type: "tuple",
                components: [
                    { name: "limitCents", type: "uint256" },
                    { name: "factorBps", type: "uint16" },
                    { name: "feeBps", type: "uint16" },
                    { name: "computedAt", type: "uint64" },
                ],
            },
        ],
    },
] as const;

export function PrivateDecision() {
    const { data } = useReadContract({
        address: PRIVATE_UNDERWRITER,
        abi,
        functionName: "privateLimitOf",
        args: [ACCOUNT_ID],
    });

    if (!data || data.limitCents === 0n) return null;

    return (
        <div className="block" style={{ maxWidth: 760 }}>
            <span className="quiet">
                Stored on chain by the verifier, computed {day(Number(data.computedAt))}, read live just now
            </span>
            <span className="figure amount">{usd(Number(data.limitCents))}</span>
            <p className="proof" style={{ marginBottom: 0 }}>
                verified privately · factor {(Number(data.factorBps) / 100).toFixed(2)}% · fee{" "}
                {(Number(data.feeBps) / 100).toFixed(2)}% · enclave-signed, measurement-checked
            </p>
        </div>
    );
}
