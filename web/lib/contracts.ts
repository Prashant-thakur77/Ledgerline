export const ORACLE_ADDRESS = "0x4516155F9069205C6EC982214528a62973477767" as const;
export const MANAGER_ADDRESS = "0x1187B737EFef8C1D2563C0001553Bf6E7afe25af" as const;
export const POOL_ADDRESS = "0x85Ad3AcE968Ca06a8f08C928993e4A4D9a5B8296" as const;
export const FXRP_ADDRESS = "0x0b6A3645c240605887a5532109323A3E12273dc7" as const;

export const EXPLORER = "https://coston2-explorer.flare.network";

/**
 * The block `RevenueOracle` was created in. Log queries start here rather than at genesis: a public RPC
 * will refuse, or take a very long time over, a range covering the whole chain, and nothing this app cares
 * about happened before its own deployment.
 */
export const DEPLOY_BLOCK = 34012225n;

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
    {
        type: "function",
        name: "accountCreatedAt",
        stateMutability: "view",
        inputs: [{ name: "accountId", type: "bytes32" }],
        outputs: [{ type: "uint64" }],
    },
    /* Wallet rotation: a three-day public delay, cancellable by the owner the whole time. */
    {
        type: "function",
        name: "pendingNewOwner",
        stateMutability: "view",
        inputs: [{ name: "accountId", type: "bytes32" }],
        outputs: [{ type: "address" }],
    },
    {
        type: "function",
        name: "rebindReadyAt",
        stateMutability: "view",
        inputs: [{ name: "accountId", type: "bytes32" }],
        outputs: [{ type: "uint64" }],
    },
    {
        type: "function",
        name: "requestRebind",
        stateMutability: "nonpayable",
        inputs: [
            { name: "accountId", type: "bytes32" },
            { name: "newOwner", type: "address" },
        ],
        outputs: [],
    },
    {
        type: "function",
        name: "cancelRebind",
        stateMutability: "nonpayable",
        inputs: [{ name: "accountId", type: "bytes32" }],
        outputs: [],
    },
    {
        type: "function",
        name: "finalizeRebind",
        stateMutability: "nonpayable",
        inputs: [{ name: "accountId", type: "bytes32" }],
        outputs: [],
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
            // The feed's publish time — what the contract's own staleness guard measures against.
            { name: "timestamp", type: "uint64" },
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
    { type: "function", name: "keeperReserveFxrp", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    { type: "function", name: "reserveFxrp", stateMutability: "view", inputs: [{ name: "accountId", type: "bytes32" }], outputs: [{ type: "uint256" }] },
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
        name: "accountFeeBps",
        stateMutability: "view",
        inputs: [{ name: "accountId", type: "bytes32" }],
        outputs: [{ type: "uint16" }],
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
    /** The factor this account has earned under the tier schedule — every input to it is on chain. */
    {
        type: "function",
        name: "accountFactorBps",
        stateMutability: "view",
        inputs: [{ name: "accountId", type: "bytes32" }],
        outputs: [{ type: "uint16" }],
    },
    {
        type: "function",
        name: "closedCleanCycles",
        stateMutability: "view",
        inputs: [{ name: "accountId", type: "bytes32" }],
        outputs: [{ type: "uint32" }],
    },
    /** Banked overpayment from XRPL repayments; the next advance consumes it at origination. */
    {
        type: "function",
        name: "creditCents",
        stateMutability: "view",
        inputs: [{ name: "accountId", type: "bytes32" }],
        outputs: [{ type: "uint256" }],
    },
    /** What can fund an advance right now — pool liquidity in pool mode, the owner treasury otherwise. */
    {
        type: "function",
        name: "availableFunds",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint256" }],
    },
] as const;

/** The lender side: the ERC-4626 vault the app reads and LPs act on. */
export const poolAbi = [
    { type: "function", name: "totalAssets", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    { type: "function", name: "lentFxrp", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    {
        type: "function",
        name: "availableToLend",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint256" }],
    },
    {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "owner", type: "address" }],
        outputs: [{ type: "uint256" }],
    },
    {
        type: "function",
        name: "convertToAssets",
        stateMutability: "view",
        inputs: [{ name: "shares", type: "uint256" }],
        outputs: [{ type: "uint256" }],
    },
    {
        type: "function",
        name: "maxWithdraw",
        stateMutability: "view",
        inputs: [{ name: "owner", type: "address" }],
        outputs: [{ type: "uint256" }],
    },
    {
        type: "function",
        name: "deposit",
        stateMutability: "nonpayable",
        inputs: [
            { name: "assets", type: "uint256" },
            { name: "receiver", type: "address" },
        ],
        outputs: [{ type: "uint256" }],
    },
    {
        type: "function",
        name: "withdraw",
        stateMutability: "nonpayable",
        inputs: [
            { name: "assets", type: "uint256" },
            { name: "receiver", type: "address" },
            { name: "owner", type: "address" },
        ],
        outputs: [{ type: "uint256" }],
    },
] as const;

/** ERC-20 surface the lend flow needs: approve the pool, read the wallet's FXRP. */
export const erc20Abi = [
    {
        type: "function",
        name: "approve",
        stateMutability: "nonpayable",
        inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ type: "bool" }],
    },
    {
        type: "function",
        name: "allowance",
        stateMutability: "view",
        inputs: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
        ],
        outputs: [{ type: "uint256" }],
    },
    {
        type: "function",
        name: "balanceOf",
        stateMutability: "view",
        inputs: [{ name: "owner", type: "address" }],
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
