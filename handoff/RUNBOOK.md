# Ledgerline — what is left to do, in order

**Deadline: 14 August 2026, 19:59.** It is 11 August. Everything below is about **3–4 hours of work**, so
there is real slack — pace it, do not rush the video.

Work from `/home/prashant/projects/flare`. Every command assumes that directory unless it says otherwise.

---

## Where things stand

| | |
|---|---|
| Contracts | Written, 129 tests passing, all source-verified on Coston2 |
| Revenue attestation | Working, run on chain four times from real Stripe API calls |
| Live attestation console | Built and verified end to end (116s) |
| XRPL repayment leg | Written, 19 tests, mechanism verified on real infrastructure — **not deployed** |
| Frontend | Builds clean, mobile checked, dark mode |
| Treasury | **Empty.** No advance can be issued until you claim FXRP |
| GitHub repo | **Does not exist.** 24 commits sit on local `main` only |
| Public demo | **Not deployed** |
| Video | **Not recorded** |

The last four rows are what you are about to fix.

---

# Step 1 — Put the repo on GitHub

**Why first:** "GitHub repo" is a hard submission requirement, and right now the work exists in exactly one
place. Do this before anything else so a disk failure cannot end the project.

**Safety check already done:** only `.env.example` is tracked. Your `.env`, the Stripe keys, the private key
and the XRPL seeds are all gitignored. Verified with a secret scan — it is safe to make this public.

```bash
# Create the repo and push. Needs the gh CLI; if you do not have it, create the repo
# at https://github.com/new instead and use the two commands underneath.
gh repo create ledgerline --public --source=. --remote=origin --push
```

Without `gh`:

```bash
git remote add origin https://github.com/<your-username>/ledgerline.git
git push -u origin main
```

**Check:** open the repo in a browser. Confirm `README.md` renders, and confirm **`.env` is not there**.

> Re-run `git push` at the end of Step 6. This first push is insurance, not the final one.

---

# Step 2 — Claim from the faucet

**Why:** the treasury is empty, so the live app cannot issue an advance. This is the single thing blocking
the most work, and it takes two minutes.

1. Go to **https://faucet.flare.network/coston2**
2. Paste the wallet address: **`0x5c051991900E6202430d28B26c9D21C7C23ef290`**
3. Claim **both** C2FLR and FXRP. The limit is 100 C2FLR and 10 FXRP per address per 24 hours.

**Check:**

```bash
npx hardhat run scripts/ledgerline/state.ts --network coston2
```

You want `FXRP` under `wallet` to read `10.0`. C2FLR is already at ~90, which is plenty for gas.

> **If the faucet refuses** (rate limit, captcha loop): everything except issuing an advance still works, and
> the interface already says so plainly rather than reverting. Skip to Step 4, do the FXRP-free parts, and
> come back. Do not let this block the video.

---

# Step 3 — Decide: redeploy, or ship what is on chain?

This is the one real judgement call left.

**The situation.** `repayFromXrpl` — the XRPL repayment leg — is written, tested and its mechanism verified
against the live network, but the deployed `AdvanceManager` predates it. Putting it on chain means a new
address, which means updating 12 files and re-verifying.

|  | Redeploy | Ship as-is |
|---|---|---|
| Effort | ~30 min | 0 |
| Gain | The XRPL loop is live and demonstrable | — |
| Risk | Address churn late in the day | None |
| README honesty | Already written for either outcome | Already written for either outcome |

**Recommendation: redeploy, but only if Step 2 gave you FXRP and it is not the 14th.** A working closed loop
between two chains is the strongest thing this project has. If the faucet failed or you are short on time,
**skip to Step 4** — the README already describes this leg accurately as built-and-tested-but-not-deployed,
which costs you nothing.

### 3a. Redeploy

The oracle is **reused deliberately** — it holds every period ever proven, and redeploying it would throw
that history away.

```bash
export $(grep -E '^XRPL_TREASURY_ADDRESS=' .env | xargs)

ORACLE_ADDRESS=0x80D08369E1a34e8c7C43FCF947323e56e6B87Be6 \
XRPL_TREASURY_ADDRESS=$XRPL_TREASURY_ADDRESS \
npx hardhat run scripts/ledgerline/deploy.ts --network coston2
```

It will print `MANAGER_ADDRESS=0x…`. **Copy it.** It also funds the treasury from whatever FXRP you hold and
verifies the source on the explorer.

### 3b. Update the address everywhere

One occurrence in each of 12 files:

```bash
OLD=<the address being replaced>
NEW=<paste the new MANAGER_ADDRESS here>

grep -rl "$OLD" --include=*.ts --include=*.tsx --include=*.md . \
  | grep -v node_modules | grep -v "handoff/BRIEF.md" | grep -v "verify-claims.ts" \
  | xargs sed -i "s/$OLD/$NEW/g"

grep -rln "$OLD" --include=*.ts --include=*.tsx --include=*.md . | grep -v node_modules
# ^ should print only verify-claims.ts and handoff/BRIEF.md
```

Two files are excluded on purpose. `handoff/BRIEF.md` is a point-in-time document and rewriting it would
misrepresent what was true when it was written. `scripts/ledgerline/verify-claims.ts` needs to keep **both**
addresses, because transactions cited in the documentation were sent to whichever deployment was current at
the time — add the new one to its `NAMED` map rather than replacing the old one, or the checker prints bare
hex for perfectly good historical transactions and it reads like a failure.

### 3c. Re-check

```bash
npx hardhat test                                                    # 65 passing
npx hardhat run scripts/ledgerline/state.ts --network coston2       # treasury should show ~10 FXRP
cd web && npm run build && cd ..                                    # builds clean
```

---

# Step 4 — Run the flow on chain

Do this against whichever `AdvanceManager` you settled on. Each command prints every number it used.

### 4a. Prove a fresh period of revenue

```bash
REVENUE_SOURCE=stripe ACCOUNT_REF=acct_1U2HbaRh1zuX9OfD \
npx hardhat run scripts/ledgerline/attest-revenue.ts --network coston2
```

Takes about two minutes — the voting round has to close and be relayed. **Copy the transaction hash.**

> If the Stripe sandbox has gone quiet, reseed it first:
> `npx hardhat run scripts/ledgerline/stripe-seed.ts --network coston2`

### 4b. Take an advance

```bash
PLATFORM=stripe ACCOUNT_REF=acct_1U2HbaRh1zuX9OfD USD_CENTS=200 \
npx hardhat run scripts/ledgerline/take-advance.ts --network coston2
```

$2.00, so 10 FXRP goes a long way. **Copy the hash.**

### 4c. Let revenue repay it

```bash
REVENUE_SOURCE=stripe ACCOUNT_REF=acct_1U2HbaRh1zuX9OfD \
npx hardhat run scripts/ledgerline/attest-revenue.ts --network coston2

PLATFORM=stripe ACCOUNT_REF=acct_1U2HbaRh1zuX9OfD \
npx hardhat run scripts/ledgerline/apply-repayment.ts --network coston2
```

Watch the debt fall. **This is the mechanism the whole product turns on** — a proven period reduced the debt
with nobody deciding to pay. Copy both hashes.

### 4d. Only if you redeployed — the XRPL loop

Needs 10 FXRP in the treasury (one lot).

```bash
export $(grep -E '^XRPL_BORROWER_ADDRESS=' .env | xargs)

# Money out: FAssets redeems, an agent pays real XRP to the XRP Ledger
PLATFORM=stripe ACCOUNT_REF=acct_1U2HbaRh1zuX9OfD \
LOTS=1 XRPL_ADDRESS=$XRPL_BORROWER_ADDRESS \
npx hardhat run scripts/ledgerline/advance-to-xrpl.ts --network coston2

# Money back: a plain XRP payment, proven on Flare by an FDC Payment attestation
export $(grep -E '^XRPL_BORROWER_SECRET=' .env | xargs)
XRPL_SECRET=$XRPL_BORROWER_SECRET XRP_AMOUNT=5 \
PLATFORM=stripe ACCOUNT_REF=acct_1U2HbaRh1zuX9OfD \
npx hardhat run scripts/ledgerline/repay-from-xrpl.ts --network coston2
```

The second one takes ~2 minutes and will print the debt falling. If it works, **this is your headline** —
funded in real XRP, repaid in real XRP, obligation never left Flare.

> The XRPL accounts were generated for you and are in `.env`:
> borrower `r3RjV3S6uA91brUmfNsUjmFvudraofQ6d4`, treasury `r9aTnFEPnSceeGjDgcbhqsK3epizmZGC2o`.
> Top the borrower up free at https://faucet.altnet.rippletest.net if it runs low.

### 4e. Update the evidence, then verify it

Put the new hashes into the table in `README.md` under *It works, on a real Stripe account*, then:

```bash
npx hardhat run scripts/ledgerline/verify-claims.ts --network coston2
```

**This must exit clean.** It resolves every hash cited in the README and `docs/` against the chain and fails
if any claim is not backed. A document claiming a transaction that does not exist is the single fastest way
to lose a judge.

---

# Step 5 — Deploy the interface publicly

**Why it matters:** "test the demo where possible" is in the submission requirements, and right now a judge
cannot reach anything. Our closest competitor has a live site and no video; we should have both.

```bash
cd web
npx vercel          # first run links the project — accept the defaults
```

Because you run it from inside `web/`, that becomes the project root and no root-directory setting is needed.

Then set the environment variables. Only the first is a secret:

```bash
npx vercel env add STRIPE_API_KEY production          # paste the rk_test_… key from .env
npx vercel env add LEDGERLINE_ACCOUNT_REF production  # acct_1U2HbaRh1zuX9OfD
npx vercel env add NEXT_PUBLIC_ACCOUNT_REF production # acct_1U2HbaRh1zuX9OfD
```

The verifier and DA-layer URLs are already defaulted in code, so you can skip those.

**Never set `PRIVATE_KEY`.** The deployed app signs nothing — every transaction is signed by the visitor's
own wallet, which is exactly why a stranger can run a real attestation on it.

```bash
npx vercel --prod
cd ..
```

**Check the deployment:**

```bash
curl -s https://<your-deployment>/api/attest/proof \
  -H 'Content-Type: application/json' \
  -d '{"votingRoundId":1422353,"requestBytes":"0xdeadbeef"}'
# expect: {"pending":true,...}
```

Then open it, connect a wallet on Coston2, pick **Yours**, and run an attestation. It should finish in about
two minutes. Full detail in [docs/DEPLOY.md](../docs/DEPLOY.md).

---

# Step 6 — Put the live link in the README, and push

Add the URL near the top of `README.md`, just under the title:

```markdown
**Live demo: https://<your-deployment>** · Coston2 testnet, chain id 114
```

Then:

```bash
npx hardhat test                    # 65 passing
cd web && npm run build && cd ..    # clean
npx hardhat run scripts/ledgerline/verify-claims.ts --network coston2   # clean

git add -A
git commit -m "add the live demo link and refresh the on-chain evidence"
git push
```

---

# Step 7 — Record the video

Script is written and timed at [docs/DEMO.md](../docs/DEMO.md). Under five minutes. Read-and-record, not
design.

**The four things that matter:**

1. **Do not cut the attestation wait.** Press *Run an attestation* in the browser and let the console fill
   in. Click through to Flare's systems explorer while the round is still open. That click is the moment a
   sceptic stops assuming the number came from a database. It is the strongest 90 seconds you have.
2. **Show the repayment.** A proven period reducing a debt with nobody deciding to pay is the product.
3. **Keep the honesty section.** Unsecured credit, the published Stripe key. Every non-winner in the research
   over-claimed; being the team that names its own weaknesses is a real differentiator.
4. **Say it is self-serve.** A judge can run a real FDC attestation on the deployed site with their own
   wallet. Nobody else offers that.

Record at 1080p, upload unlisted to YouTube, and put the link in the README next to the demo link.

---

# Step 8 — Submit on DoraHacks

**https://dorahacks.io/hackathon/flaresummersignal/detail** — Bounty 1, Interoperable Asset Products.
**Do not enter Bounty 2.** Confidential Compute is not built, and the README already turns that into a
strength by naming the flaw and specifying the fix.

Answers you can paste, all backed by what is in the repo:

**Project name** — Ledgerline

**Bounty** — Interoperable Asset Products

**Short product description** — Advances against revenue a payment processor already proves. Flare's Data
Connector attests a business's Stripe revenue on chain with a Merkle proof, a contract underwrites an advance
against that proven figure, and each newly attested period repays part of it automatically. The obligation is
denominated in US dollars via FTSOv2, and settles as FXRP on Flare or as real XRP on the XRP Ledger.

**Target user** — A creator or small online business with real, provable earnings and no way to borrow
against them. A 22-year-old earning $4,000/month on Stripe has no credit file for a bank and no crypto
collateral for DeFi.

**Demo link** — your Vercel URL · **Video** — your YouTube link · **Repo** — your GitHub URL

**How it uses Flare** — point at the *How Flare is used* section. In one line: FDC Web2Json is the
underwriting, FDC Payment closes the loop back from the XRP Ledger, FTSOv2 makes the debt a dollar debt
rather than a bet, and FAssets is the money that moves in both directions.

**What was newly built** — point at *What was built during the hackathon*. It is already written to the
three-way split the form asks for: what existed before (nothing — an unmodified starter clone), what was
newly built, and what was integrated or improved.

**Contract addresses** —

| | |
|---|---|
| `RevenueOracle` | `0x80D08369E1a34e8c7C43FCF947323e56e6B87Be6` |
| `AdvanceManager` | `0x63fC5a5c422D40DcC8FA267384BA5351d8698A58` *(update if you redeployed)* |

Both source-verified. Coston2, chain id 114.

**Roadmap** — point at the *Roadmap* section, seven items, led by the XRPL repayment leg and Flare Smart
Accounts.

**The encouraged extras — answer them, most teams skip them and they are free marks:**

- *Which network* — Coston2 (chain id 114), XRPL testnet for the XRP Ledger leg.
- *Testing* — 65 automated tests, plus the manual on-chain runs listed in the README with hashes, plus
  `verify-claims.ts`, which checks every transaction the documentation cites against the chain.
- *Traction* — say plainly that there are none yet, and that the sandbox source exists so a stranger can run
  the whole loop against their own wallet without a Stripe account. Honesty here reads better than a
  stretched claim; the research shows nobody in this field has users, including the closest competitor.

---

## If something breaks

| Symptom | Cause | Fix |
|---|---|---|
| `InsufficientTreasury` | Treasury is empty | Step 2, then `fund-treasury.ts` |
| Attestation stalls past 5 min | Round genuinely not relayed | Check `https://coston2-systems-explorer.flare.network/voting-round/<round>?tab=fdc` |
| `gasUsed == gasLimit` on the XRPL leg | `estimateGas` under-counts redemption | Already handled — explicit `gas: 6_000_000` |
| `NotAccountOwner` | Account bound to a different wallet | Use the bound wallet, or the sandbox source |
| `standardPaymentReference` is zero | Memo not exactly 32 bytes, or you used `InvoiceID` | One memo, exactly 32 bytes. FDC ignores `InvoiceID` |
| Verifier rejects the request | Stripe key is `sk_`, not `rk_` | Use the restricted key — the guard is deliberate |

Anything genuinely blocked goes in `docs/BLOCKERS.md` with the exact error, rather than being worked around
in a way that hides it.

---

## The one thing not to lose sight of

The research across 17 Flare hackathons was blunt about it: **over-claiming is what separated losers from
winners.** Every non-winner's README claimed more than the code delivered. This repo currently claims exactly
what it does, no more — the XRPL leg is described as built-and-tested-but-not-deployed, traction is described
as zero, and `verify-claims.ts` exists so anyone can check the transaction hashes themselves.

Keep it that way through the last three days. It is a genuine edge.
