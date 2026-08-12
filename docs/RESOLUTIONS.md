# Resolving the shortcomings — the complete map

Every known shortcoming, the mechanism that actually resolves it, what "resolved" means, and what it
costs. 💰 marks items that cost real money — everything else is testnet tokens and free tiers. Items marked
**BUILT** landed in this repository; **DESIGNED** means the mechanism is specified here and waiting on an
external dependency, not on code.

---

## 1. Unsecured credit with no recourse

**The gap:** honest failure is unrecoverable; delinquency only blocks the future.

| Mechanism | Status |
|---|---|
| **Junior first-loss tranche.** Protocol-owned capital sits under LP shares; write-offs consume it before touching the share price. Seniors are whole until the buffer is gone, and the buffer's depth is public. | **BUILT** — `LenderPool.fundJunior` / `juniorAssets` |
| **Risk-priced fees.** Expected loss is priced, not hoped away: the origination fee carries a premium proportional to how far the account sits below the tier cap. Tier-0 borrowers pay for the book's risk; proven accounts converge to the base fee. | **BUILT** — `riskPremiumBps` |
| **Collection at source.** Production integration as a Stripe Connect platform: repayment share routed from payouts before they reach the borrower — how Pipe and Wayflyer actually collect. Voluntary repayment becomes structural. | DESIGNED — needs platform onboarding; 💰 live mode needs a business entity |
| **Cross-protocol delinquency registry.** The events already exist; formalising them into an attestable registry makes a Ledgerline default legible to every other lender. Reputation as recourse. | DESIGNED |

**Resolved when:** a written-off cohort leaves senior LPs whole up to the junior depth, and realised default
rates reconcile against collected risk premiums.

## 2. The cold start (tier 0 too small to be useful)

**The gap:** 2.5% of monthly revenue is safe but nearly useless; five clean cycles take months.

| Mechanism | Status |
|---|---|
| **History depth as its own term.** Non-overlapping proven months now count toward the factor independently of repayment cycles — an account that imports twelve months of real history starts materially above base without weakening the recycling bound (fabricating a *year* of history costs a year of card fees). | **BUILT** — `historyStepBps` |
| **Payer diversity attestation.** A jq that counts distinct customers per period; fabricated revenue from one funding source cannot fake a customer base. Gates the upper tiers. | DESIGNED — needs a DTO addition, next oracle version |
| **Credit delegation.** A staker vouches for a specific borrower with slashable stake, buying them tier early; the market prices what the algorithm cannot see yet. | DESIGNED |

**Resolved when:** a genuine 12-month-old account reaches a useful limit (≥25% factor) on day one without
opening the recycling attack (fabrication cost still exceeds tier-0 extraction).

## 3. Key custody = ownership

**The gap:** whoever holds the read-only key first binds the account; a stolen key is a stolen identity.

| Mechanism | Status |
|---|---|
| **Wallet rotation with a timelock.** The bound owner can move the account to a new wallet behind a 3-day delay, cancellable throughout — so a thief's rotation is visible and stoppable, and a compromised-but-not-lost wallet is recoverable. | **BUILT** — `requestRebind` / `cancelRebind` / `finalizeRebind` |
| **OAuth binding ceremony.** Production binding happens inside a Stripe Connect OAuth session — the wallet signs during an authenticated session, the key is platform-held and never touches the user or the chain. Possession of credentials stops being the identity; an authenticated session is. | DESIGNED — 💰 live mode needs a business entity |
| **Keys inside the enclave** (see 5). | DESIGNED |

**Resolved when:** binding requires an authenticated platform session, and no long-lived credential exists
outside the enclave.

## 4. Public revenue is the adoption ceiling

**The gap:** no real business publishes monthly revenue on a public chain.

**Mechanism:** Flare Confidential Compute, exactly as specified in [ROADMAP.md](ROADMAP.md) Phase 4 — the
underwriting runs inside an attested enclave, only `(accountId, limit, tier)` emerges, the proof line names
the code hash instead of the revenue. Dual-mode: the public-quorum path stays for anyone who prefers
provider consensus over attested hardware.

**Status:** partially **BUILT** — see [`fcc/`](../fcc/): the underwriting extension is implemented on
Flare's own scaffold (wire-conformant, 16/16 golden fixtures, 60 unit tests, no revenue in its output by
test), and `PrivateUnderwriter.sol` verifies enclave-signed decisions against a registered code measurement
(7 tests). What remains is platform registration. Correction from the hackathon channel: Coston2's
indexer is not VPN-gated (that is Coston); it takes pinned hackathon credentials, and simulated TEEs are
supported to PRODUCTION — so registration is achievable, at the cost of an infrastructure gauntlet
(stable HTTPS tunnel, pinned version set, flaky availability-check polling) that the channel shows eating
teams' hours. The enclave path stays out of the live product until that registration exists. 💰 enclave hosting
(~$100–500/mo on confidential VMs) when built.
**Resolved when:** an account is underwritten with no revenue figure anywhere on chain, and an outside
auditor reproduces the enclave image to the registered hash.

## 5. The published API key (and Stripe's terms)

**The gap:** FDC requests are public calldata; even a restricted key on chain likely violates Stripe's terms.

**Mechanism, in two steps:**
1. **Platform-held keys now.** The Connect OAuth architecture (item 3) moves every key server-side —
   permitted by Stripe — leaving nothing in the user's hands.
2. **Enclave-terminated reads.** The data path that keeps FDC's *decentralised* verification without public
   credentials: providers call an attested TLS-terminating proxy whose code hash is registered on chain and
   which injects auth inside the enclave. Until that exists, the honest position stands: the public-calldata
   key is a testnet demonstration, and the production read path is the enclave.

**Status:** DESIGNED. **Resolved when:** no credential appears in calldata and Stripe's terms are satisfied
in writing (💰 counsel review).

## 6. LP currency risk, and XRPL value arriving off-pool

**The gap:** debts are USD, pool assets FXRP; XRPL repayments settle debt but the XRP sits off-chain until
re-minted — previously shown as a silent share-price dip.

| Mechanism | Status |
|---|---|
| **Receivable accounting.** An XRPL repayment now books the received XRP as an on-chain receivable counted in `totalAssets` — the share price stays whole and *states the claim* instead of hiding a dip. Settled by the re-mint transfer; impairable by governance if the operator fails, with the junior tranche absorbing first. | **BUILT** — `xrplReceivableFxrp`, `settleReceivable`, `impairReceivable` |
| **Automated re-mint.** The FAssets minting flow (reserve → pay from XRPL treasury → mint → settle) run by an ops bot; later an FSA instruction so the XRPL side needs no custodied hot key. | DESIGNED |
| **A USD-denominated senior pool.** USDT0 exists on Coston2; a second vault holding USDT0 that swaps to FXRP at disbursement moves FX risk from LPs to the moment of settlement. Needs a DEX route on testnet. | DESIGNED |

**Resolved when:** an LP can choose a pool whose unit matches the debt's unit, and every XRPL repayment
reconciles receivable → settled within an SLA.

## 7. Regulatory

**Mechanism:** commercial-credit positioning (sole traders, not consumers), jurisdiction matrix before any
real money, origination through a licensed partner with the protocol as infrastructure, platform-KYC
piggybacking (Stripe has already verified the business — attestable), allowlist hook on the pool so the
securities posture of shares can be decided per jurisdiction *before* outside money.

**Status:** DESIGNED — not code. 💰 counsel per jurisdiction; starts the day the project outlives the
hackathon, because it is the slowest thread.

## 8. FDC latency and per-request fees

**Mechanism:** attest at draw time rather than on a calendar (the borrower pays two minutes when they want
money, not weekly); protocol absorbs the request fee inside the origination fee; pre-attestation by an ops
cron ahead of predictable draws; batched settlement already built (`repayFromXrplBatch`). Upstream ask to
Flare: multi-request Merkle bundling in one round is already how FDC works — the remaining cost is the
per-request fee, which is their lever, not ours.

**Status:** partially BUILT (batching), rest DESIGNED.

## 9. Pagination undercount

**Mechanism:** day-granular periods. The overlap guard makes fine-grained windows sound, and a busy
account's day fits in one page; underwriting then sums a trailing window instead of averaging three
periods. Alternative for very large accounts: per-page attestation with cursor continuity checked on chain.

**Status:** DESIGNED — an underwriting-formula change (`revenueInTrailingWindow`) scheduled with the next
oracle version, because it moves the limit's definition and deserves its own test cycle.

## 10. Explorer dependency

**Mechanism:** self-hosted indexer (Ponder) as the primary log source with the public explorer as fallback;
RPC failover across the public endpoints. 💰 ~$5–20/mo VPS, or free tiers while small.

**Status:** DESIGNED — Phase 6 territory.

---

## What was built today against this map

- `LenderPool`: junior first-loss tranche (`fundJunior`/`withdrawJunior`, loss absorption order), XRPL
  receivable accounting (`onXrplRepayment`, `settleReceivable`, `impairReceivable` with junior-first
  impairment), LP withdrawals that exclude the junior buffer.
- `AdvanceManager`: risk-priced origination fee (`riskPremiumBps`), history-depth tier term
  (`historyStepBps`), receivable-aware XRPL settlement.
- `RevenueOracle`: owner-initiated wallet rotation behind a 3-day cancellable timelock.

All parameter defaults preserve the deployed V2 semantics exactly (premiums and history steps default to
zero, junior starts empty), so the live demo's behaviour is unchanged until the next deployment — which is
deliberately scheduled after the judging window rather than during it.
