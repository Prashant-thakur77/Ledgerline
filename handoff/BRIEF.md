> **POINT-IN-TIME (written before V2).** Current truth is [README.md](../README.md); do not act on
> the addresses, counts, or plans below.

# Ledgerline — handoff brief

Paste this whole file into a fresh Claude Code session. It is self-contained: absolute paths, real addresses,
verified facts, and what is left to do. Read it top to bottom before touching anything.

**The project lives at `/home/prashant/projects/flare`.** It is its own git repo with no remote (deliberately —
the starter's `origin` was removed so nothing can push to `flare-foundation/flare-hardhat-starter`). 15 commits
on local `main`. The outer repo `/home/prashant/projects` is a different, unrelated project (Prahari) and
gitignores `flare/`.

---

## 1. What we are building and why

**Ledgerline: advances against revenue a payment processor already proves.**

A creator or small business connects a revenue account they already have — Stripe today. Flare's Data Connector
(FDC) attests their recent revenue from that platform's API and puts the number on chain with a Merkle proof. A
contract underwrites an advance against that proven revenue and sends FXRP. Each newly attested period repays
part of the advance automatically. The obligation is denominated in US dollars using FTSOv2, so the borrower
takes on a dollar debt rather than an XRP price bet.

**The pitch in one line:** your payment processor already proves you earn four thousand dollars a month, no
lender can read it, and FDC can.

**Why it needs Flare specifically.** A smart contract cannot read a Stripe dashboard, so anyone can claim any
income. The only workaround has been to trust a company's server to vouch for the number, which reintroduces
exactly the intermediary the system was supposed to remove. FDC removes that: Web2Json calls the API, the
network's own data providers agree on the response, and it arrives with a Merkle proof.

**Target user:** a 22-year-old earning $4,000/month on Stripe who has no credit file for a bank and no crypto
collateral for DeFi.

---

## 2. The competition we are entering

**Flare Summer Signal, Bounty 1 — Interoperable Asset Products.** DoraHacks, virtual, Flare's own hackathon.

- **Deadline: 14 August 2026, 19:59.** Judging 15–21 Aug. Winners announced 24 Aug.
- **Prize: $6,000 for this bounty — $4,000 first, $2,000 second, nothing for third.** Two paid places only.
- 513 registered hackers. Both bounties allow multi-track entry (`isMultiTracksAllowed: true`).
- Page: https://dorahacks.io/hackathon/flaresummersignal/detail

### Judging criteria (verbatim from the official page, no published weights)

1. **Product usefulness** — Does the product solve a real user, developer, ecosystem, or infrastructure problem?
2. **Flare integration quality** — Is Flare used in a meaningful way, or is the integration superficial?
3. **Technical execution** — Does the demo work? Is the architecture credible and understandable?
4. **Evidence of new work** — Did the team clearly show what was newly built, ported, integrated, or improved?
5. **Clarity and future potential** — Can the team explain the product, user, integration, and next steps
   clearly? Does the project have a credible path beyond the hackathon?

### Submission requirements (verbatim)

Project name · selected bounty · short product description · target user · demo link, video, or working app
link · GitHub repo · explanation of how the project uses Flare · **explanation of what was newly built, ported,
integrated, or improved during the program** · smart contract addresses · short roadmap.

**Encouraged but not required** (most teams skip these, so they are cheap marks): which network it was deployed
on; how far the team got with user acquisition, distribution, testing or real user feedback; any early usage,
community interest, pilot users, partner conversations or traction signals.

### One myth to ignore

A "Feedback on building on Flare" README section is **NOT required** for this hackathon. That requirement
belongs to the earlier Encode × Flare event and to ETHGlobal Flare tracks. Adding a short one is cheap
insurance and reads well against "clarity", but do not treat it as compliance.

---

## 3. What is already built and verified working

**Everything below is real and on chain. Do not rebuild it. Verify before changing.**

### Contracts (Solidity 0.8.25, Hardhat, ethers v6, OpenZeppelin 5)

`/home/prashant/projects/flare/contracts/ledgerline/`

- **`RevenueOracle.sol`** — verifies an FDC Web2Json proof via
  `ContractRegistry.getFdcVerification().verifyWeb2Json()`, derives account identity from the attested payload
  rather than caller input, and stores revenue history. Also stores the **FDC voting round** and the **Merkle
  root the proof resolves to** (computed with `MerkleProof.processProof` over `keccak256(abi.encode(proof.data))`)
  so the UI can print facts a judge can check against the Relay.
  Guards: proof must verify; claimed account must match attested; no replay; non-owner cannot attest for a bound
  account; an older period cannot overwrite a newer one.
- **`AdvanceManager.sol`** — underwriting (mean of last 3 attested periods × 1.0x, capped, inputs stored on the
  advance and emitted), FXRP treasury, `requestAdvance` (FXRP to the borrower), `requestAdvanceToXrpl`
  (redeems through FAssets so a FAssets agent pays real XRP to the borrower's XRPL address), manual `repay`,
  `applyRevenueRepayment` (a newly proven period repays 20% of it), delinquency after a grace period.
- Test-only: `test/MockFXRP.sol` (6 decimals, like the real thing), `test/MockAssetManager.sol`,
  `test/RevenueOracleHarness.sol`, `test/AdvanceManagerHarness.sol` (stub the FDC and FTSO calls that only
  exist on a real Flare network).

### Tests — **46 passing.** `cd /home/prashant/projects/flare && npx hardhat test`

`test/RevenueOracle.test.ts` (13), `test/AdvanceManager.test.ts` (23), `test/AdvanceToXrpl.test.ts` (10).
Includes a 3x XRP price move asserting the dollar obligation does not change, and a test running the same price
at 6 and 8 decimals demanding the same answer.

### Deployed on Coston2 (chain id 114), both source-verified

| Contract | Address |
|---|---|
| `RevenueOracle` | `0x80D08369E1a34e8c7C43FCF947323e56e6B87Be6` |
| `AdvanceManager` | `0x4EC83Eb966dcac3e4291c85320Cfd6941a7C4f66` |
| FXRP (`FTestXRP`, 6 decimals) | `0x0b6A3645c240605887a5532109323A3E12273dc7` |
| FAssets `AssetManager` | `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA` |
| `ContractRegistry` (all Flare networks) | `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` |
| `FtsoV2` (via registry) | `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d` |

Explorer: `https://coston2-explorer.flare.network`

### Real transactions already on chain

Against the **current** oracle (`0x80D0…7Be6`):
- Stripe revenue proven, **$3,916.78**, FDC round **1,419,988**, Merkle root `0x4db0a6fe…39b2` —
  tx `0xede1d3f8bcb4292c928a59f6f4fb45aac43c76e5b9d0ac8a321b5004dfeb33b6`

Against the **previous** deployment (same code except the round/root fields — these need re-running, see §6):
- Revenue proven $3,912.23 — `0x8bea3e154e9bbc70dde5fd32bad90a54aa52a2e68205600e431b4900f77d88af`
- Advance issued, 1.918796 FXRP for $2.10 — `0x7996ce9cc7e91c2f81bdae01694e56798fa932ad4b8b5468ce43de5333e2e585`
- New period proven $4.55 — `0x768f0d23dd981277d5617fc978d4716f15e0bc39f0dc7b5117270bcb22c38515`
- Repaid from revenue, $2.10 → $1.19 — `0x1331a9b5f83de8d07f77df33eaa56bc599b85127c6fb9511a24407b38f86dd82`
- Advance redeemed to XRPL (Flare side) — `0x96ec23d1a6a66fae6a71d3a8c67bd9d5b158d706d04de49d36b3d7ba198922ff`
- **The XRP actually arriving (XRPL testnet)** — `784C8E73E1417C2600F7E6473FEE3CB43DEABFCDA008192789AB81F3BFD41534`
  — agent `r4GHJwGSaGmJy9BBXS9osFXqRjqdSm7v83` paid `rpcBsvdaL4eCkK64nNsQB1PQf4hm2Dq3Sc`, balance 100 → **109.95 XRP**

### Scripts — `/home/prashant/projects/flare/scripts/ledgerline/`

| Script | What it does |
|---|---|
| `deploy.ts` | Deploys both, wires FAssets, funds treasury from whatever FXRP is held, verifies on explorer |
| `attest-revenue.ts` | Composes a Web2Json request, waits for the voting round, fetches the proof, calls the oracle |
| `revenue-sources.ts` | Per-platform jq registry. `stripeBalanceSource` (default), `stripeSource` (payouts), `demoSource` (keyless) |
| `take-advance.ts` | Draws an advance in FXRP and prints every number |
| `advance-to-xrpl.ts` | Draws an advance paid out as real XRP on the XRP Ledger |
| `apply-repayment.ts` | Takes the agreed share of the newest attested period |
| `stripe-seed.ts` | Creates test charges in the Stripe sandbox so there is revenue to attest |
| `fassets-status.ts` | Where the FXRP is, lot size, agents, redemption queue |
| `phase0-ftso.ts`, `phase0-fxrp.ts` | Environment checks from the original validation phase |

### Frontend — `/home/prashant/projects/flare/web`

Next.js 16 + wagmi + viem. `npm run dev` on :3000. Builds clean.

Designed as a **receipt, not a dashboard**. Document paper `#FBFAF7` and ink `#14161A`, one verification green
`#0B6E4F` used **only** on facts an attestation backs, single column max 720px, hairline rules, monospace for
every figure, no shadows or gradients anywhere. Inter Tight + JetBrains Mono via `next/font/google`.

**The signature element is the proof line**, under every attested figure and nothing else:

```
verified · stripe balance transactions · fdc round 1,419,988 · merkle 0x4db0…39b2 ↗
```

It opens the transaction that verified it (found by querying `RevenueProven` logs). One motion moment only: the
page polls `revenueHistory`, so when an attestation lands while the page is open the figure resolves from
Pending grey to Ink while the proof line types in. `prefers-reduced-motion` respected.

### Docs — `/home/prashant/projects/flare/docs/`

`PHASE0.md` (environment validation, every address and encoding), `DEPLOYED.md` (deployment + the full path run
on chain), `DEMO.md` (a five-minute video script built around the real transactions), `BLOCKERS.md`.
Plus `README.md` at the repo root, written to the submission form's structure.

### Credentials

All in `/home/prashant/projects/flare/.env`, which is gitignored. **Never commit it, never put it in an
attestation.** It holds `PRIVATE_KEY` (throwaway Coston2 dev wallet
`0x5c051991900E6202430d28B26c9D21C7C23ef290`), `STRIPE_SETUP_KEY` (secret key, stays local, creates test data)
and `STRIPE_API_KEY` (read-only restricted key, `rk_test_…`, **deliberately published on chain**).

Stripe sandbox account is `acct_1U2HbaRh1zuX9OfD`. The FDC verifier needs **no API key** — the all-zeros value
`00000000-0000-0000-0000-000000000000` is the documented public testnet key and it works.

---

## 4. Things that were learned the hard way — do not rediscover these

- **Decimals are a trap.** XRP/USD reports **6** decimals on Coston2, FLR/USD reports **8**, and FXRP is **6**,
  not 18. Anything assuming 18 is wrong by 10^12. Decimals are a parameter everywhere in the conversion code.
- **`FtsoV2.getFeedById` is `payable`, not `view`** — a fee may apply on some feeds. So the price read cannot
  sit behind a view function. `currentXrpUsd()` is nonpayable; the UI reads it with `eth_call`/simulation.
- **FAssets redemption is in whole lots of 10 XRP.** There is no way to redeem $2. `requestAdvanceToXrpl` takes
  a lot count, not a dollar amount, and computes the debt from what was actually redeemed.
- **`eth_estimateGas` under-estimates redemption** — it walks the redemption ticket queue. Pass an explicit
  `gas: 6_000_000`. A `staticCall` succeeds either way, so the failure looks mysterious until you notice
  `gasUsed` equals the limit.
- **Stripe payouts are a dead end in test mode.** They need a bank account attached, and Stripe refuses to
  attach one from test mode ("Only live keys can access this method"). We attest **balance transactions**
  instead, summing `net` (after fees) for `reporting_category == "charge"`. That is better on the merits
  anyway: it measures money *earned*, not money *swept to a bank*, and it exists for a new business with no
  payout history.
- **FDC attestation requests are public calldata.** The Stripe key in the `headers` field is permanently
  world-readable. This breaks confidentiality, not trust. Mitigated with a read-only restricted key scoped to
  two endpoints; both source functions throw if handed an `sk_` key.
- **jq must be deterministic.** Every data provider runs it independently and they must agree, so period
  boundaries are baked in as literals rather than computed from a clock.
- **`hardhat-tenderly` is disabled** in `hardhat.config.ts`. Its ethers extender proxies deployed contracts and
  swallows dynamic method lookup, making every contract call `undefined`.
- **`web/tsconfig.json` needs `typeRoots: ["./node_modules/@types"]`** or the Hardhat project's `@types` leak
  in and break the build. Target must be ES2020+ for BigInt literals.

---

## 5. Competitive intelligence — what actually wins Flare hackathons

Researched across **17 Flare hackathons and sponsored tracks** to date. Findings, with the caveat that several
events never published winners at all (Encode × Flare, ETH Belgrade, the Harvard EasyA event — roughly $60k in
bounties with no public record).

### The winning formula, repeated with almost comic consistency

**Attest a Web2 fact with FDC, then settle money against it.** Roughly a third of all Flare winners are that
exact shape: RampNet (Wise payment → on-ramp, 1st at Cannes 2025), TrustworthyTransfers (Wise receipt →
escrow), FlareGate (Revolut/PayPal → escrow), FlareInsure (rainfall → payout), WeatherShield (weather →
insurance), ProteinMango (earthquake → payout), EnshrineFinance (compliance registry → credit).
**Ledgerline is exactly this shape.** That is the highest-prior bet available and we are already on it.

### First place correlates with breadth of *load-bearing* Flare primitives

RampNet won 1st with FDC + FTSO + FAssets + LayerZero. Veil won 1st at Cannes 2026 with TEE + Smart Accounts +
FTSO + FXRP. goddid won 1st at Buenos Aires with FDC + FAssets (and notably **no FTSO at all**). The pattern is
not "use more" but "make each one load-bearing". Ledgerline has three, with FAssets in **both directions**,
which is rarer than it sounds.

### The single trick that took 1st place, worth copying

**goddid streamed the live FDC attestation into the browser.** Its Next.js API route `spawn`s the actual
Hardhat process, parses stdout line by line, and pushes it to the frontend over Server-Sent Events into an
"Attestation Logs" panel — regex-extracting the Flare voting-round explorer links and re-emitting them as
clickable links. During the demo a judge watches, in real time: request prepared → attestation submitted →
"waiting for round to finalise" with live links → proof retrieved → transaction hash → decoded data appearing.

**It turned FDC's two-minute latency from a demo liability into the proof it was real.** Nobody else does this;
everyone else hides oracle latency behind a spinner or a mock. This is the highest-value unbuilt item.

### What did *not* win

- **Polish is table stakes, not the differentiator.** ParlayMarket had the best UI of its cohort, a live Vercel
  demo and a demo video — and won nothing, because its `fdcHubAddress` was `0x0000...0000` with a TODO beside
  it. fYield won 3rd with *no live demo at all*.
- **Code volume correlates negatively.** PredictYield shipped 266KB of Solidity across 18 contracts with
  invented Flare interfaces that were never deployed, and lost. fYield won with 14KB and 3 contracts.
- **Over-claiming is fatal.** Every non-winner's README claimed more than the code delivered ("FULLY
  OPERATIONAL", "state channels", "all 4 Flare protocols"). Flare Flow generated fake tx hashes with
  `crypto.randomBytes` and published three that do not exist on chain.

### Cheap edges almost every winner left on the table

- **Source verification is the exception.** Across two full winner cohorts, most contracts were unverified.
  Ours are verified — keep it that way.
- **Roadmaps: absent entirely** in the Prague cohort. Limitations sections: 2 of 5.
- **Real transactions beyond deployment** separated winners from losers cleanly. We have those.
- **Traction/users: nobody has any**, including our direct competitor. Any real third-party user is a visible
  edge and the hackathon explicitly invites it.

### Where Flare itself is heading

Cannes 2026's brief dropped "use an enshrined data protocol" entirely in favour of **TEE Extensions and Smart
Accounts**, and **all five winners were TEE-centric**. Summer Signal's second bounty is Confidential Compute.
Our README already names the privacy flaw the proof line creates and specifies Flare Confidential Compute as
the fix without building it — that is deliberately aligned with where Flare is going, and it is the right call:
the TEE stack is unstable enough that teams have lost days to it.

### The direct competitor: FlightGuard

`https://github.com/ace-coderr/flightguard` · live at `https://flightguard.vercel.app` · current contract
`0x374F52c6cbe43f092453e95E4580016aD9ff5fc3` (the widely-quoted `0x1126B59a…` is a **superseded** deployment).

Parametric flight-delay insurance. Real, credible, and deep: FDC + FTSO + FXRP all genuinely load-bearing, four
fully verified contracts, 101 tests, a live frontend with real flight data, and a 38KB README that is unusually
self-critical. **We will not beat it by using more Flare protocols.**

Its exploitable weaknesses:

1. **No demo video.** Still `_[link — coming]_`.
2. **Its live contract's only end-to-end run failed** — a 942-minute-late flight settled as `DataUnavailable`,
   no payout — and that failure is what `/policy/0`, the first receipt a judge clicks, displays.
3. **Its best proofs live on three superseded addresses**, so judges must accept a "bytecode unchanged across
   redeploys" argument. **This is currently our weakness too — see §6.**
4. **Zero users.** Every transaction but one comes from the dev's own wallet.
5. Repo is ~two-thirds untouched `flare-hardhat-starter` boilerplate; no license file.

---

## 6. What is left to do — the 4-day plan

Ordered by what loses the prize if skipped.

### Priority 1 — the demo must work for a judge who is not us

- **Deploy the frontend publicly** (Vercel). Right now it is localhost-only, so a judge cannot test anything,
  and "test the demo where possible" is in the submission requirements. FlightGuard has this and we do not.
- **Re-run the full flow on the current contracts.** The treasury is **empty** and the live app cannot
  presently issue an advance — that is a demo-day failure waiting to happen, and it is exactly the mistake
  FlightGuard made. Blocked on claiming FXRP from https://faucet.flare.network/coston2 (100 C2FLR, 10 FXRP per
  address per 24h) to `0x5c051991900E6202430d28B26c9D21C7C23ef290`. Then run, in order:
  `deploy.ts` is not needed — just fund the treasury, then `take-advance.ts`, `apply-repayment.ts`,
  `advance-to-xrpl.ts`. Update every transaction link in `README.md` and `docs/DEMO.md` so all of them point at
  the contracts a judge will actually open.

### Priority 2 — the video

Record it. FlightGuard does not have one, and "does the demo work" is a scored criterion. The script is already
written at `docs/DEMO.md`, built around real transactions, so this is read-and-record rather than design. Under
five minutes. Do not cut the honesty section.

### Priority 3 — evidence of new work

A full fifth of the score, and an hour of writing. Add a section to `README.md` separating precisely what came
from `flare-hardhat-starter` from what was written for this hackathon. Everything in `contracts/ledgerline/`,
`scripts/ledgerline/`, `test/` and `web/` is new; the starter's own examples are untouched and were used only
to validate the environment. Say that explicitly with file paths.

### Priority 4 — the goddid move: stream the FDC attestation live into the UI

Highest-value remaining build, and it targets "Flare integration quality" directly. Add a Next.js API route
that spawns `attest-revenue.ts`, streams stdout over Server-Sent Events, and renders it in a panel — extracting
the voting-round explorer links as clickable links. The page already polls and animates when a period lands, so
the payoff is a judge watching the attestation finalise and then the figure resolve in. Roughly a day.

### Priority 5 — traction and hygiene

- Get three or four people to run an advance from their own wallets. Neither we nor FlightGuard has a single
  third-party user, and the hackathon explicitly asks about early usage and testing. Screenshot the explorer.
- Add a `LICENSE`.
- Put a signpost at the top of the README pointing at our handful of files among the starter's forty, so a
  judge browsing `contracts/` does not have to hunt.

### Explicitly do not do

- **Do not enter Bounty 2** (Confidential Compute). It is not built, and the README already converts that into
  a strength by naming the flaw and specifying the fix.
- **Do not build the TEE integration.** Teams have lost days to it; risking a complete, deployed, working
  product four days out is a bad trade.
- **Do not add more Flare protocols for points.** Winners used few, deeply. Secure RNG has no honest role here.

---

## 7. How to work on this

- Commit after each meaningful change, with a message saying what now works.
- Run `npx hardhat test` before claiming anything is done. 46 tests should pass.
- Anything touching money conversions gets a test with a large price move in it.
- If a step is blocked, write the blocker into `docs/BLOCKERS.md` with the exact error and stop, rather than
  inventing a workaround that hides the problem.
- Never put a secret key into an attestation, and never commit `.env`.
- Be accurate in the README. The clearest signal in the research is that over-claiming is what separated losers
  from winners; every non-winner claimed more than its code delivered.
