# Deployed — Coston2 (chain id 114)

Deployed 2026-08-08 from `0x5c051991900E6202430d28B26c9D21C7C23ef290`. Both contracts are source-verified on
the explorer.

| Contract | Address |
|---|---|
| `RevenueOracle` | [`0x47C6d20206AbD9413d345d45c65aB8a074Ca28a8`](https://coston2-explorer.flare.network/address/0x47C6d20206AbD9413d345d45c65aB8a074Ca28a8#code) |
| `AdvanceManager` | [`0x5774E51335277893c5f177bb6735b4CF2fE76A63`](https://coston2-explorer.flare.network/address/0x5774E51335277893c5f177bb6735b4CF2fE76A63#code) |
| FXRP (`FTestXRP`, 6 decimals) | [`0x0b6A3645c240605887a5532109323A3E12273dc7`](https://coston2-explorer.flare.network/address/0x0b6A3645c240605887a5532109323A3E12273dc7) |

Flare infrastructure the contracts reach through `ContractRegistry`
(`0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`): `FdcVerification` for Web2Json proofs, `FtsoV2`
(`0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d`) for XRP/USD.

Treasury: **5 FXRP** deposited, half of the faucet's 10, leaving the rest to demonstrate repayment.

## What deployment proved that the tests could not

The unit tests stub two calls that only exist on a real Flare network — the FDC proof check and the FTSO read.
Deployment exercised the second for real: `AdvanceManager.currentXrpUsd()` returned **1042777 with 6 decimals**
($1.042777) read by the contract itself through `ContractRegistry.getFtsoV2()`. So the production price path is
confirmed, not merely mocked.

## The full path, run on Coston2

Both halves have now been exercised on the live network, end to end, with a real Merkle proof.

**1. Revenue proven** — `scripts/ledgerline/attest-revenue.ts` composed a Web2Json request, waited for the
voting round, fetched a three-hash Merkle proof from the DA layer, and `RevenueOracle` verified it before
storing anything.

| | |
|---|---|
| Attested | `demo/acct_1LedgerlineDemo`, $4,000.00 for the period ending 2026-01-31 |
| accountId | `0x34a8416dabdab6d4ef020abb613ccf8e221f89694f8537ae1ea4349e5e3ad946` |
| tx | [`0x631254849a82a3bfb5a12ab83f6d64e36c6cbaa3b682a55962d1d6c449336f8d`](https://coston2-explorer.flare.network/tx/0x631254849a82a3bfb5a12ab83f6d64e36c6cbaa3b682a55962d1d6c449336f8d) |

The source here is the keyless public stand-in from `revenue-sources.ts`, not Stripe — it reduces to the
identical DTO so that the verifier, the proof, the decode and every guard in `RevenueOracle` are exercised
against a genuine attestation. Swapping in `stripeSource` changes the URL, the headers and the jq, and nothing
else. That substitution is the only part of the pipeline still unproven.

**2. Advance issued** — `scripts/ledgerline/take-advance.ts`:

| | |
|---|---|
| Limit from the proven revenue | $4,000.00 (mean of 1 period × 1.0x) |
| Requested | $2.00 |
| FXRP actually sent | **1.917837** |
| Owed | **$2.10** — $2.00 principal plus a $0.10 fee, in dollars |
| XRP/USD recorded on the advance | $1.042841 |
| tx | [`0xb00b122609c092294e4b8b881017c7b7a9f70cf0e8284713e528d9370ad0bb88`](https://coston2-explorer.flare.network/tx/0xb00b122609c092294e4b8b881017c7b7a9f70cf0e8284713e528d9370ad0bb88) |

Worth noting for the demo: the script quoted 1.918772 FXRP from an `eth_call` a second before the transaction,
and the transaction sent 1.917837 at a rate of $1.042841 rather than the quoted $1.042333. The feed moved
between the quote and the execution. That is FTSOv2 being live rather than cached, and the dollar obligation
was unaffected by it — which is the entire argument for denominating in dollars.

## Redeploying

```bash
yarn hardhat run scripts/ledgerline/deploy.ts --network coston2
```

Deploys both, funds the treasury and verifies on the explorer. Note the explorer emits a deprecation warning
about v1 API keys; verification still succeeds.
