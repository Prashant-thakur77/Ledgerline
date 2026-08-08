# Phase 0 — risk validation

Run date: 2026-08-08 (UTC). Network: Coston2, chain id 114 (`eth_chainId` → `0x72`, verified).

Status: **2 of 4 checks passed outright, 2 blocked on credentials only a human can supply.**
See [BLOCKERS.md](BLOCKERS.md) for the two open items.

## Environment

| Component | Version |
|---|---|
| Base repo | `flare-hardhat-starter`, shallow clone 2026-08-08 |
| Node | v20.19.6 |
| npm / yarn | 10.8.2 / yarn install (exit 0, 888 packages) |
| solc | 0.8.25 (263 contracts compiled clean) |
| jq | 1.8.1 |
| Coston2 RPC | `https://coston2-api.flare.network/ext/C/rpc` |

Dev wallet generated for this work: `0x5c051991900E6202430d28B26c9D21C7C23ef290` (throwaway, testnet only, key in
`.env` which is gitignored). Balance at time of writing: **0**.

## 0.1 — Web2Json attestation

**Verifier reachable and returns a valid request: PASSED.**

The brief said the all-zeros verifier key returns 401 and a real key must be obtained first. **That is wrong as of
2026-08-08.** `00000000-0000-0000-0000-000000000000` is the documented public testnet key and it works. Proven:

```
POST https://fdc-verifiers-testnet.flare.network/verifier/web2/Web2Json/prepareRequest
X-API-KEY: 00000000-0000-0000-0000-000000000000
→ HTTP 200  {"status":"VALID","abiEncodedRequest":"0x576562324a736f6e00…"}
```

Encodings confirmed by hand (the starter's helper does this, but the values are worth having written down):

| Field | Value |
|---|---|
| `attestationType` "Web2Json" | `0x576562324a736f6e` + 48 zeros |
| `sourceId` "PublicWeb2" | `0x5075626c69635765623200…` |
| verifier endpoint | `{VERIFIER_URL_TESTNET}/verifier/web2/Web2Json/prepareRequest` |
| DA layer | `https://ctn2-data-availability.flare.network` |

**On-chain submission and proof retrieval: NOT YET RUN** — needs a funded wallet. This is the one remaining
technical unknown in the whole project, and it is gated purely on gas.

### Finding: the attestation request is public, in plaintext

Decoding the `abiEncodedRequest` the verifier returned recovers every field as readable ASCII:

```
url field      -> https://swapi.info/api/people/3
headers field  -> {}
```

The request is submitted to `FdcHub` on-chain. Therefore **anything placed in `headers` is published to a public
blockchain in the clear.** This has a direct consequence for Phase 3 — see BLOCKERS.md item 2.

## 0.2 — Stripe revenue attestation

**BLOCKED**, on two independent things: no Stripe account, and a design problem the brief does not address.

Verified empirically that the payouts endpoint is not publicly readable:

```
GET https://api.stripe.com/v1/payouts?limit=3   (no auth)
→ HTTP 401  "You did not provide an API key… Authorization header, using Bearer auth"
```

Combined with the finding above: attesting Stripe directly means publishing a Stripe secret key on chain.

## 0.3 — FTSOv2 XRP/USD

**PASSED.** Script: [`scripts/ledgerline/phase0-ftso.ts`](../scripts/ledgerline/phase0-ftso.ts) (read-only, needs no funds).

| Contract | Address |
|---|---|
| `ContractRegistry` | `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` (identical on all Flare networks) |
| `FtsoV2` (Coston2, resolved via registry) | `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d` |

Live read at 2026-08-08T21:01:43Z:

| Feed | feedId | value | decimals | price |
|---|---|---|---|---|
| XRP/USD | `0x015852502f55534400…` | 1041868 | **6** | $1.041868 |
| FLR/USD | `0x01464c522f55534400…` | 608997 | **8** | $0.00608997 |

Feed id construction: `0x01` (crypto category) + ASCII name, right-padded with zeros to 21 bytes total.

**Decimals differ per feed — 6 for XRP/USD, 8 for FLR/USD.** Do not hardcode 18, and do not assume one feed's
decimals apply to another. Every USD↔FXRP conversion must read `decimals` from the same call that returns the
value. This is precisely the "silently wrong" money bug the brief warns about, and it is now a required test.

## 0.4 — FXRP on Coston2

**Not obtained (needs the faucet, which needs a human), but the route is easier than the brief assumed.**

The brief says the faucet no longer hands out FXRP and that FAssets minting or a MockFXRP fallback would be
needed. As of 2026-08-08 the Coston2 faucet dispenses **100 C2FLR, 10 USDT0 and 10 FXRP per address per 24
hours** — FXRP directly. So the MockFXRP fallback is very likely unnecessary, which removes an honesty caveat
that would otherwise have gone in the submission.

10 FXRP is small for demonstrating advances. If the demo needs more, either claim across several addresses or
mint through FAssets as originally planned. Decide once the treasury sizing is known.
