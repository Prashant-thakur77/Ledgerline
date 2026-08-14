# The real-world plan

How every open shortcoming is actually solved in the industry that already runs this business,
and the concrete order in which we adopt each mechanism. Researched against the practices of the
processor-lenders (Stripe Capital, Shopify Capital, Square Loans), the standalone RBF firms
(Pipe, Wayflyer, Clearco), the MCA industry, the on-chain credit protocols (Maple, Goldfinch,
Centrifuge, Ajna, Aave/Maker), and the confidential-compute stack (GCP/Azure, Automata, Phala).

Effort: **S** = protocol code only. **M** = code + a vendor or ops commitment. **L** = partnership,
license, or months. 💰 marks real money.

---

## 0. What the research overturned

Four things we believed about our own weaknesses are wrong, in our favour:

1. **Refund lag is not an oracle deficiency — it is the founding problem of card acquiring.**
   Rolling reserves exist because settled card revenue is not final for ~120 days; the canonical
   reserve term is deliberately matched to the chargeback window. Every acquirer on earth treats
   recent revenue as provisional. We were treating attested revenue as final; the fix is to stop,
   the same way they did (§2).
2. **Permissionless `markDelinquent` is ahead of the RWA-credit field, not behind it.** Maple,
   Goldfinch, TrueFi and Centrifuge all route default through a trusted human delegate. Our
   timestamp-proven delinquency is more trust-minimised than the industry norm — it only lacks a
   bounty. And our owner-gated `writeOff`, which read as a centralisation wart, is exactly the
   industry's delegate pattern (§4).
3. **Our true-sale fact pattern is stronger than the incumbents'.** Paper MCAs reconcile "upon
   merchant request", and funders get sued when that right is illusory. Repayment computed
   mechanically as a percentage of FDC-attested revenue is continuous, automatic, self-executing
   reconciliation — a court-friendlier purchase-of-receivables than the industry's own paper (§3).
4. **Hardware TEE is cheap, not exotic.** GCP Confidential Space is free on top of a ~$150–200/mo
   VM; the SEV/TDX premium is fractions of a cent per vCPU-hour. The blocker is a reproducible
   build, not money (§6).

---

## 1. Collection: control the money flow, never rely on the borrower

**How the real world does it.** The platform lenders' entire loss advantage is *deduction at
source*: Shopify/Stripe/Square net the repayment out of each day's settlement before the merchant
ever holds the money. Standalone funders approximate it with processor split-funding, lockbox
accounts (hated for their one-day delay), fixed ACH pulls with a reconciliation clause, and
anti-diversion covenants that accelerate the balance if the merchant reroutes revenue.

**Our adaptation — where crypto is strictly better.** A smart-contract lockbox splits funds
atomically in the transaction they arrive: the one-day delay that makes IRL lockboxes hated
disappears.

| Deliverable | Mechanism | Effort |
|---|---|---|
| **Splitter lockbox** | Merchant's payout address becomes a splitter: N% to the pool, the rest forwarded, per inflow, in one transaction. EVM vault for FXRP; XRPL SignerList co-signer or Hook for native XRP | S–M |
| **Springing withholding** | A default/diversion flag springs the split to 100% — the on-chain DACA. Rule-based, visible, reversible on cure | S |
| **Repayment floor curve** | Copy Stripe Capital's 60-day minimum: each epoch, cumulative repayment is compared against a milestone curve; shortfall steps up the split rate. Converts pure revenue-share into revenue-share-with-a-floor, which is what makes platform books amortise | S |
| **Anti-diversion detector** | Recurring FDC attestations of gross volume per pledged processor. Collapse at the pledged processor while other attested sources stay active = diversion (accelerates), distinct from honest decline (owes nothing extra under revenue share) | M |
| **Stripe Connect split-funding** | Production fiat path: embed in a vertical SaaS running Connect; repayment as transfer splits at payout; FDC attests the transfer objects so the pool has proof each split occurred | L 💰 |

## 2. Fraud, refunds, sybil: treat recent revenue as provisional, identity as scarce

**How the real world does it.** Rolling reserves (5–15% held ~120 days), continuous refund-ratio
monitoring with hard thresholds (Visa VAMP: warn 1.5%, excessive 2.2%), KYB with UBO resolution
(Middesk/Persona — the person, not the shell, is the unit of exposure), bank-ownership matching
(Plaid Identity), device intelligence and velocity rules, UCC lien searches patched by the
DataMerch negative-file consortium, and payer-concentration analysis against self-dealing.

**Our adaptation.**

| Deliverable | Mechanism | Effort |
|---|---|---|
| **Age-weighted underwriting** | Revenue older than the refund window counts 100%; the last 120 days takes a haircut curve. Pure Solidity over the attested series | S |
| **Rolling reserve on disbursement** | Escrow 10–15% of each advance; released on a later re-attestation showing the underwritten revenue was not refunded; consumed on adverse re-attestation | S |
| **Net-revenue schema + refund covenants** | Attest `net`, `refund_count`, `refund_volume`, `dispute_ratio` as separate fields. Borrow VAMP's numbers as live covenants: cross 1.5% → step up the share rate; cross 2.2% → freeze originations for the account | M |
| **On-chain advance registry (anti-stacking)** | Advance records keyed to EIN-hash and processor-account-hash; funding reverts on an active record. Zero filing lag — structurally better than UCC. Publish defaults against the same hashes: a permissionless DataMerch other protocols can consume | S |
| **KYB + UBO uniqueness credential** | Middesk-verified entity → TEE-issued non-transferable credential keyed to salted EIN-hash and UBO-hashes; aggregate exposure cap per UBO across all their entities. The direct answer to distributed default | M 💰 ~$1–5/underwrite |
| **The identity triangle** | KYB legal name == Plaid-verified bank owner == processor payout destination (FDC-attestable). One bank account backs one borrower | M |
| **Velocity brakes** | Per-credential limits that grow with repayment (the BNPL ladder), a global originations rate limit per epoch, a cap on pool share exposed to young accounts. No vendor needed | S |
| **Authenticity features** | Unique-payer count, top-payer share, payer-tenure distribution — computed in the TEE from transaction-level API data, so self-funded "revenue" scores poorly without the distribution ever becoming public | M |

## 3. Legal: the purchase, the disclosure, the wrapper

**How the real world does it.** MCAs survive usury law as *purchases of future receivables* — and
courts (NY's LG Funding factors) uphold them exactly when the funder genuinely bears revenue risk
via a real reconciliation clause. Ten US states now require TILA-like disclosure for commercial
financing. On-chain credit wraps pools in Delaware series LLCs (Centrifuge), gates LPs via Reg D
506(c) (Goldfinch Prime), and the EU offers one passportable license (ECSPR) covering 27 markets.

**Our adaptation.**

| Deliverable | Mechanism | Effort |
|---|---|---|
| **Receivables Purchase Agreement per advance** | Template from MCA counsel; hash committed in the advance struct. Our mechanical revenue-share is the strongest reconciliation fact pattern in the industry | S/M 💰 $25–75k counsel |
| **Resolve the term/true-sale tension** | A true sale must not have an absolute maturity — but our 180-day term exists to stop the one-cent drip. Resolution from the research: the term triggers *springing withholding* (§1), never acceleration of a fixed balance. Keeps the anti-drip defence and the sale characterisation | S |
| **Disclosure generator** | State-required forms (est. APR from the underwriting projection, total remittance, fees) rendered deterministically from on-chain terms, e-signed, hash on-chain. Geo-scoped rollout by KYB address | M 💰 registrations |
| **Series LLC per pool** | Proofline Master LLC (Delaware); each pool = one ring-fenced series that is the legal purchaser under every RPA; ERC-4626 senior + junior = the series' two membership classes | M/L 💰 $50–150k |
| **Gated LP access** | Allowlist on the vault: US via 506(c) verified accreditation, non-US geofenced. Satisfies the subscription requirement in the same stroke | M |
| **EU path** | ECSPR white-label behind an existing licensed platform first; advances flip to loan form there (the true-sale motivation is a US usury artifact) | L 💰 |

## 4. Keepers and governance: pay the watchman, arm the veto

**How the real world does it.** Aave/Compound liquidations are permissionless with a 5–15% bonus
from the position; Maker pays a flat tip + 2% chip from the surplus buffer — and the agent-based
research (StableSims) found the *flat* component moves keepers, not the proportional one.
Guardian multisigs pause instantly but cannot unpause (Compound's asymmetry); Aave runs 1-day
routine / 7-day critical delays with an elected veto council.

**Our adaptation.**

| Deliverable | Mechanism | Effort |
|---|---|---|
| **Keeper bounty in `markDelinquent`** | Flat tip (gas on Flare is cents, so $5–20 equivalent) + 0.5–2% chip capped absolute, funded from origination fees already accrued. ~30 lines | S |
| **`delinquencyDue()` view** | checkUpkeep-shaped, so any bot or future automation network can consume it; our own Go keeper claims its own bounty and is self-funding | S–M |
| **Guardian pauser** | The live bug the research exposed: pause() behind the 1-hour timelock hands an attacker a head start. Fix with Compound's asymmetry: a k-of-n guardian pauses instantly, only the timelock unpauses. Repayments stay unpausable | S |
| **Tiered delays + veto** | 48h for parameters, 7d for ownership changes; CANCELLER_ROLE to the guardian so the delay window is defensible, not just observable | S |
| **Delegate write-off** | `writeOff` moves from owner to a named DELEGATE_ROLE required to hold junior shares — skin in the game, matching Maple's pool-delegate pattern with better collateralisation | M |

## 5. FX: match the book's currency, per vault

**How the real world does it.** The first ALM rule: never fund an asset in currency A with a
liability in currency B. Per-currency warehouse SPVs; DeFi's version is stablecoin-denominated
pools that swap at execution (Goldfinch/Maple).

**Our adaptation.** Split into two vaults: a **USDT0 vault** funding USD-denominated advances
(swapped to FXRP only at execution), and the **FXRP vault** funding XRP-native advances repaid
over XRPL. Denomination flag enforced per advance; junior tranche sized per vault; LPs self-select
their exposure instead of unknowingly holding a mixed book. **Effort: S/M**, pure Solidity.

## 6. TEE to hardware: reproducibility first, then $150/month

**How the real world does it.** GCP Confidential Space (AMD SEV + vTPM → OIDC attestation) is the
commodity path; Intel TDX with Automata's DCAP contracts gives on-chain quote verification; Phala's
attestation-gated KMS pattern solves enclave key continuity.

**Our adaptation, in order.**

| Deliverable | Mechanism | Effort |
|---|---|---|
| **Reproducible TS build** | Our REPRODUCIBILITY.md already flags it: an auditor cannot independently confirm the registered codeHash until the TypeScript image reproduces cross-machine. CI work, zero infrastructure. Do this before paying for any VM | S |
| **GCP Confidential Space** | The scaffold already stubs it: platform `GCP_AMD_SEV`, `MODE=0`. Build the underwriter image reproducibly, register the hardware measurement | M 💰 ~$150–200/mo |
| **Attestation-gated KMS** | Fixes our sharpest operational edge (every container recreate mints a new teeId and orphans registrations): keys released to any enclave proving the registered measurement, so identity survives restarts | M 💰 ~$150/mo or Phala Cloud |
| **On-chain DCAP verification** | Automata's contracts ported to Flare, quotes verified cryptographically on-chain rather than quorum-vouched. The end state, not the next step | L |

## 7. Revenue sources: the bank account is the second witness

**How the real world does it.** Stripe discourages OAuth for new platforms — read-only Apps are
the ToS-clean read path. Underwriters triangulate processor data against open banking (Plaid
cash-flow underwriting); Shopify exposes settled payouts; aggregators (Rutter/Codat) are
enterprise-priced and premature before volume.

**Our adaptation.**

| Deliverable | Mechanism | Effort |
|---|---|---|
| **Stripe read-only App** | Scope change + endpoint move; ToS-clean platform reads | S |
| **Plaid cash-flow adapter** | Bank net-inflows as a second attested source, computed in the TEE (PII stays inside) | M–L 💰 per-account pricing |
| **The triangulation covenant** | Underwrite on `min(stripe_net, bank_inflow)` — encoding the reconciliation rule on-chain, which Web2 underwriting does only in analysts' heads | M |
| **Shopify payouts adapter** | Second processor; attest the settled-payouts endpoint (stable shape, no PII), same pattern as Stripe | M |
| **Embedded distribution** | Production growth: one vertical SaaS partner whose dashboard surfaces offers and whose feed is just another attestation source | L |

---

## The phased order

**Phase A — protocol code only (no money, no partners): BUILT.** Implemented and tested
(162 tests) the day the plan was written: the splitter lockbox with springing withholding
(`RevenueSplitter.sol`), the repayment floor curve with automatic cure, age-weighted
underwriting, the rolling reserve (escrowed at disbursement, released past the refund window,
consumed first on write-off), origination velocity brakes, the keeper tip with
`delinquencyDue()`, and the guardian pause asymmetry. Deployed as **V5 on 2026-08-13** (addresses
in the README and on the site) and exercised the same day: the splitter split a live settlement, the
reserve released on a clean close, and the age haircut is visible in the advance transaction. Still open
in Phase A: only the Stripe read-only App registration (paperwork). The net-revenue schema is BUILT
(V6 oracle: refunds and disputes attested beside net revenue, `refundRatioBps` on chain, VAMP
covenants in the manager — warn at 1.5% steps the share rate up by half, 2.2% freezes originations
until a cleaner month lands) and the reproducible build is enforced in CI.

**Between A and B — the fee split: BUILT (V6, in the repository).** Every repayment's
pro-rata fee slice now splits at source: 70% senior, 20% auto-replenishing the junior
first-loss buffer, 10% the keeper reserve — verified down to exact amounts in
test/FeeSplit.test.ts, including the loop where a split-funded reserve actually pays a
keeper for marking a delinquency. The write-off pen also gains a named DELEGATE alongside
the owner (Maple's pattern). Deliberately NOT time-based interest: the
fixed-fee-plus-revenue-share shape is what keeps the advance a purchase of receivables
rather than a loan (§3). **Deploys after the judging window; the live V5 stays frozen.**
Also closed from Phase A's leftovers: the reproducible TypeScript build is now enforced in
CI (two clean builds, identical dist hashes — proven locally at 803e40b2…), and a keeper
script runs the delinquency and floor passes as a self-funding cron.

**Phase B — vendors + ops (~90 days, low 💰):** KYB/UBO credential · Plaid triangle +
cash-flow adapter · device intelligence · GCP Confidential Space + attestation-gated KMS ·
self-funding keeper service · Shopify adapter · dual-vault FX split · named delegate with junior
stake.

**Phase C — legal and scale (production, real 💰):** RPA template + counsel · series LLC +
506(c) gated vaults · state disclosure registrations · ECSPR white-label for EU · sponsor-bank
forward-flow purchases · embedded SaaS distribution · on-chain DCAP verification.

The through-line the research kept confirming: every mechanism the incumbents use to control
risk is either *replicable on-chain with less trust* (lockboxes without the delay, lien
registries without the filing lag, reconciliation without the lawsuit) or *purchasable off the
shelf* (KYB, bank verification, confidential VMs). Nothing on this list requires inventing
anything — only sequencing it.
