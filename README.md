# Ledgerline

**Advances against revenue your payment processor already proves.**

Flare Summer Signal · Bounty 1, Interoperable Asset Products · Coston2

---

## Where the code is

This repository is a fork of the [flare-hardhat-starter](https://github.com/flare-foundation/flare-hardhat-starter),
so most of what you see is the starter's own examples, untouched. **Everything written for this hackathon is in
these six places:**

| Path | What it is |
|---|---|
| [`contracts/ledgerline/`](contracts/ledgerline/) | The two contracts. ~330 lines of Solidity, both source-verified on chain. |
| [`test/`](test/) | 46 tests. `RevenueOracle` (13), `AdvanceManager` (23), `AdvanceToXrpl` (10). |
| [`scripts/ledgerline/`](scripts/ledgerline/) | Deploy, attest, borrow, repay, redeem to XRPL, and a one-screen state dump. |
| [`web/app/`](web/app/) | The interface, including the live attestation console and its two API routes. |
| [`web/lib/`](web/lib/) | The Flare protocol layer the browser drives an attestation with. |
| [`docs/`](docs/) | Phase 0 validation, deployment record, demo script, blockers. |

Nothing else in the repository was modified. The starter's examples were used only to validate the
environment in Phase 0 and are left exactly as they came.

## The problem

Revenue based financing is a large offchain industry. Pipe, Capchase and Wayflyer advance money against
recurring revenue, and they do it by reading a business's payment processor with permission. It works, and it
is closed to most of the world: small ticket sizes are unprofitable for them, and coverage is limited to a
handful of countries.

Onchain lending cannot do this at all, for one reason. **A smart contract cannot read a Stripe dashboard.**
Anyone can claim any income. The only workaround has been to trust a company's server to vouch for the number,
which reintroduces exactly the intermediary the system was supposed to remove.

Flare's Data Connector removes that. Web2Json calls the API and the network's own data providers agree on the
response, which arrives on Flare with a Merkle proof. The revenue figure is proven the way a price feed is
proven. No application specific oracle, no trusted server, nobody to bribe.

In one line: **your payment processor already proves you earn four thousand dollars a month, no lender can read
it, and FDC can.**

## Who it is for

A creator or small online business with real, provable earnings and no way to borrow against them. A 22 year
old earning four thousand dollars a month on Stripe has no credit file for a bank and no crypto collateral for
DeFi. They have a revenue history, and until now that history could not be used as anything.

## It works, on a real Stripe account

Not a mock. These are transactions on Coston2 from a live Stripe API call.

| | |
|---|---|
| 1. Revenue attested — **$3,912.23** read from Stripe, proven on chain | [`0x8bea3e15…`](https://coston2-explorer.flare.network/tx/0x8bea3e154e9bbc70dde5fd32bad90a54aa52a2e68205600e431b4900f77d88af) |
| 2. Advance issued — **1.918796 FXRP** sent for a **$2.10** obligation | [`0x7996ce9c…`](https://coston2-explorer.flare.network/tx/0x7996ce9cc7e91c2f81bdae01694e56798fa932ad4b8b5468ce43de5333e2e585) |
| 3. A new period attested — **$4.55** | [`0x768f0d23…`](https://coston2-explorer.flare.network/tx/0x768f0d23dd981277d5617fc978d4716f15e0bc39f0dc7b5117270bcb22c38515) |
| 4. It repaid itself — 20% taken, **0.873727 FXRP**, debt **$2.10 → $1.19** | [`0x1331a9b5…`](https://coston2-explorer.flare.network/tx/0x1331a9b5f83de8d07f77df33eaa56bc599b85127c6fb9511a24407b38f86dd82) |
| 5. An advance paid out as **real XRP on the XRP Ledger** | [`0x96ec23d1…`](https://coston2-explorer.flare.network/tx/0x96ec23d1a6a66fae6a71d3a8c67bd9d5b158d706d04de49d36b3d7ba198922ff) |

The Stripe sandbox took three charges totalling $4,030. Stripe's fees brought the net to $3,912.23, and that
net is the figure underwritten, because it is the money the business actually keeps.

Step 4 is the mechanism the whole product turns on: a newly proven period of revenue reduced the debt without
anyone deciding to pay. The dollar figure fell by exactly the agreed 20% of that period's revenue, and the FXRP
that moved was priced at the rate current at that moment rather than the rate at origination.

**Step 5 is the one worth pausing on.** `requestAdvanceToXrpl` redeemed the FXRP through FAssets rather than
transferring it, and a FAssets agent paid the borrower's XRP Ledger address directly:

| | |
|---|---|
| XRPL payment | [`784C8E73…`](https://testnet.xrpl.org/transactions/784C8E73E1417C2600F7E6473FEE3CB43DEABFCDA008192789AB81F3BFD41534) |
| Paid by agent | `r4GHJwGSaGmJy9BBXS9osFXqRjqdSm7v83` |
| Received | **9.95 XRP** (10 XRP less the agent's redemption fee), balance 100 → 109.95 |
| Debt recorded on Flare | **$10.92** — $10.40 principal at $1.040793, plus fee |

The borrower ends up holding **real XRP in an ordinary XRP Ledger account**. They never held FXRP, never
signed an EVM transaction to receive it, and would not need an EVM wallet at all if the request were placed on
their behalf. The revenue was proven from a Web2 API, underwritten on Flare, and settled on a chain with no
smart contracts of its own.

> Those five transactions were run against the deployment listed below before `RevenueOracle` was extended to
> record the FDC voting round and Merkle root on each figure — the data the interface needs to show its work.
> The contracts were then redeployed and the revenue re-attested at
> [`0xede1d3f8…`](https://coston2-explorer.flare.network/tx/0xede1d3f8bcb4292c928a59f6f4fb45aac43c76e5b9d0ac8a321b5004dfeb33b6):
> **$3,916.78**, FDC round **1,419,988**, Merkle root `0x4db0a6fe…39b2`. The five above remain exactly what
> happened; they simply predate that field.

## Deployed on Coston2 (chain id 114)

| Contract | Address |
|---|---|
| `RevenueOracle` | [`0x80D08369E1a34e8c7C43FCF947323e56e6B87Be6`](https://coston2-explorer.flare.network/address/0x80D08369E1a34e8c7C43FCF947323e56e6B87Be6#code) |
| `AdvanceManager` | [`0x4EC83Eb966dcac3e4291c85320Cfd6941a7C4f66`](https://coston2-explorer.flare.network/address/0x4EC83Eb966dcac3e4291c85320Cfd6941a7C4f66#code) |
| FAssets `AssetManager` (FXRP) | [`0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`](https://coston2-explorer.flare.network/address/0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA) |
| FXRP (`FTestXRP`) | [`0x0b6A3645c240605887a5532109323A3E12273dc7`](https://coston2-explorer.flare.network/address/0x0b6A3645c240605887a5532109323A3E12273dc7) |

Both contracts are source-verified on the explorer. Full deployment notes in [docs/DEPLOYED.md](docs/DEPLOYED.md).

## How to run it

```bash
cp .env.example .env          # add PRIVATE_KEY, and STRIPE_API_KEY if attesting Stripe
yarn install
yarn hardhat test             # 46 tests

# fund a wallet at https://faucet.flare.network/coston2 — 100 C2FLR, 10 FXRP per day
yarn hardhat run scripts/ledgerline/deploy.ts --network coston2

# prove a period of revenue, then borrow against it
REVENUE_SOURCE=stripe ACCOUNT_REF=acct_… yarn hardhat run scripts/ledgerline/attest-revenue.ts --network coston2
PLATFORM=stripe ACCOUNT_REF=acct_… USD_CENTS=200 yarn hardhat run scripts/ledgerline/take-advance.ts --network coston2

# or take it as real XRP on the XRP Ledger instead — needs whole lots, 10 XRP each
XRPL_ADDRESS=r… LOTS=1 yarn hardhat run scripts/ledgerline/advance-to-xrpl.ts --network coston2

# a newly attested period repays part of the advance
yarn hardhat run scripts/ledgerline/apply-repayment.ts --network coston2

cd web && npm install && npm run dev      # the interface, on :3000
```

`REVENUE_SOURCE=demo` runs the same pipeline against a keyless public endpoint, so the whole flow can be
demonstrated without a Stripe account.

`npx hardhat run scripts/ledgerline/state.ts --network coston2` prints the whole live position in one screen —
balances, treasury, every proven period, the limit, the FTSO price and any open advance. Run it before a demo.

### The interface

`web/` needs its own `.env.local`. Only one of these is a secret:

```bash
STRIPE_API_KEY=rk_test_…        # read-only restricted key; without it, only the sandbox source is offered
VERIFIER_URL_TESTNET=https://fdc-verifiers-testnet.flare.network
VERIFIER_API_KEY_TESTNET=00000000-0000-0000-0000-000000000000   # the documented public testnet key
COSTON2_DA_LAYER_URL=https://ctn2-data-availability.flare.network
LEDGERLINE_ACCOUNT_REF=acct_…   # the Stripe account this deployment may attest
```

`LEDGERLINE_ACCOUNT_REF` is pinned server-side deliberately: the Stripe key belongs to the deployment, so
without it a visitor could attest our revenue under an account reference of their own choosing and bind the
resulting record to their wallet.

## How Flare is used

Three Flare systems do load-bearing work here. Removing any one does not degrade the product; it deletes it.

**FDC Web2Json is the underwriting.** It is the only reason this product can exist on chain at all. It calls
Stripe, reduces the response with a jq filter that every data provider runs independently, and delivers the
result with a Merkle proof that `RevenueOracle` verifies before storing anything. **Without it there is no way
to know anyone's revenue**, and the contract would be underwriting self-reported numbers — which is to say, not
underwriting at all. The alternative every other design falls back on is a server that signs the figure, and
that server is precisely the intermediary this is supposed to remove.

**FTSOv2 makes the obligation a dollar obligation.** The advance is recorded in US cents and converted to FXRP
at the rate read at the moment value moves. A borrower who takes $1,000 owes $1,000 plus the fee, whatever XRP
does next. **Without it the debt would be denominated in XRP**, so a borrower advanced $1,000 could owe the
equivalent of $3,000 after a price move — turning a working capital product into a leveraged bet on a currency
the borrower never asked to hold. There is a test that moves XRP 3x and asserts the dollar obligation does not
change.

**FAssets is the money that moves, in both directions.** The advance is disbursed in FXRP, which is XRP made
usable by smart contracts, and `requestAdvanceToXrpl` redeems that FXRP back to **real XRP paid to the
borrower's XRP Ledger account** by a FAssets agent. **Without it there is no XRP-denominated asset a contract
can hold at all** — XRP has no native smart contract capability — and without redemption the borrower would be
stuck holding a wrapped asset on a chain they never asked to use.

This is what makes the interoperability claim complete rather than merely defensible: data crosses from Web2
into Flare's EVM state via FDC, and value crosses from Flare back out to the XRP Ledger via FAssets. The
borrower's side of the transaction happens entirely on a chain that cannot run any of this logic itself.

## What was built during the hackathon

### What existed before

Nothing. There was no prior product, no prior deployment and no prior users. The starting point was an
unmodified clone of the [flare-hardhat-starter](https://github.com/flare-foundation/flare-hardhat-starter),
and the only things carried across from it are its example contracts and its FDC helper utilities in
[`scripts/utils/`](scripts/utils/), which are used as shipped.

### What was newly built

Every file listed in [Where the code is](#where-the-code-is) was written from scratch during the program.

**Contracts** — [`contracts/ledgerline/`](contracts/ledgerline/)

- **[`RevenueOracle.sol`](contracts/ledgerline/RevenueOracle.sol)** — verifies a Web2Json proof through
  Flare's own `FdcVerification`, derives account identity from the attested payload rather than caller input,
  and stores revenue history along with the voting round and the Merkle root the proof resolves to. Guards
  replay, account mismatch, stale periods, and a second wallet claiming an already-bound account.
- **[`AdvanceManager.sol`](contracts/ledgerline/AdvanceManager.sol)** — underwriting, FTSOv2 conversion, the
  FXRP treasury, `requestAdvance`, `requestAdvanceToXrpl`, manual and revenue-triggered repayment, delinquency.

**Tests** — [`test/`](test/), **46 passing**, `npx hardhat test`

Includes a 3x XRP price move asserting the dollar obligation does not change, and a case running the same
price at 6 and 8 decimals and demanding the same answer. Four mock contracts stub the FDC and FTSO calls that
only exist on a live Flare network.

**Scripts** — [`scripts/ledgerline/`](scripts/ledgerline/)

Deployment with explorer verification, the attestation pipeline with round-waiting, a per-platform jq
registry, Stripe sandbox seeding, the FXRP and XRPL legs, repayment, and a one-screen live state dump.

**The interface, and the live attestation console** — [`web/`](web/)

The part worth singling out. **The page runs a real FDC attestation from the browser and narrates it as it
happens** — composing the request, paying the FdcHub fee, reporting which voting round it landed in with a
link to Flare's systems explorer, counting the rounds until it is relayed, printing the Merkle root the moment
it exists, retrieving the proof from the Data Availability layer, decoding it, and storing it on chain.

An attestation takes a couple of minutes. Every project that uses FDC hides that behind a spinner, and hiding
it is exactly what makes an oracle look like an ordinary database call. Printing it is the point: a voting
round finalising is the one thing about this product that cannot be faked, and a sceptic can open the explorer
links while it is still in flight and watch it happen.

The path was measured end to end on Coston2 at **116 seconds** — 83 of them waiting for the round to be
relayed — and the run is on chain:

| | |
|---|---|
| Attestation requested from the browser path, round **1,422,334** | [`0x2d7a5eeb…`](https://coston2-explorer.flare.network/tx/0x2d7a5eebd1ad572e807249145ba64a963ac737a030693335efbb44dbb945b1b9) |
| Round relayed, Merkle root `0x20266de8…c15a8`, proof of 5 siblings retrieved and verified on chain | [`0x3abedd85…`](https://coston2-explorer.flare.network/tx/0x3abedd85adb5e6a5747d62061b80f5ba24a5017619acb44153b95ab0d9988b64) |

The whole loop lives in the browser deliberately —
[`web/lib/useAttestation.ts`](web/lib/useAttestation.ts) drives it, and the two server routes it calls
([`prepare`](web/app/api/attest/prepare/route.ts), [`proof`](web/app/api/attest/proof/route.ts)) are short
proxies that exist only because the FDC verifier is not CORS-open and the Stripe key must not ship in the
JavaScript bundle. Nothing waits on the server, so there is no long-running function to time out and the page
behaves identically locally and deployed.

A visitor can run the whole thing themselves against an account bound to their own wallet, using a keyless
public endpoint in place of a payment processor — same verifier, same voting round, same Merkle proof, same
on-chain verification. That path is labelled as a stand-in figure rather than revenue, because it is one.

**Docs** — [`docs/`](docs/)

[PHASE0.md](docs/PHASE0.md) records the environment validation with every address and encoding written down,
[DEPLOYED.md](docs/DEPLOYED.md) the deployment and the full path run on chain, [DEMO.md](docs/DEMO.md) the
video script, and [BLOCKERS.md](docs/BLOCKERS.md) what went wrong and what is still unresolved.

### What was integrated or improved

- **FDC Web2Json** integrated against a real authenticated third-party API (Stripe), not a public demo
  endpoint — including working out that Stripe payouts are unreachable in test mode and that balance
  transactions are the better basis anyway.
- **FAssets** integrated in the redemption direction, so an advance settles as real XRP on the XRP Ledger.
- **FTSOv2** integrated as the denomination layer, with the decimal handling that a 6-decimal XRP/USD feed and
  a 6-decimal FXRP actually require.
- The starter's FDC helpers were **reimplemented for the browser** in [`web/lib/flare.ts`](web/lib/flare.ts):
  the originals depend on Hardhat's runtime and Truffle-style artifacts, so the voting-round arithmetic,
  the registry lookups and the proof retrieval were rewritten against viem to run client-side.

## Honesty notes

**This is unsecured credit.** A borrower can take an advance and stop earning. Nothing here solves that. The
incentives that push against it are real but partial: revenue history is the reputation, defaults are recorded
on chain, and advances start small and grow with repayment history. There is no on-chain recovery, and the
contract says so rather than implying otherwise.

**The Stripe key is published on chain.** FDC attestation requests are public calldata, so the API key travels
in the clear and is permanently readable. This breaks confidentiality, not trust — the attested figure is still
proven by the network, so the integrity claim above is untouched. It is mitigated by using a read-only
restricted key scoped to two endpoints, and both source functions refuse an `sk_` key outright. The production
answer is per-borrower keys scoped to their own account. See [docs/BLOCKERS.md](docs/BLOCKERS.md).

**Underwriting has so far run on a single proven period.** The contract averages up to three, and there are
tests covering one, three and five proven periods, but a sandbox opened today cannot have three months of
history. On a real account this is not a limitation; in this demo it is.

**The demo's period boundaries are artificial.** A sandbox opened today has minutes of history, not months, so
the two attested periods are minutes apart rather than a month apart. The contract does not care — a period is
whatever the attestation says it is — but nobody should read the demo's timestamps as realistic.

**Revenue based financing is not a new idea and this does not claim to be.** What is new is doing it without a
trusted intermediary reading the API, and settling it in an asset that had no smart contract capability at all
until FAssets.

**The demo runs on Stripe test mode.** The API responses are real; the money behind them is not.

## The flaw in this design, and what fixes it

The proof line is what makes this product trustworthy. It is also what makes it unusable for a real business.

Publishing a company's monthly revenue on a public chain, permanently, is something almost no company will do.
Competitors read it. Customers read it. Anyone negotiating with them reads it. At the scale where an advance is
worth having, the transparency that earns the trust is exactly the thing that kills adoption. That is not a
small caveat — it is the difference between a demo and a business.

**Flare Confidential Compute answers it without giving up the proof.** The attested revenue goes into a TEE,
the underwriting runs inside it, and only the decision comes out: an advance limit, carrying an attestation
that the computation ran correctly on genuine attested data. Nobody sees the underlying figures — not
competitors, not us. The borrower gets credit; the numbers stay private.

For the interface it is a small change with a large effect. The proof line stays exactly where it is, in the
same colour, in the same position. It just names the computation instead of the revenue:

```
verified privately · underwriting run in tee · attestation 0x4c19…8de2 ↗
```

The figure above it becomes the limit rather than the earnings. A judge reading that line understands
immediately that the number was computed on data they cannot see and still cannot be faked.

**This is deliberately not built.** The Confidential Compute stack is difficult right now — teams in the
hackathon have lost days to a redeploy that wiped extension registrations, to indexer credentials, to Docker
image hash matching across TEE machines, and to version mismatches between `tee-node` and `tee-proxy`. Taking
that risk with a complete, working, deployed product five days from the deadline would be a bad trade. The
honest move is to name the weakness, show that the fix is understood and specified, and ship the thing that
works.

## Network, testing and what has actually been exercised

**Network.** Coston2, Flare's EVM testnet, chain id 114. The XRP Ledger leg settles on XRPL testnet. Nothing
is deployed to mainnet and nothing here involves real money.

**Automated tests.** 46, `npx hardhat test`, covering both contracts. The ones worth naming: a 3x XRP price
move asserting the dollar obligation does not change; the same price supplied at 6 and 8 decimals demanding
the same answer; replay, account-mismatch, stale-period and wrong-owner guards on the oracle; and the XRPL
redemption leg against a mock asset manager.

**Manually exercised on chain**, not just in tests: attestation from a real authenticated Stripe API call,
underwriting, an FXRP advance, a revenue-triggered repayment, a FAssets redemption that put real XRP in an
XRP Ledger account, and — most recently — the complete attestation path that the browser drives, measured at
116 seconds. Every one of those has a transaction hash in this README.

**Users.** None yet, and it would be dishonest to imply otherwise. The product has been run end to end only
by its author. The sandbox source exists precisely so that a stranger can run the whole loop against an
account bound to their own wallet without needing a Stripe account or anything from us, which is the first
step towards that changing.

**Known gaps.** The treasury needs refunding from the faucet before an advance can be issued on the live
deployment; the interface says so plainly rather than letting the button revert. Underwriting has so far run
on a single proven period. Neither is a code change.

## Feedback on building on Flare

Not required for this hackathon, but worth writing down while it is fresh.

**What worked well.** `ContractRegistry` is genuinely good — one address on every network, and everything else
resolves from it, which is why this app can look up FdcHub and the Relay at runtime instead of hard-coding a
deployment. The Web2Json attestation type is more general than it first appears: because the jq runs inside
the verifier, adding a platform is a filter, not a contract change. FAssets redemption did what it claims,
including paying out to an address on a chain with no smart contracts.

**What cost the most time.** Three things, all of them decimals or documentation rather than concepts.
XRP/USD reports 6 decimals on Coston2 while FLR/USD reports 8, and FXRP is 6 rather than 18 — anything that
assumes 18 is wrong by a factor of 10^12, and nothing warns you. `FtsoV2.getFeedById` is `payable` rather than
`view`, so a price read cannot sit behind a view function and the interface has to simulate it instead, which
is surprising the first time. And `eth_estimateGas` under-estimates a FAssets redemption because it walks the
redemption ticket queue, so the transaction fails with `gasUsed == gasLimit` while a `staticCall` succeeds —
a genuinely confusing failure that an explicit gas limit fixes.

**What would have helped most.** A note in the FDC documentation that the attestation request, including its
`headers` field, is permanently public calldata. It is obvious in hindsight and consequential: any design
that attests an authenticated API is publishing that credential. We handled it with a read-only restricted
key and a guard that refuses an `sk_` key outright, but it deserves a warning at the point of use.

## Roadmap

1. **Repayment from the XRP Ledger.** Disbursement to XRPL is built; the return leg is not. The borrower would
   send a plain XRP payment with the advance id in the memo, and FDC's **Payment** attestation would prove it
   on Flare and reduce the obligation — a second FDC attestation type, and the last step needed for a borrower
   who never touches an EVM wallet in either direction.
2. **Advances below one lot on the XRPL leg.** FAssets redeems whole lots only, 10 XRP on Coston2, so the
   smallest XRPL-settled advance is about $10. Smaller advances work on the FXRP leg. Batching or a float
   would close the gap.
3. **A second platform.** Shopify or YouTube. The oracle already takes `platform` as a field and `accountRef`
   as opaque, so this is an entry in `revenue-sources.ts` and no contract change.
4. **A lender side.** The treasury is a single owner-funded pool today. Real capital needs LP shares, a yield
   split and default accounting.
5. **Underwriting that uses the trend.** The full history is stored and currently only averaged. Growth,
   volatility and seasonality are all visible in it.
6. **Per-borrower key scoping**, so the published key reads one account's aggregate and nothing else.
