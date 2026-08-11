# Deployed — Coston2 (chain id 114)

Deployed 2026-08-08 from `0x5c051991900E6202430d28B26c9D21C7C23ef290`. Both contracts are source-verified on
the explorer.

| Contract | Address |
|---|---|
| `RevenueOracle` | [`0x80D08369E1a34e8c7C43FCF947323e56e6B87Be6`](https://coston2-explorer.flare.network/address/0x80D08369E1a34e8c7C43FCF947323e56e6B87Be6#code) |
| `AdvanceManager` (v2, with the XRPL leg) | [`0x63fC5a5c422D40DcC8FA267384BA5351d8698A58`](https://coston2-explorer.flare.network/address/0x63fC5a5c422D40DcC8FA267384BA5351d8698A58#code) |
| `AdvanceManager` (v1, superseded) | [`0x5774E51335277893c5f177bb6735b4CF2fE76A63`](https://coston2-explorer.flare.network/address/0x5774E51335277893c5f177bb6735b4CF2fE76A63#code) |
| FAssets `AssetManager` (FXRP) | [`0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`](https://coston2-explorer.flare.network/address/0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA) |
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

## The XRPL leg

`requestAdvanceToXrpl` redeems the advance through FAssets instead of transferring FXRP, so a FAssets agent
pays the borrower's XRP Ledger account directly.

| | |
|---|---|
| Flare tx | [`0x96ec23d1…`](https://coston2-explorer.flare.network/tx/0x96ec23d1a6a66fae6a71d3a8c67bd9d5b158d706d04de49d36b3d7ba198922ff) |
| XRPL payment | [`784C8E73…`](https://testnet.xrpl.org/transactions/784C8E73E1417C2600F7E6473FEE3CB43DEABFCDA008192789AB81F3BFD41534) |
| Paid by agent | `r4GHJwGSaGmJy9BBXS9osFXqRjqdSm7v83` |
| Destination | `rpcBsvdaL4eCkK64nNsQB1PQf4hm2Dq3Sc`, balance 100 → **109.95 XRP** |
| Debt recorded | $10.92 ($10.40 at $1.040793, plus a $0.52 fee) |

The agent paid within about fifteen seconds. It kept 0.05 XRP as the redemption fee, which is why 10 lots-worth
arrived as 9.95.

### Two things that will bite anyone reproducing this

**Redemption is in whole lots, 10 XRP each.** There is no way to redeem $2. `requestAdvanceToXrpl` therefore
takes a lot count rather than a dollar amount, and computes the dollar debt from what was actually redeemed.

**`eth_estimateGas` under-estimates the redemption.** The first attempt reverted having consumed exactly its
estimate — redemption walks the redemption ticket queue, and the estimate does not account for it. The script
passes an explicit `gasLimit` of 6,000,000. A simulation with `staticCall` succeeds either way, so this failure
looks mysterious until you notice `gasUsed` equals the limit.

## Redeploying

```bash
yarn hardhat run scripts/ledgerline/deploy.ts --network coston2
```

Deploys both, funds the treasury and verifies on the explorer. Note the explorer emits a deprecation warning
about v1 API keys; verification still succeeds.
