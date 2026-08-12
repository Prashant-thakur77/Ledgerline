# Ledgerline × Flare Confidential Compute

The Phase-4 mechanism from [docs/RESOLUTIONS.md](../docs/RESOLUTIONS.md), built on Flare's own
[fce-extension-scaffold](https://github.com/flare-foundation/fce-extension-scaffold): underwriting that runs
**inside** the enclave boundary, so revenue goes in and only the decision comes out.

## What is here, and what it does

- **`typescript/src/app`** — the extension. A new `UNDERWRITE / COMPUTE_LIMIT` operation alongside the
  scaffold's stock ops: it receives an account's revenue periods, re-validates them (non-overlapping,
  ascending — an enclave that trusts its caller is just a server with extra steps), runs the *same* tier
  arithmetic `AdvanceManager` uses (BigInt, Solidity truncation), and returns
  `{accountId, limitCents, factorBps, feeBps, periodsUsed, computedAt}`. **No revenue figure appears in the
  output or in reportable state** — there is a test asserting exactly that.
- **`../contracts/ledgerline/PrivateUnderwriter.sol`** — the on-chain half. Stores a decision only under a
  valid enclave signature over the decision *and the registered code measurement*, with staleness and
  replay guards. Changing the underwriting policy changes the hash: a public, governed rollout.
- The policy constants live in the extension source — in the attested code — which is the entire point.

## What is verified

- The stock scaffold's **16 golden wire-conformance fixtures still pass** with the new op registered
  (`./scripts/test-conformance.sh typescript` — no chain, no Docker, no infrastructure).
- **66 vitest tests** (54 stock + 12 for the underwriting op, including the recycling bound, the collapse
  pricing, and the nothing-but-the-decision output check).
- **7 Hardhat tests** on `PrivateUnderwriter` in the main suite (wrong signer, wrong measurement, tampered
  figures, stale/future/replayed decisions).

## It is registered, and it ran

The extension is live on Flare's shared TEE platform on Coston2, and our own operation — not the
scaffold's greeting — has been executed by it end to end.

| | |
|---|---|
| Extension ID | **66180** (`0x10284`) |
| InstructionSender | [`0xd7DADF66AF4dA4C5FF0Ccdcccc77db1a46520341`](https://coston2-explorer.flare.network/address/0xd7DADF66AF4dA4C5FF0Ccdcccc77db1a46520341) |
| TEE machine | `0x0f42321d590876FC4aEC0DfaA13c5993e8B22103` — status **2 (PRODUCTION)**, sole active machine for 66180 |
| Attested code hash | `0x194844cf417dde867073e5ab7199fa4d21fd82b5dbe2bdea8b3d7fc18d10fdc2` (platform `TEST_PLATFORM`) |
| Governance | 1 signer, threshold 1, hash `0x4d582fb73a5476a8a4a9bad4bd02be3642575fb2b5093aaa90d34e459e10090d` |

The live `UNDERWRITE / COMPUTE_LIMIT` run:

- **tx** [`0x7b77dc2fe6e733761c35568f8ff013b74f3d98a408642a57e770c38b0f864131`](https://coston2-explorer.flare.network/tx/0x7b77dc2fe6e733761c35568f8ff013b74f3d98a408642a57e770c38b0f864131) (block 33,981,358)
- **instruction** `0x95bdc4ca15000b9a7d22745c3989eb61f903964e5edf825292fe89125372d6c7`
- **in**: one proven period worth $3,916.78. **out**: `{limitCents: 9791, factorBps: 250, feeBps: 890, periodsUsed: 1}`

$97.91 — the same figure the public `AdvanceManager` path produces for the same account, which is the
claim worth making: privacy here costs nothing in correctness. The revenue went in and did not come back
out. Reproduce it with `tools/cmd/run-underwrite`, which sends the instruction on chain and polls the
proxy for the enclave's answer.

**The key never leaves the enclave.** A second product op, `UNDERWRITE / COMPUTE_LIMIT_FROM_SOURCE`,
closes the public path's one unavoidable disclosure: FDC data providers each call the processor's API, so
the API key rides in public calldata. In this op the instruction carries only an account reference and a
month window; the enclave holds the key, calls Stripe itself, and returns the decision. Run live through
the platform on extension **66184** (sender `0x08c4b3B1…`, machine `0x361bB261…` at PRODUCTION):
[`0x8a9e9593…`](https://coston2-explorer.flare.network/tx/0x8a9e95937a1843ec76164b5db1fc1633ea274c0bb45137a1635c37d18ed68e88)
— calldata verifiably contains no credential and no figure, and the decision is $97.91 again. The trust
trade is explicit: the public path trusts the provider quorum to have read the API honestly; this path
trusts the attested enclave to have. Reproduce with `tools/cmd/run-underwrite-source`.

Getting there needed the pinned Coston2 indexer credentials, a stable public HTTPS tunnel for the
extension proxy, and the current pinned version set. Two things cost us the most time and are worth
writing down: the TEE container bakes its `EXTENSION_ID` at start, so a new extension needs the services
recreated rather than restarted — otherwise every tool silently registers against the old one; and the Go
tools read `.env` from the project root, so running them from `tools/` falls back to an unfunded Hardhat
key and reverts with a bare `execution reverted`.

**What is still not claimed:** this runs `SIMULATED_TEE=true` — organizer-supported on Coston2 and
registered through to PRODUCTION, but the code measurement is reported by the proxy rather than attested
by real confidential hardware. That upgrade is a production cost (💰) noted in the resolutions map. It
changes **who vouches for the measurement**, not how anything above is verified.

## Run it

```bash
cd fcc && ./scripts/test-conformance.sh typescript   # 16/16, no infrastructure
cd fcc/typescript && npx vitest run                  # 66 tests
npx hardhat test test/PrivateUnderwriter.test.ts     # from the repo root
```

Against the live platform (needs the services up, a public proxy tunnel, and a funded key in `fcc/.env`):

```bash
cd fcc
./scripts/start-services.sh && ./scripts/pre-build.sh && ./scripts/post-build.sh
./scripts/test.sh                                    # the scaffold's ops, through real data providers
set -a; source ./.env; set +a                        # the Go tools read .env from the project root
cd tools && go run ./cmd/run-underwrite \
  -a ../config/coston2/deployed-addresses.json \
  -c "$CHAIN_URL" -p "$EXT_PROXY_URL" \
  -instructionSender "$INSTRUCTION_SENDER" \
  -input ../../docs/examples/underwrite-request.json
```

Everything outside `typescript/src/app`, `README.md` and this directory's test additions is the scaffold
as Flare ships it, kept intact so the delta — what we actually built — is one `diff` away.
