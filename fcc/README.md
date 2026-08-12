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
- **60 vitest tests** (54 stock + 6 for the underwriting op, including the recycling bound, the collapse
  pricing, and the nothing-but-the-decision output check).
- **7 Hardhat tests** on `PrivateUnderwriter` in the main suite (wrong signer, wrong measurement, tampered
  figures, stale/future/replayed decisions).

## What is deliberately not claimed

Registration on Flare's shared TEE platform is access-gated, and the shape of that gate matters:
the scaffold's deployment docs describe a VPN-gated indexer, but that applies to **Coston**. Per the
hackathon channel, **Coston2's** indexer (34.38.42.208:3306) is reachable with read-only hackathon
credentials pinned in the official Telegram, and `SIMULATED_TEE=true` machines are organizer-supported
through to PRODUCTION. So registration here is achievable rather than blocked; it needs the pinned
credentials, a stable public HTTPS tunnel for the extension proxy, and the current pinned version set —
and the channel shows teams losing hours to proxy 404s and version skew even so. This integration
currently stops at the line before that infrastructure gauntlet:
the extension is wire-conformant and the verifier contract is tested, and until platform registration the
"enclave key" is whatever governance sets. Registration upgrades **who holds the key**, not how anything
is verified. `SIMULATED_TEE=true` runs the whole stack on a laptop; real confidential hardware is a
production cost (💰) noted in the resolutions map.

## Run it

```bash
cd fcc && ./scripts/test-conformance.sh typescript   # 16/16, no infrastructure
cd fcc/typescript && npx vitest run                  # 60 tests
npx hardhat test test/PrivateUnderwriter.test.ts     # from the repo root
```

Everything outside `typescript/src/app`, `README.md` and this directory's test additions is the scaffold
as Flare ships it, kept intact so the delta — what we actually built — is one `diff` away.
