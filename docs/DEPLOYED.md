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

The FDC path was proven separately in [PHASE0.md](PHASE0.md) — a real attestation verified on chain — but has
not yet been run through `RevenueOracle` specifically, because that needs a real revenue attestation, which
needs Stripe. That is the one remaining unproven link.

## Redeploying

```bash
yarn hardhat run scripts/ledgerline/deploy.ts --network coston2
```

Deploys both, funds the treasury and verifies on the explorer. Note the explorer emits a deprecation warning
about v1 API keys; verification still succeeds.
