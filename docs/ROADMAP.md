# Ledgerline — the deep roadmap

Seven phases, sequenced by dependency. Each phase answers one question, and each section below says
precisely what changes, what gets built, how it is tested, what can go wrong, and what "done" means.
Effort is in focused person-weeks (pw), assuming one engineer who knows this codebase.

The dependency spine: **1 → 2 → (3 ∥ 4) → 5 → 6**, with **7 running alongside from the start.**
Phase 1 is first not because it is easiest but because every later phase amplifies its absence — a lender
pool built over recyclable revenue is a machine for losing other people's money.

Current state assumed throughout: `RevenueOracle` + `AdvanceManager` on Coston2, 65 tests, two FDC
attestation types live (Web2Json in, Payment back), both money legs run on chain, single owner-funded
treasury, web app at ledgerline-flare.vercel.app.

---

## Phase 1 — Attack-resistant underwriting

**Question it answers: can someone cheat the economics while being honest with the machine?**
The proofs already guarantee the *data* is real. This phase makes the *money* safe against real data
generated adversarially. (~3 pw)

### 1.1 Close the recycling attack economically

The attack: pay yourself $4,000 through your own Stripe account (~2.9% + 30¢ per charge in processing
fees), attest it — the attestation is genuine — borrow at 1.0x, default. Profit ≈ advance − recycling cost,
positive whenever the advance factor exceeds card fees.

The fix is a **tier schedule**, not a cleverer oracle:

- `factorBps` becomes per-account, derived on chain from repayment history:
  `factor(account) = min(BASE + STEP × closedCleanCycles, CAP)` where a *closed clean cycle* is an advance
  fully repaid without ever being marked delinquent.
- **Tier 0 must sit below card fees.** `BASE ≤ 250` (2.5% of monthly mean) makes recycling strictly
  negative-EV before any other signal is consulted. `STEP` on the order of 15–25 percentage points per
  clean cycle, `CAP = 10_000` (today's 1.0x) after roughly four to six honest cycles.
- Parameters owner-settable **behind the Phase-2 timelock**, emitted on change, shown in the UI next to the
  limit so the borrower always sees which tier priced them.

Contract changes: replace the flat `factorBps` with the schedule + a `closedCleanCycles(accountId)` counter
incremented in `_repay` when an advance closes un-delinquent. `Underwritten` event gains the tier inputs.

### 1.2 Non-overlapping periods

`submitAttestation` currently requires each period to *end* after the previous one but not to *begin* after
it, so three windows shifted by a day count as three periods of history over one month of revenue. One
line: `if (dto.periodStart < latestEnd) revert OverlappingPeriod(latestEnd, dto.periodStart)`. Ships with
the next oracle deployment; existing demo history (which exhibits the pattern — that is how we found it)
stays on the old address.

### 1.3 Count refunds against revenue

The current jq sums only `reporting_category == "charge"`. Stripe reports refunds as their own rows
(`"refund"`, negative `net`), so refunded revenue is currently **not subtracted** — attested revenue
overstates real revenue for any account with refunds. Fix in `revenue-sources.ts`:
`select(.reporting_category == "charge" or .reporting_category == "refund")`, clamp the sum at zero.
Chargebacks (`"adjustment"`) included the same way. This is a determinism-preserving filter change; no
contract change.

### 1.4 Attested account age

Stripe's account object carries `created`. A second Web2Json source (`accountProfileSource`) reduces it to
`AccountProfileDTO { platform, accountRef, createdAt }`; the oracle stores it once per account, and the tier
schedule refuses tier > 0 to accounts younger than N days. Needs the restricted key's scope extended by one
read-only endpoint — same confidentiality posture as today.

### 1.5 Trend-aware limits, kept explainable

Averaging stays, but the base becomes `min(mean of last 3, most recent period)` — a collapsing business is
priced on its collapse, not its history. Deliberately *not* a volatility model: every input to the limit
must remain printable in one sentence in the UI. Anything fancier belongs inside the Phase-4 enclave where
it can be attested wholesale.

### Tests and acceptance

- A literal **attack simulation test**: recycle revenue at tier 0, assert the attacker's net is negative
  including gas and fees.
- Fuzz the tier schedule (never exceeds CAP, never regresses on clean history, delinquency freezes it).
- Overlap guard, refund arithmetic (including net-negative months → limit 0), age gate.
- **Done when:** recycling is provably unprofitable at tier 0; a fabricated three-day "history" cannot reach
  tier 1; refunded revenue reduces the attested figure.

---

## Phase 2 — The lender side

**Question it answers: whose money is this?** A single owner-funded treasury caps the product at a demo.
(~5 pw)

### 2.1 Governance first, pool second

Order matters: the moment outside money exists, today's `withdrawTreasury` under one key is a rug vector.

- Ownership → a Safe multisig; parameter changes → OpenZeppelin `TimelockController` (48h) in front of it.
- `Pausable` on **originations only** — never on repayments; a pause that traps borrowers' repayments would
  manufacture delinquencies.

### 2.2 The pool

An **ERC-4626 vault over FXRP** replaces the treasury:

- `AdvanceManager` draws from the pool under an allowance; repayments and the pool's share of origination
  fees flow back in. Fee split on the order of 80/20 pool/protocol, timelocked parameter.
- **Utilisation cap** (~80%) so withdrawals stay possible; `maxWithdraw` reflects idle liquidity only —
  advances are not recallable, and the vault must never pretend otherwise.
- **Write-offs**: a new `writeOff(accountId)` (timelocked, after delinquency + a long stand-down) reduces
  `totalAssets`, socialising the loss across LP shares transparently. Delinquency ≠ write-off; the first is
  a fact, the second is an accounting decision.
- **Honest FX disclosure**: debts are USD, pool assets are FXRP, so LPs carry XRP/USD exposure between
  disbursement and repayment. Disclosed on the deposit screen, not hedged — hedging is out of scope and
  saying otherwise would be a lie.

### 2.3 Lender UI

Deposit/withdraw, share price history, utilisation, realised default rate, the fee split, and the risk
disclosures — all derived from events, no database, same as the existing activity feed.

### Tests and acceptance

ERC-4626 conformance suite; share-price invariants under fee accrual and write-off; utilisation cap
honoured under fuzzing; pause blocks originations but never `_repay`; reentrancy on the new external
surface. **Done when:** a stranger's FXRP can enter, earn, absorb a written-off default proportionally, and
leave — with every step reconstructable from events.

---

## Phase 3 — No EVM wallet at all (Flare Smart Accounts)

**Question it answers: can a borrower who has only ever used XRP use this?**
Both money legs are already pure XRP; only the *requests* still need MetaMask. (~4 pw, parallel with 4)

### 3.1 Mechanism

Flare Smart Accounts (FSA) pairs every XRPL address with a deterministic `PersonalAccount` (PA) on Flare
that only that address controls, authorised by the same FDC Payment proofs `repayFromXrpl` already trusts.

- The borrower's XRPL payment carries an FSA instruction memo; the FSA executor pipeline has the PA call
  `submitAttestation` / `requestAdvance`. The PA becomes the oracle's bound owner — the ownership model is
  unchanged, the owner is just a contract an XRPL key controls.
- Disbursement reuses `requestAdvanceToXrpl`; repayment reuses `repayFromXrpl`. The whole lifecycle becomes:
  sign XRPL payments, nothing else.

### 3.2 What has to be built

An **executor service** (watches XRPL, requests FDC proofs, submits to the FSA diamond — we run one, anyone
can), instruction encoding/decoding against FSA's memo formats, a frontend path that takes an XRPL address,
derives the PA via CREATE2, and drives the flow through Xumm/Crossmark signing.

### Risks

FSA is Flare's newest deployed stack; pin to its Coston2 diamond and version the memo formats. Executor
liveness is a real operational dependency — document the trust honestly: executors can censor, never steal.
`DestinationTag` must be rejected (FSA-documented front-running vector).

**Done when:** a fresh XRPL testnet account, with zero C2FLR ever held, completes attest → borrow (real XRP
in) → repay (real XRP out) end to end.

---

## Phase 4 — Privacy (Flare Confidential Compute)

**Question it answers: will a real business publish its revenue on a public chain?** No. This is the
adoption ceiling, named in the README since day one. (~6 pw, the riskiest phase)

### 4.1 Architecture

The public-FDC pipeline is replaced (as an *option*) by an FCC extension:

- A TEE enclave (Go path of Flare's `fce-extension-scaffold` — smallest, bit-reproducible image) holds
  **per-borrower** Stripe keys, delivered encrypted (ECIES to the enclave key), fetches revenue, runs the
  full underwriting policy inside, and emits only `(accountId, limitCents, tier)` signed by the enclave.
- An on-chain registry pins the extension's **code hash**; `AdvanceManager` accepts a limit only under a
  valid TEE signature from a registered measurement. Changing the underwriting code is a public, governed
  rollout — what you audit is what runs.
- The proof line survives, renamed: `verified privately · underwriting run in tee · code 0x4c19…8de2 ↗`.

### 4.2 Honest trade

This trades FDC's *provider-quorum* trust for *attested-hardware* trust on the revenue read. Some users
will prefer the public quorum; both paths stay supported, per account. It also finally solves the
published-key problem completely — keys live only inside the enclave.

### Risks

The FCC stack is young (teams have lost days to enclave redeploys, measurement mismatches, tee-node/proxy
version skew — documented in this repo's research notes). Mitigations: the public path remains the default
until the enclave path has months of parallel operation; reproducible-build verification in CI; provider
key backup per FCC's own DR model.

**Done when:** an account can be underwritten with **no revenue figure appearing anywhere on chain**, and an
outside auditor can rebuild the enclave image to the registered hash from this repo.

---

## Phase 5 — More rails, both sides

**Question it answers: is this a Stripe product or a category?** (~4 pw)

### 5.1 Platforms in

Shopify (Admin API orders), PayPal, YouTube, Substack — each is an entry in `revenue-sources.ts` with a
deterministic jq; `RevenueOracle` does not change, by design. Two systematic issues to solve once, for all
of them:

- **Pagination**: the current filters read one page (100 rows). Accounts with >100 transactions/month are
  *under*-counted — conservative for lending, but must be documented per source and eventually fixed by
  per-page attestation summed on chain.
- **Token confidentiality**: same posture as Stripe — narrowest possible read-only scopes now, the Phase-4
  enclave as the real answer.

### 5.2 Repayment rails

- **Batching**: N Payment attestations submitted in the same voting round, settled in one
  `repayFromXrplBatch(proofs[])` — amortises gas so small, frequent repayments are economic.
- **Sender binding**: optional per-advance `sourceAddressHash`, so a borrower can restrict repayment to
  their own XRPL account (today any sender with the right memo can settle any debt — deliberate, but it
  should be a choice).
- **Overpayment credit**: excess on an XRPL repayment becomes an on-chain credit balance usable against the
  next advance — strictly better than a refund leg, which would require custodying an XRPL hot key.
- **Re-minting**: treasury XRP → FXRP through FAssets minting (collateral reservation, payment, mint), so
  XRPL repayments actually replenish the Phase-2 pool instead of accumulating off to the side.

**Done when:** a second platform's revenue is proven on chain by the same oracle, and a batched multi-payment
repayment settles in one transaction.

---

## Phase 6 — Production operations

**Question it answers: would you trust this with real money?** (~6 pw + audit calendar time)

- **Deeper testing**: Foundry invariant suites alongside the 65 unit tests. The invariants, explicitly:
  debt never increases except at origination; pool assets + outstanding disbursements − repayments balances
  to events; no state with `open == false && outstanding > 0`; share price never rises from a write-off.
  Slither/Aderyn clean; mutation testing on the two money paths.
- **External audit** of the four core contracts, preceded by complete NatSpec and the already-written
  known-issues document (the README's security-model section grows into `docs/SECURITY.md`).
- **Own indexer** (Ponder or Subsquid) replacing the public explorer API behind `/api/activity` and
  `/api/proofs` — the current single external dependency of the frontend.
- **Monitoring and runbooks**: alerts on pool utilisation, round-finalisation lag, DA-layer and verifier
  health, delinquency events; a status page; the demo-day runbook generalised into operations docs.
- **Frontend hardening**: WalletConnect (mobile wallets — today injected-only), error boundaries, Playwright
  end-to-end suite with a wallet driver, RPC failover.
- **Deployment path**: Coston2 → **Songbird** as the canary with small real value → **Flare mainnet** with
  real FXRP. Contracts stay **immutable** — new versions deploy fresh and migrate, because "the code you
  audited is the code that runs" is this product's entire pitch; no proxies.
- **Key hygiene**: deployer and multisig signers on hardware; role separation between deployer, treasurer,
  and pauser.

**Done when:** the audit is published, the invariant suite runs in CI, the app survives explorer and RPC
outages, and Songbird has run for a full quarter without a critical incident.

---

## Phase 7 — The part that is not code

**Question it answers: what is this, legally?** Runs alongside everything from day one, because it is the
slowest. (calendar-bound, not pw-bound)

- **Classification**: revenue-based financing of *businesses* (sole traders included) — commercial credit,
  materially lighter-touch than consumer lending in most jurisdictions, but licensed activity in many.
  Jurisdiction matrix first; launch where regulatory sandboxes exist.
- **Origination structure**: a licensed originating partner in early markets, with the protocol as
  infrastructure — the Pipe/Wayflyer pattern inverted onto chain.
- **KYC/AML**: the borrower is already KYC'd *by Stripe* — platform KYC is itself an attestable fact
  (account object fields), which composes with Phase 1's age gate and Phase 4's private checks. Sanctions
  screening on wallet and XRPL addresses at the API edge.
- **The pool share question**: LP shares in a yield-bearing credit pool look like securities in most
  places. Options, in rising order of decentralisation: permissioned (allowlisted) vault → offshore
  structure → full decentralisation with no promoter. Decide with counsel before Phase 2 opens publicly —
  the contract design (allowlist hook on the 4626 vault) keeps all three open.
- **Data protection**: public on-chain revenue is a GDPR problem as much as a business one — one more
  reason Phase 4 is not optional. Loan agreements as hash-referenced documents; borrower T&Cs at first
  attestation.
- **Insurance / first-loss**: a protocol-owned junior tranche that absorbs the first N% of defaults makes
  the LP pitch honest and survivable.

**Done when:** there is a written legal opinion for each launch market, an originating structure, and the
pool's securities posture is decided *before* it accepts outside money.

---

## What is deliberately absent

- **A token.** Nothing here needs one; adding one would change the securities analysis of everything else.
- **Undercollateralised leverage, credit default swaps, tranching beyond first-loss** — the product is a
  working-capital advance; complexity is where credit products go to die.
- **Secure RNG, gaming integrations, or protocol usage for its own sake** — every Flare primitive in this
  plan is load-bearing or it is not there.
