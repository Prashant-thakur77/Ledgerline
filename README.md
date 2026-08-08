# Ledgerline

**Advances against revenue your payment processor already proves.**

Flare Summer Signal · Bounty 1, Interoperable Asset Products · Coston2

---

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

The Stripe sandbox took three charges totalling $4,030. Stripe's fees brought the net to $3,912.23, and that
net is the figure underwritten, because it is the money the business actually keeps.

Step 4 is the mechanism the whole product turns on: a newly proven period of revenue reduced the debt without
anyone deciding to pay. The dollar figure fell by exactly the agreed 20% of that period's revenue, and the FXRP
that moved was priced at the rate current at that moment rather than the rate at origination.

## Deployed on Coston2 (chain id 114)

| Contract | Address |
|---|---|
| `RevenueOracle` | [`0x47C6d20206AbD9413d345d45c65aB8a074Ca28a8`](https://coston2-explorer.flare.network/address/0x47C6d20206AbD9413d345d45c65aB8a074Ca28a8#code) |
| `AdvanceManager` | [`0x5774E51335277893c5f177bb6735b4CF2fE76A63`](https://coston2-explorer.flare.network/address/0x5774E51335277893c5f177bb6735b4CF2fE76A63#code) |
| FXRP (`FTestXRP`) | [`0x0b6A3645c240605887a5532109323A3E12273dc7`](https://coston2-explorer.flare.network/address/0x0b6A3645c240605887a5532109323A3E12273dc7) |

Both contracts are source-verified on the explorer. Full deployment notes in [docs/DEPLOYED.md](docs/DEPLOYED.md).

## How to run it

```bash
cp .env.example .env          # add PRIVATE_KEY, and STRIPE_API_KEY if attesting Stripe
yarn install
yarn hardhat test             # 34 tests

# fund a wallet at https://faucet.flare.network/coston2 — 100 C2FLR, 10 FXRP per day
yarn hardhat run scripts/ledgerline/deploy.ts --network coston2

# prove a period of revenue, then borrow against it
REVENUE_SOURCE=stripe ACCOUNT_REF=acct_… yarn hardhat run scripts/ledgerline/attest-revenue.ts --network coston2
PLATFORM=stripe ACCOUNT_REF=acct_… USD_CENTS=200 yarn hardhat run scripts/ledgerline/take-advance.ts --network coston2

cd web && npm install && npm run dev      # the interface, on :3000
```

`REVENUE_SOURCE=demo` runs the same pipeline against a keyless public endpoint, so the whole flow can be
demonstrated without a Stripe account.

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

**FAssets is the money that moves.** The advance is disbursed in FXRP, which is XRP made usable by smart
contracts. **Without it there is no XRP-denominated asset a contract can hold or transfer at all** — XRP has no
native smart contract capability, so the disbursement leg would have to be some other chain's asset and the
product would stop being about XRP.

Honestly stated: this build **uses** FXRP as the disbursed asset but does not yet **mint or redeem** through
the FAssets flow. That is the first item on the roadmap, and it is the difference between using the asset and
using the bridge.

## What was built during the hackathon

Everything in `contracts/ledgerline/`, `scripts/ledgerline/`, `test/` and `web/` is new. The repository is the
[flare-hardhat-starter](https://github.com/flare-foundation/flare-hardhat-starter); its own examples are
untouched and were used only to validate the environment in Phase 0.

- **`RevenueOracle.sol`** — verifies a Web2Json proof, derives account identity from the attested payload
  rather than caller input, and stores revenue history. Guards replay, account mismatch, stale periods, and
  a second wallet claiming an already bound account.
- **`AdvanceManager.sol`** — underwriting, FTSO conversion, FXRP treasury, manual and revenue-triggered
  repayment, delinquency.
- **34 tests**, including the 3x price move and a case asserting the same price at 6 and 8 decimals yields the
  same answer.
- **`scripts/ledgerline/`** — attestation with round-waiting and progress, Stripe sandbox seeding, deployment
  with explorer verification, and a per-platform jq registry.
- **`web/`** — Next.js and wagmi interface.
- **[docs/PHASE0.md](docs/PHASE0.md)** — the environment validation, with every address and encoding written down.

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

## Roadmap

1. **The XRPL leg.** Redeem FXRP through FAssets so the borrower receives real XRP in the wallet they already
   use, and accept repayment as a plain XRP payment proven by FDC's Payment attestation. This removes the EVM
   wallet requirement entirely — the borrower would never need one. Scoped and understood; cut from this build
   for time rather than for difficulty.
2. **A second platform.** Shopify or YouTube. The oracle already takes `platform` as a field and `accountRef`
   as opaque, so this is an entry in `revenue-sources.ts` and no contract change.
3. **A lender side.** The treasury is a single owner-funded pool today. Real capital needs LP shares, a yield
   split and default accounting.
4. **Underwriting that uses the trend.** The full history is stored and currently only averaged. Growth,
   volatility and seasonality are all visible in it.
5. **Per-borrower key scoping**, so the published key reads one account's aggregate and nothing else.
