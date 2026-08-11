# Putting the interface on the public internet

The app is a self-contained Next.js project in [`web/`](../web). It talks to Coston2 over a public RPC and to
two Flare services through short server-side proxies, so there is nothing to host besides the app itself — no
database, no indexer, no background worker.

## Why it deploys anywhere

The slow part of this product is an FDC attestation, which takes about two minutes. That wait happens in the
**browser**, not on the server: [`web/lib/useAttestation.ts`](../web/lib/useAttestation.ts) drives the loop and
polls, and the two server routes it calls each do one short HTTP request and return.

| Route | What it does | Typical duration |
|---|---|---|
| [`/api/attest/prepare`](../web/app/api/attest/prepare/route.ts) | Asks the FDC verifier to encode the request | under a second |
| [`/api/attest/proof`](../web/app/api/attest/proof/route.ts) | Asks the DA layer for the proof, or reports "not yet" | under a second |

Neither ever sleeps or waits for a round. That means no serverless function timeout can kill an attestation
half way through, and the deployed site behaves exactly like the local one. `vercel.json` sets a 30-second
ceiling on those routes, which is roughly thirty times more than they need.

## Deploying to Vercel

The repository root is a Hardhat project, so **the Vercel project's root directory must be set to `web`**.
Otherwise the build will try to build the contracts.

```bash
cd web
npx vercel            # first run links the project — set root directory to "web" when asked
npx vercel --prod
```

Or from the dashboard: *New Project* → import the repository → set **Root Directory** to `web` → framework
preset *Next.js* (detected automatically).

### Environment variables

Set these in *Project Settings → Environment Variables*. Only the first is a secret.

| Variable | Value | Needed for |
|---|---|---|
| `STRIPE_API_KEY` | `rk_test_…` — the **read-only restricted** key | The live Stripe source. Without it the app still runs and offers the sandbox source. |
| `LEDGERLINE_ACCOUNT_REF` | `acct_1U2HbaRh1zuX9OfD` | Pins which Stripe account this deployment may attest |
| `NEXT_PUBLIC_ACCOUNT_REF` | `acct_1U2HbaRh1zuX9OfD` | The account the page displays |
| `VERIFIER_URL_TESTNET` | `https://fdc-verifiers-testnet.flare.network` | Defaulted in code; set it to be explicit |
| `VERIFIER_API_KEY_TESTNET` | `00000000-0000-0000-0000-000000000000` | The documented public testnet key — not a secret |
| `COSTON2_DA_LAYER_URL` | `https://ctn2-data-availability.flare.network` | Defaulted in code; set it to be explicit |

**Never set `PRIVATE_KEY` here.** The deployed app never signs anything. Every transaction is signed by the
visitor's own wallet, which is also why a visitor can prove a period against an account bound to themselves.

`STRIPE_API_KEY` must be the restricted `rk_test_…` key. Both source builders refuse an `sk_` key outright,
because an FDC attestation request is public calldata and the key in it is permanently world-readable — see
[BLOCKERS.md](BLOCKERS.md).

## What a visitor can do without any setup

- Read every proven period, with the FDC round and Merkle root behind each figure, and open the transaction
  that verified it.
- Watch a live attestation run, with links to Flare's systems explorer for the voting round while it is still
  open.
- Connect a wallet, run a **real** attestation against an account bound to their own address using the keyless
  sandbox source, and see the resulting record appear.

Taking an advance additionally needs the treasury to hold FXRP. When it does not, the interface says so
plainly rather than offering a button that reverts.

## Checking a deployment

```bash
curl -s https://<your-deployment>/api/attest/proof \
  -H 'Content-Type: application/json' \
  -d '{"votingRoundId":1422337,"requestBytes":"0xdeadbeef"}'
# {"pending":true,...}  — the proxy is reachable and correctly reports "not yet"
```

Then run `npx hardhat run scripts/ledgerline/state.ts --network coston2` from the repository root and confirm
the figures on the page match what the contracts return.
