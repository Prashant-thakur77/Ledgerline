/**
 * The Flare protocol surface the browser talks to directly.
 *
 * Everything here exists so an attestation can be driven from the page rather than from a terminal. The
 * long wait — a voting round has to close and finalise before a proof exists — happens in the browser's own
 * polling loop, which means it works on any host and cannot hit a serverless timeout.
 *
 * Addresses are resolved through Flare's own ContractRegistry rather than pasted in, so this keeps working
 * if the network moves a contract. The values below are what the registry returned on Coston2 and are used
 * only as a fallback if that lookup fails.
 */

export const CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019" as const;

/** Resolved from ContractRegistry on Coston2. Fallbacks only — the app looks them up at runtime. */
export const KNOWN = {
    FdcHub: "0x48aC463d7975828989331F4De43341627b9c5f1D",
    FdcRequestFeeConfigurations: "0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e",
    FdcVerification: "0x906507E0B64bcD494Db73bd0459d1C667e14B933",
    FlareSystemsManager: "0xA90Db6D10F856799b10ef2A77EBCbF460aC71e52",
    Relay: "0xa10B672D1c62e5457b17af63d4302add6A99d7dE",
} as const;

export type FlareContract = keyof typeof KNOWN;

/** FDC's protocol id inside the Relay. Read from FdcVerification at runtime; 200 on every network so far. */
export const FDC_PROTOCOL_ID = 200;

/** A voting round is 90 seconds on Coston2, counted from this genesis. Read at runtime, defaulted here. */
export const VOTING_EPOCH = { firstStartTs: 1658430000, durationSeconds: 90 } as const;

/**
 * Rounds do not finalise the moment they close: the round has to close, then the providers' signatures have
 * to be relayed. Measured on Coston2, `getCurrentVotingEpochId() - 2` is the newest finalised round, so a
 * request submitted mid-round waits out the rest of that round plus two more, then the DA layer needs a
 * moment to build the Merkle proof. Three to five minutes, end to end.
 */
export const FINALISATION_LAG_ROUNDS = 2;

export const registryAbi = [
    {
        type: "function",
        name: "getContractAddressByName",
        stateMutability: "view",
        inputs: [{ name: "_name", type: "string" }],
        outputs: [{ type: "address" }],
    },
] as const;

export const fdcHubAbi = [
    {
        type: "function",
        name: "requestAttestation",
        stateMutability: "payable",
        inputs: [{ name: "_data", type: "bytes" }],
        outputs: [],
    },
] as const;

export const feeConfigAbi = [
    {
        type: "function",
        name: "getRequestFee",
        stateMutability: "view",
        inputs: [{ name: "_data", type: "bytes" }],
        outputs: [{ type: "uint256" }],
    },
] as const;

export const systemsManagerAbi = [
    {
        type: "function",
        name: "firstVotingRoundStartTs",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint64" }],
    },
    {
        type: "function",
        name: "votingEpochDurationSeconds",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint64" }],
    },
    {
        type: "function",
        name: "getCurrentVotingEpochId",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint32" }],
    },
] as const;

export const relayAbi = [
    {
        type: "function",
        name: "isFinalized",
        stateMutability: "view",
        inputs: [
            { name: "_protocolId", type: "uint256" },
            { name: "_votingRoundId", type: "uint256" },
        ],
        outputs: [{ type: "bool" }],
    },
    {
        type: "function",
        name: "merkleRoots",
        stateMutability: "view",
        inputs: [
            { name: "_protocolId", type: "uint256" },
            { name: "_votingRoundId", type: "uint256" },
        ],
        outputs: [{ type: "bytes32" }],
    },
] as const;

export const fdcVerificationAbi = [
    { type: "function", name: "fdcProtocolId", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

/** `submitAttestation` takes the proof exactly as the DA layer returns it, re-encoded as the contract's struct. */
export const submitAttestationAbi = [
    {
        type: "function",
        name: "submitAttestation",
        stateMutability: "nonpayable",
        inputs: [
            { name: "claimedAccountId", type: "bytes32" },
            {
                name: "proof",
                type: "tuple",
                components: [
                    { name: "merkleProof", type: "bytes32[]" },
                    {
                        name: "data",
                        type: "tuple",
                        components: [
                            { name: "attestationType", type: "bytes32" },
                            { name: "sourceId", type: "bytes32" },
                            { name: "votingRound", type: "uint64" },
                            { name: "lowestUsedTimestamp", type: "uint64" },
                            {
                                name: "requestBody",
                                type: "tuple",
                                components: [
                                    { name: "url", type: "string" },
                                    { name: "httpMethod", type: "string" },
                                    { name: "headers", type: "string" },
                                    { name: "queryParams", type: "string" },
                                    { name: "body", type: "string" },
                                    { name: "postProcessJq", type: "string" },
                                    { name: "abiSignature", type: "string" },
                                ],
                            },
                            {
                                name: "responseBody",
                                type: "tuple",
                                components: [{ name: "abiEncodedData", type: "bytes" }],
                            },
                        ],
                    },
                ],
            },
        ],
        outputs: [],
    },
] as const;

/**
 * The ABI-encoded shape the DA layer hands back inside `response_hex`, and the shape the contract expects.
 * Kept as viem parameter descriptors so the page can decode the response and re-encode it as a call argument.
 */
export const web2JsonResponseType = [
    {
        type: "tuple",
        components: [
            { name: "attestationType", type: "bytes32" },
            { name: "sourceId", type: "bytes32" },
            { name: "votingRound", type: "uint64" },
            { name: "lowestUsedTimestamp", type: "uint64" },
            {
                name: "requestBody",
                type: "tuple",
                components: [
                    { name: "url", type: "string" },
                    { name: "httpMethod", type: "string" },
                    { name: "headers", type: "string" },
                    { name: "queryParams", type: "string" },
                    { name: "body", type: "string" },
                    { name: "postProcessJq", type: "string" },
                    { name: "abiSignature", type: "string" },
                ],
            },
            { name: "responseBody", type: "tuple", components: [{ name: "abiEncodedData", type: "bytes" }] },
        ],
    },
] as const;

/** The payload the jq reduction produces, and which RevenueOracle decodes. */
export const revenueDtoType = [
    {
        type: "tuple",
        components: [
            { name: "platform", type: "string" },
            { name: "accountRef", type: "string" },
            { name: "revenueCents", type: "uint256" },
            { name: "periodStart", type: "uint256" },
            { name: "periodEnd", type: "uint256" },
        ],
    },
] as const;

/** Which voting round a transaction mined at `blockTimestamp` belongs to. */
export function roundIdForTimestamp(blockTimestamp: bigint, firstStartTs: bigint, duration: bigint): number {
    return Number((blockTimestamp - firstStartTs) / duration);
}

/** Seconds until a given round closes. Negative once it has closed. */
export function secondsUntilRoundCloses(roundId: number, firstStartTs: bigint, duration: bigint): number {
    const closesAt = Number(firstStartTs) + (roundId + 1) * Number(duration);
    return closesAt - Math.floor(Date.now() / 1000);
}

/** Flare's own systems explorer, where a judge can watch the round the request landed in. */
export function votingRoundUrl(roundId: number | bigint) {
    return `https://coston2-systems-explorer.flare.network/voting-round/${roundId}?tab=fdc`;
}
