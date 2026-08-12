# Proofline

*(Ledgerline in the code: the contracts, scripts and package names keep the working name so nothing on
chain or in the history has to be re-verified for a rebrand.)*

**Advances against revenue your payment processor already proves.**

Flare Summer Signal · Bounty 1, Interoperable Asset Products · Coston2

### ▸ [ledgerline-flare.vercel.app](https://ledgerline-flare.vercel.app)

Live on Coston2, chain id 114. Nothing to install and no account needed to read it.

**You can run a real FDC attestation yourself.** Connect any wallet on Coston2, choose *Yours*, and press
*Run an attestation*. The page composes a Web2Json request, pays the FdcHub fee, tells you which voting
round it landed in with a link to Flare's own systems explorer, counts the rounds until it is relayed,
prints the Merkle root the moment it exists, retrieves the proof and stores it on chain — about two minutes,
narrated line by line. Your wallet signs; our server signs nothing.

---

## Where the code is

This repository is a fork of the [flare-hardhat-starter](https://github.com/flare-foundation/flare-hardhat-starter),
so most of what you see is the starter's own examples, untouched. **Everything written for this hackathon is in
these six places:**

| Path | What it is |
|---|---|
| [`contracts/ledgerline/`](contracts/ledgerline/) | Four contracts — oracle, manager, lender pool, private underwriter — all source-verified on chain. |
| [`test/`](test/) | 144 tests: both money paths, the tier economics (with a recycling-attack simulation), the lender pool, the private underwriter, and a 200-step invariant walk. |
| [`scripts/ledgerline/`](scripts/ledgerline/) | Deploy, attest, borrow, repay, redeem to XRPL, and a one-screen state dump. |
| [`web/app/`](web/app/) | The interface, including the live attestation console and its two API routes. |
| [`web/lib/`](web/lib/) | The Flare protocol layer the browser drives an attestation with. |
| [`fcc/`](fcc/) | The Confidential Compute extension: private underwriting on Flare's own scaffold. |
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

> Those five transactions were run against an earlier deployment, before `RevenueOracle` was extended to
> record the FDC voting round and Merkle root on each figure — the data the interface needs to show its work.
> The contracts were then redeployed. The five above remain exactly what happened; they simply predate that
> field.

That generation's `RevenueOracle` at [`0x80D08369…`](https://coston2-explorer.flare.network/address/0x80D08369E1a34e8c7C43FCF947323e56e6B87Be6#code)
holds the periods attested from live Stripe API calls:

| Period ending | Proven | FDC round | Merkle root | |
|---|---|---|---|---|
| 2026-08-08 | **$3,916.78** | 1,419,988 | `0x4db0a6fe…39b2` | [`0xede1d3f8…`](https://coston2-explorer.flare.network/tx/0xede1d3f8bcb4292c928a59f6f4fb45aac43c76e5b9d0ac8a321b5004dfeb33b6) |
| 2026-08-11 | **$3,916.78** | 1,422,337 | `0xf951aaa7…` | [`0x8abab9c3…`](https://coston2-explorer.flare.network/tx/0x8abab9c34593df83554f8f43a4fed3e06bea898695eca1ad9971b32b258b15a7) |

Both windows cover the same three Stripe charges, so they prove the same figure — the second is a fresh
attestation, not a second month of trading. That run was timed end to end at **122 seconds**.

### The loop closes: funded in real XRP, repaid in real XRP

Run against the then-current [`AdvanceManager`](https://coston2-explorer.flare.network/address/0x63fC5a5c422D40DcC8FA267384BA5351d8698A58#code), since superseded by V2 below.
Money leaves Flare for the XRP Ledger through FAssets, and comes back through a second FDC attestation type.
**No FXRP, and no EVM asset, is held by the borrower at any point in either direction.**

| | |
|---|---|
| **Out** — advance redeemed through FAssets, 1 lot | [`0x63f50a21…`](https://coston2-explorer.flare.network/tx/0x63f50a21ec6dc5638ec28ffa63f15413e8c6d580e1f52037a76d5b92144dfa92) |
| An agent paid the borrower's XRPL account | **+9.95 XRP** (10 less the redemption fee), balance 89.999976 → 99.949976 |
| Debt recorded on Flare | **$10.53** — $10.03 principal at $1.004296, plus the 5% fee |
| **Back** — a plain XRP payment, 5 XRP, one 32-byte memo | [`10E4F29B…`](https://testnet.xrpl.org/transactions/10E4F29BC5608E5438964ECB3147D34600869D389186C612505678CEE4E70AD5) |
| FDC **Payment** attestation | round **1,422,483**, proof of 3 Merkle siblings |
| `repayFromXrpl` verified it and settled the debt | [`0x99d0f4b2…`](https://coston2-explorer.flare.network/tx/0x99d0f4b26d70bc47fda3be9954741597ab7df17afe2d2d7798d2cbae198a6144) |
| Owed | **$10.53 → $5.51** |

The contract did not take the payment on trust. It checked that the attestation was for the XRP Ledger
testnet and not another chain, that the payment succeeded, that it was paid to *this* contract's XRPL
account, that its payment reference was *this* account id, that the transaction had not already been
counted — and only then, last because it is the expensive step, that the Merkle proof verifies against
Flare's own verification contract.

The reference is what makes an otherwise anonymous XRP payment settle one specific debt, and on the XRP
Ledger it has to be a single memo of exactly 32 bytes. The memo on that payment reads
`C60C21E2…6D77`, which is the account id for `stripe/acct_1U2HbaRh1zuX9OfD`.

`treasuryBalance` deliberately did not move: the XRP is on the XRP Ledger, not on Flare, and crediting the
Flare treasury would put a number in storage that no balance backs. Returning that value means minting FXRP
from the received XRP through FAssets, which is the production answer and is not built here.

### And the rest of that debt repaid itself

The $5.51 left over was settled the product's own way: a newly proven period triggered the repayment, with
nobody deciding to pay. Run against the current contracts.

| | |
|---|---|
| A third period proven from a live Stripe call, FDC round **1,423,476** | [`0x960552ad…`](https://coston2-explorer.flare.network/tx/0x960552ad25023f6ecc01395a60d5a8227164de9a0f6aada3633fbb62fe1a40f8) |
| `applyRevenueRepayment` took the agreed share, priced at $1.015481 | [`0x00d740b7…`](https://coston2-explorer.flare.network/tx/0x00d740b78e9c84b4cb6b434c560fb44d9c8f00c00c29b288eecc4960841f067e) |
| Owed | **$5.51 → $0** · advance closed |

So the one advance issued on the current deployment was repaid through **both** channels the product has:
first from the XRP Ledger with an FDC Payment proof, then the remainder automatically from newly attested
revenue. The treasury holds ~9.4 FXRP and the demo account is clean — connect a wallet and the full loop is
open to anyone.

### Checking these claims

Every transaction linked in this README and in `docs/` can be checked against the chain in one command:

```bash
npx hardhat run scripts/ledgerline/verify-claims.ts --network coston2
```

It resolves each hash, reports which contract it was sent to and whether it succeeded, and exits non-zero if
any claim is not backed by the chain. It is here because the fastest way to lose a reviewer's trust is a
document that claims more than the chain can support.

### Underwritten in private: the Confidential Compute path, on chain

The [`fcc/`](fcc/) extension computed a decision from the demo account's real proven revenue, signed it
with the enclave key, and [`PrivateUnderwriter`](https://coston2-explorer.flare.network/address/0x66cB73a6326F7e6541DA95f5fB2236d8b4f4fc4a#code)
verified the signature against the registered **code measurement** (the keccak256 of the built handler)
before storing it:

| | |
|---|---|
| Decision stored — **$97.91 limit, 2.5% factor, 8.9% risk-priced fee** | [`0x8b32907e…`](https://coston2-explorer.flare.network/tx/0x8b32907ea847421be70bacd8e5754752236cbbf673afd7dfbec6568832ff0de5) |
| Revenue figure appearing anywhere in that transaction | **none** |
| The public-path limit for the same account, same policy | **$97.91 — identical** |

Two trust models, one answer: the FDC provider-quorum path and the enclave path price the account the same,
which is what lets them coexist as a choice rather than a migration.

**That extension is now registered on Flare's shared TEE platform**, and the same underwriting has since
been executed *by the platform itself* rather than locally — extension **66180**, TEE machine
`0x0f42321d…` at status **PRODUCTION**, with an `UNDERWRITE / COMPUTE_LIMIT` instruction routed through
Flare's data providers into the enclave:

| | |
|---|---|
| Instruction sent on chain | [`0x7b77dc2f…`](https://coston2-explorer.flare.network/tx/0x7b77dc2fe6e733761c35568f8ff013b74f3d98a408642a57e770c38b0f864131) |
| Went in | one proven period, **$3,916.78** |
| Came back out | `{limitCents: 9791, factorBps: 250, feeBps: 890}` — **and nothing else** |

$97.91 again, from all three paths. A further live op closes the public path's one unavoidable
disclosure: the enclave holds the API key and reads the processor itself, so the instruction carries only
an account reference and a window
([`0x8a9e9593…`](https://coston2-explorer.flare.network/tx/0x8a9e95937a1843ec76164b5db1fc1633ea274c0bb45137a1635c37d18ed68e88)
— the calldata verifiably contains no credential and no revenue figure). The remaining honest caveat — this runs a simulated TEE, so the code
measurement is reported by the proxy rather than attested by confidential hardware — lives in
[fcc/README.md](fcc/README.md).

## Deployed on Coston2 (chain id 114)

**V4 — current.** The audited generation. An adversarial testing pass over every money path found and fixed
five defects the previous deployment carried: credit could retire pool principal before it was lent (a
share-price inflation), XRP arriving with no open advance was never booked as the pool's claim, the XRP/USD
feed's age was never checked, a one-cent repayment inside each grace period could hold a balance open
forever (advances now carry a 180-day term), and a short FAssets fill was booked as if it had been full
(it now reverts). A proven period must also actually be a month (26–32 days) — the underwriting prices it
as one, so a single honest attestation covering a year would otherwise borrow an order of magnitude past
the policy.

Already exercised live: revenue proven from a real Stripe call
([`0x7c380dc6…`](https://coston2-explorer.flare.network/tx/0x7c380dc6c1b46e6de1f8b1ea406a52af3cd36a2ea92ffd49997f1267ce6ea350)),
a pool-funded advance
([`0x33ee81d3…`](https://coston2-explorer.flare.network/tx/0x33ee81d3a0daea56d5ee45a0ff33afdcc1c4b9f30b8447f08744f4f1678d714f))
and its full repayment closing the books exactly
([`0x98344c79…`](https://coston2-explorer.flare.network/tx/0x98344c791fd565bedeb707439b75712f5d4aa640acf0cfac66d3dc1c6d9603d0)
— `lentFxrp` back to zero, one clean cycle earned, the fee in the share price).

| Contract | Address |
|---|---|
| `RevenueOracle` | [`0x639ca7C10DC1619d7cAA2B5a286372345194864b`](https://coston2-explorer.flare.network/address/0x639ca7C10DC1619d7cAA2B5a286372345194864b#code) |
| `AdvanceManager` | [`0x24f2c925679e737174103A5F6715b766E3D5D602`](https://coston2-explorer.flare.network/address/0x24f2c925679e737174103A5F6715b766E3D5D602#code) |
| `LenderPool` (ERC-4626) | [`0x38560eE630071846158F639a217E6a0fB2d66Fe2`](https://coston2-explorer.flare.network/address/0x38560eE630071846158F639a217E6a0fB2d66Fe2#code) |
| `PrivateUnderwriter` (Confidential Compute) | [`0x66cB73a6326F7e6541DA95f5fB2236d8b4f4fc4a`](https://coston2-explorer.flare.network/address/0x66cB73a6326F7e6541DA95f5fB2236d8b4f4fc4a#code) |
| `GovernanceTimelock` (owns manager + pool) | [`0xB0aBFA468a84467a0F9579b6458AFBBfc4f33FE5`](https://coston2-explorer.flare.network/address/0xB0aBFA468a84467a0F9579b6458AFBBfc4f33FE5#code) |

The underwriting policy is behind the timelock: every owner action waits in public (an hour on Coston2,
demo-scale; days in production) before it executes.

Superseded generations, kept because evidence cited in this document ran on them:

| Contract | Address |
|---|---|
| `RevenueOracle` (v3) | [`0x151FDDB3d60B1Cc9AD43e0831495D430b0412906`](https://coston2-explorer.flare.network/address/0x151FDDB3d60B1Cc9AD43e0831495D430b0412906#code) |
| `AdvanceManager` (v3) | [`0xae027AeB3d1FBa24743D1ADE902521641F32f41c`](https://coston2-explorer.flare.network/address/0xae027AeB3d1FBa24743D1ADE902521641F32f41c#code) |
| `LenderPool` (v3) | [`0xB6a742c6B2e1Ff4052670a82C97d0558E77235c7`](https://coston2-explorer.flare.network/address/0xB6a742c6B2e1Ff4052670a82C97d0558E77235c7#code) |
| `RevenueOracle` (v1) | [`0x80D08369E1a34e8c7C43FCF947323e56e6B87Be6`](https://coston2-explorer.flare.network/address/0x80D08369E1a34e8c7C43FCF947323e56e6B87Be6#code) |
| `AdvanceManager` (v1) | [`0x63fC5a5c422D40DcC8FA267384BA5351d8698A58`](https://coston2-explorer.flare.network/address/0x63fC5a5c422D40DcC8FA267384BA5351d8698A58#code) |
| XRPL treasury (repayments arrive here) | [`r9aTnFEPnSceeGjDgcbhqsK3epizmZGC2o`](https://testnet.xrpl.org/accounts/r9aTnFEPnSceeGjDgcbhqsK3epizmZGC2o) |
| FAssets `AssetManager` (FXRP) | [`0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`](https://coston2-explorer.flare.network/address/0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA) |
| FXRP (`FTestXRP`) | [`0x0b6A3645c240605887a5532109323A3E12273dc7`](https://coston2-explorer.flare.network/address/0x0b6A3645c240605887a5532109323A3E12273dc7) |

Both contracts are source-verified on the explorer. Full deployment notes in [docs/DEPLOYED.md](docs/DEPLOYED.md).

## How to run it

```bash
cp .env.example .env          # add PRIVATE_KEY, and STRIPE_API_KEY if attesting Stripe
yarn install
yarn hardhat test             # 144 tests

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

Three Flare systems do load-bearing work here, and FDC does it twice with two different attestation types.
Removing any one does not degrade the product; it deletes it.

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

**FDC Payment closes the loop back from the XRP Ledger.** `repayFromXrpl` accepts an FDC *Payment* proof —
a second attestation type, verified by the same Merkle machinery — that a plain XRP payment reached the
contract's XRPL account carrying the account id as its payment reference. **Without it, money could leave
Flare for the XRP Ledger but nothing could come back**, and a borrower funded in real XRP would still have
had to acquire an EVM asset to repay. The contract checks the chain, the recipient, the reference and the
proof before it will reduce a debt, and refuses a payment it has already counted.

This is what makes the interoperability claim complete rather than merely defensible. Data crosses from Web2
into Flare's EVM state through FDC Web2Json. Value crosses out to the XRP Ledger through FAssets. Value
crosses back through FDC Payment. The obligation itself never leaves Flare and is never denominated in
anything but dollars — while the borrower's side of every transaction happens on a chain that cannot run a
line of this logic itself.

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

**Tests** — [`test/`](test/), **65 passing**, `npx hardhat test`

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

## Security model — attacks we know about and have not fixed

The proofs above establish that the *data* cannot be forged: nobody can attest revenue Stripe did not
report, and nobody can claim an XRPL payment that did not happen. What follows is the layer above that —
ways to be honest with the machine and still cheat the economics. Naming them precisely matters more to us
than appearing finished.

**Revenue recycling is the fundamental attack on this whole category.** Pay *yourself* $4,000 through your
own Stripe account (cost: roughly 3% in processing fees), attest it — the attestation is genuine, Stripe
really did process it — borrow $4,000, and default. Every revenue-based lender on earth faces this; the
off-chain ones fight it with KYC and bank-account cross-checks. On chain the honest mitigations are
economic: advance factors for young accounts must sit **below** the card-processing fee so the attack loses
money, limits must grow only with repayment history, and account age (which Stripe's API reports and FDC
could attest) must gate the first advance. The current contract has a 1.0x factor from the first period —
right for a demo, exploitable in production, and the parameters exist to be tightened.

**Overlapping periods can fake a history.** The oracle requires each new period to *end* after the previous
one, but not to *begin* after it — so three windows shifted by a day each count as three periods of history
while covering essentially the same month of revenue. The averaging means this does not inflate the limit,
but it defeats any future rule of the form "three months of history before borrowing". The fix is one line
(`periodStart >= previous periodEnd`) and belongs to the next deployment rather than a rushed one now; our
own demo data exhibits the pattern, which is how we noticed.

**The testnet treasury can be drained by design.** Any visitor who runs the sandbox attestation gets a
$4,000 limit against a treasury holding a few dollars of testnet FXRP. That asymmetry is deliberate — the
whole point is that a stranger can complete a real loop — and the exposure is a faucet claim, refilled
daily. In production this is the same problem as recycling, and has the same mitigations.

**An XRPL overpayment is kept, not refunded.** `repayFromXrpl` credits a payment only up to the outstanding
balance; XRP beyond that sits in the treasury's XRPL account with no on-chain path back. Rejecting the
payment would be worse — XRPL payments are irreversible, so the debt would stand *and* the money would be
taken. A refund leg needs the same payment machinery in reverse and is not built.

**The owner is trusted.** The owner can withdraw the treasury and set the FAssets and XRPL wiring. That is
acceptable while the treasury is the owner's own funds, and becomes unacceptable the moment outside lenders
exist — the lender-side roadmap item carries multisig ownership and timelocks with it, not as an
afterthought but as a precondition.

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

**This is built, registered, and has run.** The extension lives in [`fcc/`](fcc/), the verifier contract is
[`PrivateUnderwriter`](https://coston2-explorer.flare.network/address/0x66cB73a6326F7e6541DA95f5fB2236d8b4f4fc4a#code),
and Flare's own data providers have carried a real `UNDERWRITE / COMPUTE_LIMIT` instruction into our enclave
on Coston2 — $3,916.78 of proven revenue in, a $97.91 limit out, the revenue itself appearing nowhere
([`0x7b77dc2f…`](https://coston2-explorer.flare.network/tx/0x7b77dc2fe6e733761c35568f8ff013b74f3d98a408642a57e770c38b0f864131)).

The stack is genuinely difficult — teams in this hackathon lost days to wiped extension registrations,
indexer credentials, image-hash matching and `tee-node`/`tee-proxy` version skew, and it cost us a full
evening too. What is *not* yet claimed is confidential hardware: this is a simulated TEE, so the code
measurement is reported by the proxy rather than attested by silicon. That upgrade changes who vouches for
the measurement, not how any of the above is verified.

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

**The trap that cost the most, and would catch anyone.** On the XRP Ledger, `standardPaymentReference` — the
field that ties a payment to an obligation — comes **only** from a memo, and only when the transaction carries
*exactly one* memo whose `MemoData` is *exactly* 32 bytes of hex. `InvoiceID` is a 256-bit field on an XRPL
Payment that looks precisely like the field intended for this, and FDC does not read it at all. Using it does
not error: the attestation succeeds, every other field is correct, and `standardPaymentReference` comes back
as thirty-two zero bytes. We only caught it by attesting a real payment and printing the decoded response
before wiring the contract up to it — the transaction that failed this way is
[`DF329F2E…`](https://testnet.xrpl.org/transactions/DF329F2E8BEE8A28E852779435FE3420651505608B1542D60A8213801AC9BF16),
and it is worth keeping as a record of what the failure looks like. A one-line warning next to the field
definition would save the next team a day.

**What would have helped most.** A note in the FDC documentation that the attestation request, including its
`headers` field, is permanently public calldata. It is obvious in hindsight and consequential: any design
that attests an authenticated API is publishing that credential. We handled it with a read-only restricted
key and a guard that refuses an `sk_` key outright, but it deserves a warning at the point of use.

## Roadmap

The short version is below. The deep plan — per-phase goals, exact contract changes, tests,
risks and acceptance criteria — is in [docs/ROADMAP.md](docs/ROADMAP.md).

1. **Repayment in smaller amounts, and from any XRPL account.** The return leg is built, deployed and run on
   chain — see *The loop closes* above. Two limits remain. A repayment currently has to come from an account
   whose payment is attested individually, which costs an FDC request per repayment; batching several
   payments into one attestation round would make small, frequent repayments economic. And the contract
   accepts a payment from *any* XRPL sender as long as the reference matches, which is deliberate — it lets
   a third party settle someone's debt — but a borrower who wants to bind repayment to their own XRPL
   account has no way to say so yet.
2. **Flare Smart Accounts, so the borrower needs no EVM wallet at all.** This is the natural next step, and
   it is Flare's own newest work rather than something we would have to invent.

   [Flare Smart Accounts](https://github.com/flare-foundation/flare-smart-accounts) pairs every XRPL address
   with a deterministic `PersonalAccount` contract on Flare that only that address can control, and the
   authorisation is exactly what `repayFromXrpl` already uses: an FDC **Payment** proof of a transaction the
   XRPL address signed. Its
   [`PaymentProofs.verifyPayment`](https://github.com/flare-foundation/flare-smart-accounts/blob/main/docs/specs/SmartAccounts/PaymentProofs.md)
   checks the same fields in the same order our function does — chain, then status, then recipient against an
   allowlist, then the proof itself last because it is the expensive one.

   Today a borrower still needs an EVM wallet to *request* an advance, even though both money legs can be
   pure XRP. Routing the request through a Personal Account removes that last dependency: they would send one
   XRP payment carrying an instruction, and a Flare account they provably control would take the advance on
   their behalf. It is deployed on Coston2 at
   [`0x434936d4…`](https://coston2-explorer.flare.network/address/0x434936d47503353f06750Db1A444DBDC5F0AD37c),
   and the starter this repository is built on already ships a working example of driving it from an XRPL
   payment. **Not built** — it is a larger change than three days allows, and shipping it badly would be
   worse than naming it precisely.
3. **Advances below one lot on the XRPL leg.** FAssets redeems whole lots only, 10 XRP on Coston2, so the
   smallest XRPL-settled advance is about $10. Smaller advances work on the FXRP leg. Batching or a float
   would close the gap.
4. **A second platform.** Shopify or YouTube. The oracle already takes `platform` as a field and `accountRef`
   as opaque, so this is an entry in `revenue-sources.ts` and no contract change.
5. **A lender side.** The treasury is a single owner-funded pool today. Real capital needs LP shares, a yield
   split and default accounting.
6. **Underwriting that uses the trend.** The full history is stored and currently only averaged. Growth,
   volatility and seasonality are all visible in it.
7. **Per-borrower key scoping**, so the published key reads one account's aggregate and nothing else.
