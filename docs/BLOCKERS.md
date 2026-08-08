# Blockers

One open item from Phase 0. Everything else passed — see [PHASE0.md](PHASE0.md).

---

## ~~1. No funded Coston2 wallet~~ — RESOLVED 2026-08-08

Faucet sent 100 C2FLR, 10 FTestXRP and 10 USDT0 to `0x5c051991900E6202430d28B26c9D21C7C23ef290`. All balances
confirmed on chain. The full Web2Json round trip then ran and verified a proof on chain — Phase 0.1 is closed.

---

## 2. Attesting Stripe publishes a Stripe API key on a public blockchain

**This one is a design decision, and it needs making before Phase 3 rather than during it.**

**The mechanism.** Stripe's payouts endpoint requires authentication — verified, it returns HTTP 401 with
*"You did not provide an API key… Authorization header, using Bearer auth"*. So the Web2Json request must carry
`Authorization: Bearer sk_test_…` in its `headers` field. But the whole attestation request is ABI-encoded and
submitted to `FdcHub` as calldata, and decoding the verifier's own response recovers every field as plain
readable ASCII:

```
url field      -> https://swapi.info/api/people/3
headers field  -> {}          ← a real Authorization header would sit here, in the clear, forever
```

**What this does and does not break.** It does *not* break the trust story, and that distinction matters for
the submission. The attested number is still proven by the network rather than vouched for by a server, so the
integrity claim in the README stands untouched. What breaks is **confidentiality**: the key is published, so
anyone can replay it and read that borrower's Stripe data until it is revoked, and the on-chain record is
permanent even after revocation.

**Options, with my recommendation.**

- **(A) Publish a read-only restricted key, and say so plainly. Recommended.** Stripe restricted keys can be
  scoped to read-only on a single resource and rotated per attestation, which bounds the blast radius. In the
  demo everything is test mode, so the exposed key reads fake data and the leak is genuinely harmless. It keeps
  the trustless property that the entire pitch rests on, and the honesty section of the README is the natural
  place to name the limitation and point at per-borrower key scoping as the production answer.
- **(B) Put a proxy in front of Stripe** that holds the key server-side and serves an aggregate at a tokenized
  URL. This solves confidentiality and **destroys the pitch** — the proxy becomes exactly the trusted
  intermediary the README argues FDC removes. A judge scoring integration quality would be right to mark it
  down. I would not do this.
- **(C) Stripe Connect with a platform key.** Same objection as (B): the platform becomes the trusted party.

My recommendation is (A), because it is the only option that preserves the reason this project is interesting,
and because in test mode the cost of the leak is zero. But it puts a real caveat in the README, so you should be
the one to choose it.

---

## Not blockers, but corrections to the brief worth knowing

- **The verifier needs no API key.** The brief says the all-zeros placeholder returns 401 and a real key must be
  obtained before anything else. It does not — that value is the documented public testnet key and it returned
  `{"status":"VALID"}`. No key to chase.
- **The faucet does hand out FXRP.** The brief says it no longer does and plans a MockFXRP fallback with an
  accompanying honesty caveat. It dispenses 10 FXRP per address per day, so that caveat can probably be dropped
  entirely.
- **The Web2Json guide URL in the brief 404s.** `dev.flare.network/fdc/guides/hardhat/web-2-json` is dead;
  `dev.flare.network/fdc/getting-started` and the `scripts/fdcExample/` directory in the starter are the live
  references.
