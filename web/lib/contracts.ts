export const ORACLE_ADDRESS = "0x80D08369E1a34e8c7C43FCF947323e56e6B87Be6" as const;
export const MANAGER_ADDRESS = "0x4EC83Eb966dcac3e4291c85320Cfd6941a7C4f66" as const;
export const FXRP_ADDRESS = "0x0b6A3645c240605887a5532109323A3E12273dc7" as const;

export const EXPLORER = "https://coston2-explorer.flare.network";

/**
 * The block `RevenueOracle` was created in. Log queries start here rather than at genesis: a public RPC
 * will refuse, or take a very long time over, a range covering the whole chain, and nothing this app cares
 * about happened before its own deployment.
 */
export const DEPLOY_BLOCK = 33_798_869n;

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
                    { name: "votingRound", type: "uint64" },
                    { name: "merkleRoot", type: "bytes32" },
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
    { type: "function", name: "lotSize", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    {
        type: "function",
        name: "fxrpToUsdCents",
        stateMutability: "view",
        inputs: [
            { name: "fxrpRaw", type: "uint256" },
            { name: "price", type: "uint256" },
            { name: "priceDecimals", type: "int8" },
        ],
        outputs: [{ type: "uint256" }],
    },
    {
        type: "function",
        name: "requestAdvanceToXrpl",
        stateMutability: "nonpayable",
        inputs: [
            { name: "accountId", type: "bytes32" },
            { name: "lots", type: "uint256" },
            { name: "xrplAddress", type: "string" },
        ],
        outputs: [],
    },
    /**
     * The XRPL account a borrower repays to. Empty when the XRPL repayment leg is not configured, which is
     * how the interface decides whether to offer it at all.
     */
    {
        type: "function",
        name: "xrplTreasuryAddress",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "string" }],
    },
    {
        type: "function",
        name: "xrpDropsToUsdCents",
        stateMutability: "pure",
        inputs: [
            { name: "drops", type: "uint256" },
            { name: "price", type: "uint256" },
            { name: "priceDecimals", type: "int8" },
        ],
        outputs: [{ type: "uint256" }],
    },
] as const;

/** One XRP is a million drops. */
export const DROPS_PER_XRP = 1_000_000n;

/** Where an XRPL transaction can be inspected. */
export const xrplTxUrl = (hash: string) => `${XRPL_EXPLORER}/transactions/${hash}`;

export const XRPL_EXPLORER = "https://testnet.xrpl.org";

export const usd = (cents: bigint | number) =>
    `$${(Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fxrp = (raw: bigint) => (Number(raw) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 });

export const price = (value: bigint, decimals: number) => `$${(Number(value) / 10 ** decimals).toFixed(6)}`;

export const day = (unix: bigint | number) => new Date(Number(unix) * 1000).toISOString().slice(0, 10);
