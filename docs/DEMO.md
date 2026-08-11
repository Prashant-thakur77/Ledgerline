# Demo script — under five minutes

Every number below is real and already on chain. Nothing needs to be staged except the browser tabs.

**Before recording.** Have open: the app on `localhost:3000`, the Stripe sandbox balance-transactions page, and
[`RevenueOracle` on the explorer](https://coston2-explorer.flare.network/address/0x80D08369E1a34e8c7C43FCF947323e56e6B87Be6#code).
Reset to a fresh account by picking a new `ACCOUNT_REF` if you want to run the flow live rather than narrate the
existing transactions.

---

### 0:00 — The problem, in two sentences

> A creator earning four thousand dollars a month on Stripe cannot borrow against it. A bank has no credit file
> for them, DeFi has no collateral from them, and a smart contract cannot read a Stripe dashboard — so anyone
> could claim any income, and the only fix has been to trust a company's server to vouch for the number, which
> puts the middleman straight back in.

Then the turn:

> Flare's Data Connector can read it. It calls the API, the network's own data providers agree on the response,
> and the figure arrives on chain with a Merkle proof — proven the same way a price feed is proven. No
> application-specific oracle. Nobody to bribe.

### 0:35 — Show the revenue exists

Stripe tab. Three charges, $4,030 gross, **$3,912.23 net** after fees.

> This is a real Stripe account. Nothing here is mocked — the API responses are genuine, the money behind them
> is test mode.

### 1:00 — Prove it on chain, from the page

**Do this in the browser, not the terminal.** Press **Run an attestation** and let the console fill in. This is
the strongest ninety seconds in the video — do not cut it and do not speed it up.

> I'm going to prove that figure on chain right now, and you can watch the whole thing.

Narrate the lines as they arrive, because each one is checkable:

- *composing a Web2Json request* — put the jq on screen here.
  > This filter is the whole trick. Every data provider on Flare runs it independently against Stripe's
  > response, and they have to agree on the answer. It sums the net amount of charges in the period — net, so
  > it's after Stripe's fees, the money the business actually keeps.
- *request submitted* — click the transaction link.
- *landed in voting round 1,4xx,xxx* — **click through to Flare's systems explorer.** This is the moment.
  > That's not our server. That's Flare's own explorer, showing the round my request is sitting in.
- *1 round on, not relayed yet* — this is where most demos would show a spinner.
  > This wait is the product. Two minutes, because a voting round has to close and be relayed before a proof
  > exists. Every other project hides this behind a spinner, and hiding it is exactly what makes an oracle look
  > like an ordinary database call. You cannot fake a voting round finalising while someone watches.
- *round finalised · Merkle root 0x…* — the root appears the instant it is relayed.
- *proof retrieved · 5 Merkle siblings*
- *the network agreed: stripe/acct_… earned $3,916.78*
- *verified on chain* — click it.

> The contract checked that Merkle proof against Flare's own verification contract before it stored anything.
> A forged figure does not get in.

Then the figure resolves in on the page above, and the proof line types itself in underneath.

**If you are short on time or the network is slow**, the same run is already on chain and can be narrated
instead — request [`0x2d7a5eeb…`](https://coston2-explorer.flare.network/tx/0x2d7a5eebd1ad572e807249145ba64a963ac737a030693335efbb44dbb945b1b9),
round 1,422,334, stored at [`0x3abedd85…`](https://coston2-explorer.flare.network/tx/0x3abedd85adb5e6a5747d62061b80f5ba24a5017619acb44153b95ab0d9988b64).
It took 116 seconds end to end.

**Worth saying out loud**, because it is the part that is hard to believe:

> Nothing about this runs on our server. The page is doing the waiting, and your wallet signs both
> transactions. Which means you can do this yourself, right now, on the deployed site — pick *Yours*, and
> you'll be attesting against an account bound to your own wallet.

### 1:50 — The limit appears

Switch to the app. The proven period is listed, marked *verified by FDC*, and the limit is there: **$3,912.23**,
with the formula shown beneath it.

> The mean of the last three attested periods, times one, for a first advance. The formula is on screen because
> a lender that hides its underwriting is a lender you shouldn't take money from — and the inputs are stored on
> the advance itself, so the decision can be audited afterwards.

### 2:20 — Take the advance

Borrow **$2.00**. Show the panel before confirming: the live XRP/USD from FTSOv2, and the FXRP that will arrive.

Then the result: **1.918796 FXRP received. $2.10 owed.**

> Two dollars of principal, ten cents of fee. The debt is in dollars. The FXRP is just how the money travelled.

### 2:55 — The point of the dollar denomination

Put the origination rate and the current rate side by side on screen.

> The rate has already moved between when I quoted this and when it settled. It doesn't matter. The borrower
> owes two dollars and ten cents either way. Without FTSOv2 this debt would be denominated in XRP, and a
> borrower who took a thousand dollars could owe the equivalent of three thousand after a price move — a
> working-capital product would have quietly become a leveraged bet they never asked for.

### 3:25 — It repays itself

A new period is attested — **$4.55** — and the repayment runs.

> Twenty percent of that period's revenue, taken automatically because a new period was proven. Not because
> anyone remembered to pay.

Show the balance fall: **$2.10 → $1.19**, with **0.873727 FXRP** moved at the rate current *at repayment*, not
at origination.

### 3:50 — The part nobody else will have

Show the XRPL account page, then run it — or narrate the transaction if you're short on time.

> This advance is going somewhere different. Instead of sending FXRP, the contract redeems it through FAssets,
> and a FAssets agent pays real XRP to the borrower's own XRP Ledger account.

Show the balance change: **100 → 109.95 XRP**, paid by agent `r4GHJwG…` within about fifteen seconds.

> The borrower never held FXRP. They never signed an EVM transaction to receive this. The revenue was proven
> from a Web2 API, the loan was underwritten on Flare, and the money arrived on a chain that cannot run any of
> this logic itself. That is both halves of interoperability doing real work — data in from Web2, value out to
> the XRP Ledger.

The debt is still recorded on Flare in dollars: **$10.92**.

### 4:10 — What is honest about it

Do not skip this.

> This is unsecured credit. A borrower can take an advance and stop earning, and nothing here stops them. What
> pushes against it is that the revenue history is the reputation: defaults are recorded on chain, and advances
> start small and grow with repayment history.
>
> And the Stripe key is published on chain, because attestation requests are public. That breaks
> confidentiality, not trust — the number is still proven by the network, not vouched for by us. It's a
> read-only key scoped to two endpoints, and the production answer is per-borrower scoping.

### 4:35 — Close

> Three pieces of Flare, each load-bearing. FDC Web2Json is the underwriting — without it there is no way to
> know anyone's revenue and the product cannot exist. FTSOv2 makes the obligation a dollar obligation instead
> of a bet. FAssets is the money that moves, because XRP has no smart contract capability of its own.
>
> Revenue-based financing isn't new. Doing it without anyone trusted in the middle is.

---

## The six transactions, if you narrate rather than run

| Step | Transaction |
|---|---|
| Revenue proven, $3,912.23 | `0x8bea3e154e9bbc70dde5fd32bad90a54aa52a2e68205600e431b4900f77d88af` |
| Advance issued, 1.918796 FXRP | `0x7996ce9cc7e91c2f81bdae01694e56798fa932ad4b8b5468ce43de5333e2e585` |
| New period proven, $4.55 | `0x768f0d23dd981277d5617fc978d4716f15e0bc39f0dc7b5117270bcb22c38515` |
| Repaid from revenue, $2.10 → $1.19 | `0x1331a9b5f83de8d07f77df33eaa56bc599b85127c6fb9511a24407b38f86dd82` |
| Advance redeemed to XRPL (Flare side) | `0x96ec23d1a6a66fae6a71d3a8c67bd9d5b158d706d04de49d36b3d7ba198922ff` |
| The XRP actually arriving (XRPL side) | `784C8E73E1417C2600F7E6473FEE3CB43DEABFCDA008192789AB81F3BFD41534` |

## Pacing note

The attestation round takes a couple of minutes. Don't cut it out entirely — showing the wait, with the jq on
screen and an explanation of what the network is doing, is more convincing than a jump cut. But don't sit in
silence either; that is what makes a demo look broken.
