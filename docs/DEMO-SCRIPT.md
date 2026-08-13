# The video, shot by shot

Target: under 5 minutes, one take, screen recording with voiceover. Chrome window at
1440×900, wallet unlocked on Coston2, https://ledgerline-flare.vercel.app open in one tab
and https://coston2-explorer.flare.network in another. Practice the attestation once
before recording so the two-minute wait lands mid-video, not at the end.

Total speaking pace: read the lines as written and each section lands on time.

---

## 0:00 – 0:35 · The problem, on the landing page

Scroll slowly from the hero to the proof card while speaking.

> "A payment processor already proves what a business earns. No lender can read it, so no
> lender will price it. Proofline is revenue-based credit on Flare: the Data Connector
> reads the processor's API, the network's own data providers agree on the figure, and it
> lands on chain with a Merkle proof. This number — three thousand nine hundred sixteen
> dollars — is a real Stripe account, proven on Coston2. The green line names the FDC
> voting round and the Merkle root. Nothing on this site asks to be believed."

Click the proof line's ↗ so the explorer transaction opens for a beat.

## 0:35 – 1:10 · Start the live attestation FIRST

Open the app, connect MetaMask (the network prompt shows Coston2 auto-add), choose
**Yours**, press **Run an attestation**.

> "This is the part that is usually faked in demos, so we run it live. My wallet pays the
> FDC fee, the request enters a voting round, and Flare's data providers are agreeing on
> the answer right now. It takes about two minutes. While it runs, the rest of the
> product."

Leave this tab running. Switch to a second tab with the site.

## 1:10 – 1:50 · Underwriting, and the attack it prices

/docs, scroll to Underwriting.

> "The limit is the smaller of the recent mean and the latest month, times a factor the
> account has earned. The base is two and a half percent — deliberately below card
> processing fees, so faking revenue through your own processor loses money before any
> other check runs. Risk is priced into the fee, and every input to the decision is on
> chain. And we underwrite the way acquirers do: revenue inside the 120-day refund window
> is haircut by age, ten percent of every advance is escrowed as a rolling reserve that
> returns on a clean close, and merchants can route settlements through an on-chain
> lockbox that splits repayment out atomically — the mechanics Stripe Capital and
> Shopify Capital run, on chain, this morning's deployment."

## 1:50 – 2:30 · The money is real: both legs

/app/activity, point at the feed rows as you speak.

> "Advances settle in FXRP, or in real XRP on the XRP Ledger through FAssets — an agent
> pays the borrower's XRPL address directly; they never need an EVM wallet. Repayment
> closes the same loop: a plain XRP payment carrying the account id in its memo, proven
> back on Flare by a second FDC attestation type. Funded in real XRP, repaid in real XRP,
> and the obligation never left Flare. Every row here is rebuilt from contract events.
> There is no database."

## 2:30 – 3:10 · The lender side

/app/lend.

> "Lenders fund it through an ERC-4626 vault. Fees and repayments land in the share
> price; write-offs consume a protocol-owned junior buffer before they touch depositors,
> and the two real exposures — XRP/USD drift, and XRPL settlements that arrive off-pool —
> are printed where the money enters, because a vault that hides them is lying with
> arithmetic."

## 3:10 – 3:50 · The confidential path

/confidential.

> "The hardest objection: no business publishes its revenue forever. So the same
> underwriting also runs inside a TEE on Flare's Confidential Compute platform — our
> extension is registered, its machine reached production, and Flare's data providers
> carried a real instruction into the enclave. Revenue went in; only a ninety-seven
> dollar limit came out. Same answer as the public path. Privacy costs nothing in
> correctness."

## 3:50 – 4:20 · We attacked our own product

/security.

> "Before submitting we attacked our own deployment. Six real defects — share-price
> inflation through credit ordering, an unbooked receivable, an unchecked price feed, a
> one-cent drip that dodged delinquency, short redemption fills, and year-long 'months'.
> Every one is published here, fixed, and the current deployment carries the fixes. A
> lending protocol that hides its audit trail is asking to be trusted twice."

## 4:20 – 4:55 · The attestation lands

Switch back to the app tab. The console should be at or near the Merkle root / storing
step. If it has finished, the new period is on screen with its proof line.

> "And the attestation we started has landed: my wallet, a real voting round, a Merkle
> proof verified on chain, and a period of revenue this account can now borrow against.
> About two minutes, end to end. Everything you just saw is live on Coston2, the
> contracts are verified, and the repository ships a script that checks every claim in
> our docs against the chain. Proofline: borrow against revenue you can prove."

End on the proof line. Cut.

---

## If something goes wrong mid-take

- Attestation slower than 2½ minutes: keep the tour going (Account page: tier standing
  and wallet rotation fills 30 seconds), come back when it lands.
- MetaMask prompt hides: click the extension icon; the site never signs by itself.
- The wallet has no C2FLR: faucet at https://faucet.flare.network before recording.
