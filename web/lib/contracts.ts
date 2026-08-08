export const ORACLE_ADDRESS = "0x47C6d20206AbD9413d345d45c65aB8a074Ca28a8" as const;
export const MANAGER_ADDRESS = "0x5774E51335277893c5f177bb6735b4CF2fE76A63" as const;
export const FXRP_ADDRESS = "0x0b6A3645c240605887a5532109323A3E12273dc7" as const;

export const EXPLORER = "https://coston2-explorer.flare.network";

export const oracleAbi = [
    {
        type: "function",
        name: "accountIdFor",
        stateMutability: "pure",
        inputs: [
            { name: "platform", type: "string" },
            { name: "accountRef", type: "string" },
        ],
        outputs: [{ type: "bytes32" }],
    },
    {
        type: "function",
        name: "revenueHistory",
        stateMutability: "view",
        inputs: [{ name: "accountId", type: "bytes32" }],
        outputs: [
            {
                type: "tuple[]",
                components: [
                    { name: "revenueCents", type: "uint256" },
                    { name: "periodStart", type: "uint64" },
                    { name: "periodEnd", type: "uint64" },
                    { name: "provenAt", type: "uint64" },
                ],
            },
        ],
    },
    {
        type: "function",
        name: "accountOwner",
        stateMutability: "view",
        inputs: [{ name: "accountId", type: "bytes32" }],
        outputs: [{ type: "address" }],
    },
] as const;

export const managerAbi = [
    {
        type: "function",
        name: "advanceLimitCents",
        stateMutability: "view",
        inputs: [{ name: "accountId", type: "bytes32" }],
        outputs: [{ type: "uint256" }],
    },
    {
        type: "function",
        name: "currentXrpUsd",
        stateMutability: "nonpayable",
        inputs: [],
        outputs: [
            { name: "price", type: "uint256" },
            { name: "decimals", type: "int8" },
        ],
    },
    {
        type: "function",
        name: "usdCentsToFxrp",
        stateMutability: "view",
        inputs: [
            { name: "usdCents", type: "uint256" },
            { name: "price", type: "uint256" },
            { name: "priceDecimals", type: "int8" },
        ],
        outputs: [{ type: "uint256" }],
    },
    {
        type: "function",
        name: "requestAdvance",
        stateMutability: "nonpayable",
        inputs: [
            { name: "accountId", type: "bytes32" },
            { name: "usdCents", type: "uint256" },
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "advanceOf",
        stateMutability: "view",
        inputs: [{ name: "accountId", type: "bytes32" }],
        outputs: [
            {
                type: "tuple",
                components: [
                    { name: "principalCents", type: "uint256" },
                    { name: "feeCents", type: "uint256" },
                    { name: "outstandingCents", type: "uint256" },
                    { name: "fxrpDisbursed", type: "uint256" },
                    { name: "openedAt", type: "uint64" },
                    { name: "lastActivityAt", type: "uint64" },
                    { name: "lastAppliedPeriodEnd", type: "uint64" },
                    { name: "open", type: "bool" },
                    { name: "delinquent", type: "bool" },
                    { name: "avgRevenueCents", type: "uint256" },
                    { name: "xrpUsdPrice", type: "uint256" },
                    { name: "periodsUsed", type: "uint8" },
                    { name: "factorBps", type: "uint16" },
                    { name: "priceDecimals", type: "int8" },
                ],
            },
        ],
    },
    { type: "function", name: "feeBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
    {
        type: "function",
        name: "repaymentShareBps",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint16" }],
    },
    {
        type: "function",
        name: "treasuryBalance",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint256" }],
    },
] as const;

export const usd = (cents: bigint | number) =>
    `$${(Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fxrp = (raw: bigint) => (Number(raw) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });

export const price = (value: bigint, decimals: number) => `$${(Number(value) / 10 ** decimals).toFixed(6)}`;

export const day = (unix: bigint | number) => new Date(Number(unix) * 1000).toISOString().slice(0, 10);
