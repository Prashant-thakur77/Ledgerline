# DoraHacks submission, ready to paste

Fill the form with the blocks below. Submit to **Bounty 1: Interoperable Asset Products**
as primary; the Confidential Compute work is described inside and qualifies for the FCC
bounty as noted in the Telegram FAQ (one project may address both).

---

**Project name**

Proofline

**One-liner**

Borrow against revenue you can prove. Revenue-based credit underwritten by FDC-attested
payment-processor data, priced by FTSOv2, settled in FXRP or real XRP through FAssets,
with a confidential underwriting path running live on Flare's TEE platform.

**Links**

- Live app: https://ledgerline-flare.vercel.app
- Repository: https://github.com/Prashant-thakur77/Ledgerline
- Demo video: (add after recording)
- Docs: https://ledgerline-flare.vercel.app/docs
- Security / self-audit: https://ledgerline-flare.vercel.app/security
- Confidential path evidence: https://ledgerline-flare.vercel.app/confidential

**Description**

Revenue-based financing is a large off-chain industry (Pipe, Capchase, Wayflyer) that is
closed to most of the world. On-chain lending cannot do it at all, because a smart
contract cannot read a Stripe dashboard — so anyone can claim any income. Proofline uses
the Flare Data Connector to remove exactly that: Web2Json attests the processor's API
figure through the provider quorum with a Merkle proof, and the figure becomes an
on-chain fact a contract can underwrite.

What is live on Coston2 today, all verifiable:

- Revenue proven from a live Stripe API call through real FDC voting rounds; the app runs
  the whole attestation from the visitor's own wallet in about two minutes, narrated
  step by step. No server signs anything.
- Underwriting that prices its own attack: the base advance factor sits below card
  processing fees, so fabricating revenue through your own processor loses money. The
  factor grows only with cleanly repaid advances; risk is premium-priced into the fee;
  every underwriting input is stored on chain.
- Both money legs. Advances in FXRP, or in real XRP paid to the borrower's XRP Ledger
  address by a FAssets agent redemption. Repayment by revenue share, or by a plain XRP
  payment proven back on Flare through FDC's Payment attestation type. Funded in real
  XRP and repaid in real XRP; the dollar-denominated obligation never leaves Flare.
- An ERC-4626 lender pool with a protocol-owned first-loss junior tranche, an 80%
  utilisation cap, honest maxWithdraw, and both of its real exposures (XRP/USD drift,
  off-pool XRPL settlements) disclosed in the interface where deposits happen.
- FTSOv2 XRP/USD at every conversion, with feed-decimals treated as data and a staleness
  bound: a feed older than an hour refuses to price.
- The incumbent industry's risk mechanics, on chain (researched against Stripe/Shopify
  Capital, the MCA industry, and Maple/Goldfinch/Centrifuge; see docs/REALWORLD-PLAN.md):
  a RevenueSplitter lockbox splits settlements atomically at arrival and springs to 100%
  withholding while an account is behind (live: a 2 FXRP settlement auto-serviced the debt,
  tx 0x3dd05b9d); a 10% rolling reserve escrows at disbursement and released on the clean
  close (tx 0x076f1d98); underwriting age-weights revenue inside the 120-day refund window
  (visible in the advance tx: a fresh $3,916.78 period underwritten at $1,958.39);
  a repayment floor curve, origination velocity caps, a flat keeper tip on markDelinquent,
  and a guardian that can pause instantly while only the timelock can unpause.

Confidential Compute: the adoption blocker for revenue-based credit is that no business
publishes its monthly revenue permanently. So the same underwriting runs inside a TEE on
Flare's shared platform. Our extension (id 66180) is registered, its machine reached
PRODUCTION, and Flare's data providers carried a real UNDERWRITE instruction into the
enclave on chain: one proven period worth $3,916.78 went in, and only
{limit: $97.91, factor 2.5%, fee 8.9%} came out — identical to the public path's answer.
An on-chain verifier (PrivateUnderwriter) accepts decisions only under an enclave
signature over the registered code measurement, with staleness and replay guards. A second
live op goes further and closes the public path's one unavoidable disclosure: the enclave
holds the API key and reads the processor itself, so the instruction carries only an
account reference and a window. The on-chain calldata of that run verifiably contains no
credential and no revenue figure, and the decision is $97.91 again.

Engineering honesty, because judges should not have to take our word: before submitting
we ran an adversarial audit of our own deployed contracts and published it. Six real
defects (credit-ordering share-price inflation, an unbooked XRPL receivable, an
unchecked price feed age, a one-cent-drip delinquency dodge, silently short FAssets
fills, and unbounded "period" lengths) — each reproduced as a failing test, fixed,
redeployed, and exercised live on the current deployment. 162 automated tests including
a 200-step randomised invariant walk. The repository ships verify-claims.ts, which
resolves every transaction hash cited in our documentation against Coston2 and fails if
any claim is not backed.

**Flare protocols used (all load-bearing)**

FDC Web2Json (revenue in) · FDC Payment (XRPL repayment back) · FTSOv2 (XRP/USD at every
conversion) · FAssets (FXRP, and agent redemption to real XRP) · Flare Confidential
Compute (registered extension 66180, live TEE instruction).

**Deployed contracts (Coston2, all source-verified)**

- RevenueOracle 0x4516155F9069205C6EC982214528a62973477767
- AdvanceManager 0x1187B737EFef8C1D2563C0001553Bf6E7afe25af
- LenderPool 0x85Ad3AcE968Ca06a8f08C928993e4A4D9a5B8296
- RevenueSplitter 0xf7982B48D4005F2aa5b2d7AE030996D1d19eD727
- PrivateUnderwriter 0x66cB73a6326F7e6541DA95f5fB2236d8b4f4fc4a
- GovernanceTimelock 0x10eBCE7B70f859E3754832862A34B1B0fE45C37A

**Team**

(your name / handle)
