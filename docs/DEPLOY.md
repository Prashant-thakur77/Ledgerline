# Putting the interface somewhere a judge can reach it

The app is a standard Next.js 16 project in `web/`. It has no database, no background jobs and no long-running
requests, so it deploys as-is to any host that runs Next.js.

## Why there is nothing exotic here

The obvious way to stream a live FDC attestation into a browser is to have the server run the attestation and
push progress down — spawn the Hardhat script, parse its stdout, send Server-Sent Events. That works locally
and breaks on almost every host, because the attestation takes about two minutes and serverless functions are
killed long before that.

So the loop runs in the browser instead. `web/lib/useAttestation.ts` does the waiting, and the two server
routes it calls are short proxies:

| Route | Why it exists | Duration |
|---|---|---|
| `POST /api/attest/prepare` | The FDC verifier is not CORS-open, and the Stripe key must not ship in the JavaScript bundle | one request |
| `POST /api/attest/proof` | The Data Availability layer is not CORS-open. Returns `{pending:true}` immediately rather than sleeping | one request |

Neither ever waits for a voting round. There is no function that can time out, and the page behaves the same
locally and deployed.

## Vercel

This repository has no git remote on purpose, so deploy from the CLI rather than by connecting a repo.

```bash
cd web
npx vercel            # first run links the project; accept the defaults
npx vercel --prod
```

Vercel detects Next.js automatically. Because the Next app is in `web/` rather than at the repository root,
run the command from inside `web/` — that makes `web/` the project root and no `rootDirectory` setting is
needed.

### Environment variables

Set these in the Vercel dashboard (Project → Settings → Environment Variables), or with
`npx vercel env add <NAME> production`. Only the first is a secret.

| Variable | Value | Notes |
|---|---|---|
| `STRIPE_API_KEY` | `rk_test_…` | **Secret.** Read-only restricted key. Omit it and the app offers only the sandbox source, which still exercises the whole pipeline. |
| `LEDGERLINE_ACCOUNT_REF` | `acct_1U2HbaRh1zuX9OfD` | The one Stripe account this deployment may attest. Pinned server-side so a visitor cannot attest our revenue under a reference of their own choosing. |
| `VERIFIER_URL_TESTNET` | `https://fdc-verifiers-testnet.flare.network` | Public. |
| `VERIFIER_API_KEY_TESTNET` | `00000000-0000-0000-0000-000000000000` | Public — the documented testnet key. Not a secret. |
| `COSTON2_DA_LAYER_URL` | `https://ctn2-data-availability.flare.network` | Public. |
| `NEXT_PUBLIC_ACCOUNT_REF` | `acct_1U2HbaRh1zuX9OfD` | Shown in the interface. Safe to expose; it is already on chain. |

The contract addresses are compiled in at `web/lib/contracts.ts` and need no configuration.

**Never set `PRIVATE_KEY` on the host.** The deployment signs nothing. Every transaction is signed by the
visitor's own wallet, which is also why a stranger can run a real attestation without anything from us.

## Checking a deployment actually works

```bash
# the verifier proxy — should return an abiEncodedRequest
curl -sS -X POST https://<your-deployment>/api/attest/prepare \
  -H 'Content-Type: application/json' \
  -d '{"source":"demo","accountRef":"0x0000000000000000000000000000000000000001",
       "revenueCents":400000,"periodStart":1780000000,"periodEnd":1782592000}' | head -c 200

# the DA layer proxy — should return {"pending":true,...} rather than an error
curl -sS -X POST https://<your-deployment>/api/attest/proof \
  -H 'Content-Type: application/json' \
  -d '{"votingRoundId":1422334,"requestBytes":"0xdeadbeef"}'
```

Then open the page, connect a wallet on Coston2, pick **Yours**, and run an attestation. It should finish in
about two minutes and end with a transaction hash. If the console stalls at "waiting for the round to be
relayed" for more than five minutes, the round genuinely has not been relayed — check
`https://coston2-systems-explorer.flare.network/voting-round/<round>?tab=fdc`.

## Before demonstrating anything

The treasury has to hold FXRP or no advance can be issued. Claim from
[the Coston2 faucet](https://faucet.flare.network/coston2) — 100 C2FLR and 10 FXRP per address per 24 hours —
to `0x5c051991900E6202430d28B26c9D21C7C23ef290`, then fund the treasury and check with:

```bash
npx hardhat run scripts/ledgerline/state.ts --network coston2
```

The interface reads `treasuryBalance` and says plainly when it is empty rather than letting the button revert,
but a demo where the last step cannot run is still a demo where the last step cannot run.
