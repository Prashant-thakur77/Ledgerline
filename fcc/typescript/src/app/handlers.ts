/**
 * ★ MAIN CUSTOMIZATION POINT: your extension's handlers.
 *
 * Mirrors go/internal/extension/extension.go. Each handler follows the same
 * 4-step pattern: decode, validate, execute, respond.
 *
 * Handler contract:
 *   (originalMessageHex) => [dataHexOrNull, status, errorOrNull]
 *   status 0 = error, 1 = success. See docs/extension-contract.md §4.6.
 *
 * The framework serializes handler calls, so plain module-level state is safe.
 */

import { bytesToHex, hexToBytes } from "../base/encoding.js";
import type { Framework, HandlerResult } from "../base/types.js";

import { decodeSayGoodbye } from "./abi.js";
import {
  OP_COMMAND_SAY_GOODBYE,
  OP_COMMAND_SAY_HELLO,
  OP_TYPE_GREETING,
} from "./config.js";

// --- Extension state ---------------------------------------------------------
// Serialized by the framework; no locking needed here.
let greetingCount = 0;
let lastGreeting = "";
let farewellCount = 0;
let lastFarewell = "";

/** Reset all state. Used by tests; not part of the wire contract. */
export function resetState(): void {
  greetingCount = 0;
  lastGreeting = "";
  farewellCount = 0;
  lastFarewell = "";
}

/** Wire handlers to (opType, opCommand) pairs. */
export function register(framework: Framework): void {
  framework.handle(OP_TYPE_GREETING, OP_COMMAND_SAY_HELLO, handleSayHello);
  framework.handle(OP_TYPE_GREETING, OP_COMMAND_SAY_GOODBYE, handleSayGoodbye);
  // Ledgerline: private underwriting. Registered here so main.ts stays stock;
  // deliberately absent from reportState, whose exact shape fixture 16 pins.
  registerUnderwrite(framework);
}

/** Snapshot returned by GET /state. Mirrors the Go State struct. */
export function reportState(): unknown {
  return {
    greetingCount,
    lastGreeting,
    farewellCount,
    lastFarewell,
  };
}

/** GREETING/SAY_HELLO — JSON payload {"name": "..."}. */
export function handleSayHello(msg: string): HandlerResult {
  // 1. Decode
  let raw: Uint8Array;
  try {
    raw = hexToBytes(msg);
  } catch (e) {
    return [null, 0, `decoding request: invalid hex: ${String(e)}`];
  }

  let req: unknown;
  try {
    req = JSON.parse(Buffer.from(raw).toString("utf-8"));
  } catch (e) {
    return [null, 0, `decoding request: ${String(e)}`];
  }

  if (typeof req !== "object" || req === null || Array.isArray(req)) {
    return [null, 0, "decoding request: expected a JSON object"];
  }

  // Match Go's DisallowUnknownFields.
  const unknown = Object.keys(req).filter((k) => k !== "name").sort();
  if (unknown.length > 0) {
    return [null, 0, `decoding request: unknown field "${unknown[0]}"`];
  }

  // 2. Validate
  const name = (req as { name?: unknown }).name;
  if (typeof name !== "string" || name === "") {
    return [null, 0, "name must not be empty"];
  }

  // 3. Execute
  greetingCount++;
  const greeting = `Hello, ${name}! Welcome to Flare Confidential Compute.`;
  lastGreeting = greeting;

  // 4. Respond
  const resp = { greeting, greetingNumber: greetingCount };
  return [bytesToHex(Buffer.from(JSON.stringify(resp), "utf-8")), 1, null];
}

/** GREETING/SAY_GOODBYE — ABI-encoded (string name, string reason). */
export function handleSayGoodbye(msg: string): HandlerResult {
  // 1. Decode
  let hex: string;
  try {
    // Normalize through hexToBytes so malformed input fails here, not in viem.
    hex = bytesToHex(hexToBytes(msg));
  } catch (e) {
    return [null, 0, `decoding request: invalid hex: ${String(e)}`];
  }

  let decoded: { name: string; reason: string };
  try {
    decoded = decodeSayGoodbye(hex as `0x${string}`);
  } catch (e) {
    return [null, 0, `decoding request: ${e instanceof Error ? e.message : String(e)}`];
  }

  // 2. Validate
  if (!decoded.name) {
    return [null, 0, "name must not be empty"];
  }

  // 3. Execute
  farewellCount++;
  const farewell = `Goodbye, ${decoded.name}! Reason: ${decoded.reason}`;
  lastFarewell = farewell;

  // 4. Respond
  const resp = { farewell, farewellNumber: farewellCount };
  return [bytesToHex(Buffer.from(JSON.stringify(resp), "utf-8")), 1, null];
}

// ── Ledgerline private underwriting ──────────────────────────────────────────
//
// The Phase-4 mechanism from docs/RESOLUTIONS.md, in miniature: revenue history
// goes INTO the enclave, and only the decision comes out. The policy constants
// live here, in the attested code, so changing the underwriting means a public,
// governed rollout of a new code hash — never a silent server edit.
//
// The math mirrors AdvanceManager exactly (BigInt, Solidity truncation), and
// re-validates what the oracle would have: non-overlapping, ascending periods.
// An enclave that trusts its caller is just a server with extra steps.

import { OP_COMMAND_COMPUTE_LIMIT, OP_COMMAND_COMPUTE_LIMIT_FROM_SOURCE, OP_TYPE_UNDERWRITE } from "./config.js";

const POLICY = {
  baseFactorBps: 250n,
  stepFactorBps: 2000n,
  capFactorBps: 10000n,
  historyStepBps: 800n,
  minAccountAgeSeconds: 30n * 24n * 60n * 60n,
  feeBps: 500n,
  riskPremiumBps: 400n,
  maxAdvanceCents: 10_000_000n,
  periodsAveraged: 3,
} as const;

let underwriteCount = 0;

interface Period {
  revenueCents: number;
  periodStart: number;
  periodEnd: number;
  /** V6: attested refunds inside the window. Absent means zero, so old callers stay valid. */
  refundCents?: number;
}

/** Visa's VAMP freeze threshold, in bps of gross — mirrored from AdvanceManager. */
const REFUND_FREEZE_BPS = 220n;

/** The latest period's refund ratio against gross, the same base the public covenant reads. */
function refundRatioBps(periods: Period[]): bigint {
  const latest = periods[periods.length - 1];
  const refunds = BigInt(latest.refundCents ?? 0);
  const gross = BigInt(latest.revenueCents) + refunds;
  if (gross === 0n) return 0n;
  return (refunds * 10_000n) / gross;
}

export function registerUnderwrite(framework: Framework): void {
  framework.handle(OP_TYPE_UNDERWRITE, OP_COMMAND_COMPUTE_LIMIT, handleComputeLimit);
  framework.handle(OP_TYPE_UNDERWRITE, OP_COMMAND_COMPUTE_LIMIT_FROM_SOURCE, handleComputeLimitFromSource);
}

/** UNDERWRITE/COMPUTE_LIMIT — revenue in, decision out, figures never echoed. */
export function handleComputeLimit(msg: string): HandlerResult {
  // 1. Decode
  let raw: Uint8Array;
  try {
    raw = hexToBytes(msg);
  } catch (e) {
    return [null, 0, `decoding request: invalid hex: ${String(e)}`];
  }
  let req: any;
  try {
    req = JSON.parse(Buffer.from(raw).toString("utf-8"));
  } catch (e) {
    return [null, 0, `decoding request: ${String(e)}`];
  }
  if (typeof req !== "object" || req === null || Array.isArray(req)) {
    return [null, 0, "decoding request: expected a JSON object"];
  }
  const allowed = ["accountId", "periods", "accountCreatedAt", "closedCleanCycles", "nowTs"];
  const unknown = Object.keys(req).filter((k) => !allowed.includes(k)).sort();
  if (unknown.length > 0) {
    return [null, 0, `decoding request: unknown field "${unknown[0]}"`];
  }

  // 2. Validate — the enclave re-checks what the oracle would have enforced.
  if (typeof req.accountId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(req.accountId)) {
    return [null, 0, "validating: accountId must be a bytes32 hex string"];
  }
  if (!Array.isArray(req.periods) || req.periods.length === 0) {
    return [null, 0, "validating: at least one revenue period is required"];
  }
  const nowTs = Number(req.nowTs);
  if (!Number.isInteger(nowTs) || nowTs <= 0) {
    return [null, 0, "validating: nowTs must be a positive unix time"];
  }
  let prevEnd = 0;
  for (const p of req.periods as Period[]) {
    if (
      !Number.isInteger(p.revenueCents) || p.revenueCents < 0 ||
      !Number.isInteger(p.periodStart) || !Number.isInteger(p.periodEnd) ||
      p.periodEnd <= p.periodStart ||
      (p.refundCents !== undefined && (!Number.isInteger(p.refundCents) || p.refundCents < 0))
    ) {
      return [null, 0, "validating: malformed period"];
    }
    if (p.periodStart < prevEnd) {
      return [null, 0, "validating: overlapping periods"];
    }
    prevEnd = p.periodEnd;
  }
  const createdAt = Number(req.accountCreatedAt ?? 0);
  const cycles = BigInt(Number(req.closedCleanCycles ?? 0));

  /*
   * The freeze covenant, inside the boundary. The public AdvanceManager refuses originations past
   * the VAMP freeze ratio; an enclave that skipped the same check would make the private path the
   * loophole. The refusal names the policy, never the figures.
   */
  const ratio = refundRatioBps(req.periods as Period[]);
  if (ratio >= REFUND_FREEZE_BPS) {
    return [null, 0, "policy: the latest period's refund ratio exceeds the origination freeze threshold"];
  }

  // 3. Execute — AdvanceManager's arithmetic, verbatim in BigInt.
  const periods = req.periods as Period[];
  const lastN = periods.slice(-POLICY.periodsAveraged);
  const sum = lastN.reduce((s, p) => s + BigInt(p.revenueCents), 0n);
  const avg = sum / BigInt(lastN.length);
  const latest = BigInt(periods[periods.length - 1].revenueCents);
  const base = latest < avg ? latest : avg;

  let factor: bigint;
  if (createdAt === 0 || BigInt(nowTs) < BigInt(createdAt) + POLICY.minAccountAgeSeconds) {
    factor = POLICY.baseFactorBps;
  } else {
    factor = POLICY.baseFactorBps + POLICY.stepFactorBps * cycles;
    if (periods.length > 1) factor += POLICY.historyStepBps * BigInt(periods.length - 1);
    if (factor > POLICY.capFactorBps) factor = POLICY.capFactorBps;
  }

  let limit = (base * factor) / 10_000n;
  if (limit > POLICY.maxAdvanceCents) limit = POLICY.maxAdvanceCents;

  const shortfall = POLICY.capFactorBps - factor;
  const fee = POLICY.feeBps + (POLICY.riskPremiumBps * shortfall) / POLICY.capFactorBps;

  underwriteCount++;

  // 4. Respond — the decision and nothing else. No revenue figure leaves this function.
  const out = {
    accountId: req.accountId,
    limitCents: Number(limit),
    factorBps: Number(factor),
    feeBps: Number(fee),
    periodsUsed: lastN.length,
    computedAt: nowTs,
  };
  return [bytesToHex(Buffer.from(JSON.stringify(out), "utf-8")), 1, null];
}

/** Only the count is reportable. Revenue never enters state at all. */
export function reportUnderwriteState(): unknown {
  return { underwriteCount };
}


// ---------------------------------------------------------------------------
// UNDERWRITE / COMPUTE_LIMIT_FROM_SOURCE — the key never leaves the enclave.
//
// The public FDC path has one disclosure it cannot avoid: data providers each
// call the processor's API themselves, so the API key rides in public
// calldata. This op closes that. The instruction carries only an account
// reference and a window; the enclave holds the key, makes the call itself,
// and returns the decision. Neither the key nor the revenue figure ever
// appears on chain, in calldata, or in the response.
//
// The trust trade is explicit: the public path trusts Flare's provider quorum
// to have read the API honestly; this path trusts the attested enclave to
// have. Both produce the same decision for the same account, which is what
// lets them be offered side by side.

/** Injectable for tests; the real one is the container's fetch. */
let fetchImpl: typeof fetch = fetch;
export function setFetchImplForTests(f: typeof fetch): void {
  fetchImpl = f;
}

const STRIPE_API = "https://api.stripe.com/v1/balance_transactions";

export async function handleComputeLimitFromSource(msg: string): Promise<HandlerResult> {
  // 1. Decode — same envelope discipline as COMPUTE_LIMIT.
  let raw: Uint8Array;
  try {
    raw = hexToBytes(msg);
  } catch (e) {
    return [null, 0, `decoding request: invalid hex: ${String(e)}`];
  }
  let req: any;
  try {
    req = JSON.parse(Buffer.from(raw).toString("utf-8"));
  } catch (e) {
    return [null, 0, `decoding request: ${String(e)}`];
  }
  if (typeof req !== "object" || req === null || Array.isArray(req)) {
    return [null, 0, "decoding request: expected a JSON object"];
  }
  const allowed = ["accountId", "periodStart", "periodEnd", "accountCreatedAt", "closedCleanCycles", "nowTs"];
  const unknown = Object.keys(req).filter((k) => !allowed.includes(k)).sort();
  if (unknown.length > 0) {
    return [null, 0, `decoding request: unknown field "${unknown[0]}"`];
  }

  // 2. Validate. The window rules mirror RevenueOracle: a period is a month.
  if (typeof req.accountId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(req.accountId)) {
    return [null, 0, "validating: accountId must be a bytes32 hex string"];
  }
  const periodStart = Number(req.periodStart);
  const periodEnd = Number(req.periodEnd);
  const nowTs = Number(req.nowTs);
  if (!Number.isInteger(periodStart) || !Number.isInteger(periodEnd) || periodEnd <= periodStart) {
    return [null, 0, "validating: periodEnd must be after periodStart"];
  }
  const span = periodEnd - periodStart;
  const DAY = 24 * 60 * 60;
  if (span < 26 * DAY || span > 32 * DAY) {
    return [null, 0, "validating: a period must span 26 to 32 days"];
  }
  if (!Number.isInteger(nowTs) || nowTs <= 0) {
    return [null, 0, "validating: nowTs must be a positive unix time"];
  }

  // 3. The enclave reads the processor itself. The key exists only here.
  const key = process.env.STRIPE_API_KEY;
  if (!key) {
    return [null, 0, "source: no STRIPE_API_KEY provisioned in the enclave"];
  }

  let revenueCents = 0;
  try {
    let startingAfter: string | null = null;
    for (let page = 0; page < 10; page++) {
      const params = new URLSearchParams({
        limit: "100",
        "created[gte]": String(periodStart),
        "created[lt]": String(periodEnd),
      });
      if (startingAfter) params.set("starting_after", startingAfter);
      const res = await fetchImpl(`${STRIPE_API}?${params}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) {
        return [null, 0, `source: processor returned ${res.status}`];
      }
      const body: any = await res.json();
      for (const txn of body.data ?? []) {
        // Net of processor fees, like the public jq reduction: the money the business keeps.
        if (txn.type === "charge" || txn.type === "payment") revenueCents += txn.net ?? 0;
      }
      if (!body.has_more || !body.data?.length) break;
      startingAfter = body.data[body.data.length - 1].id;
    }
  } catch (e) {
    return [null, 0, `source: ${String(e)}`];
  }
  if (revenueCents < 0) revenueCents = 0;

  // 4. Execute the same policy arithmetic as COMPUTE_LIMIT, over the fetched figure.
  const createdAt = Number(req.accountCreatedAt ?? 0);
  const cycles = BigInt(Number(req.closedCleanCycles ?? 0));
  const base = BigInt(revenueCents);

  let factor: bigint;
  if (createdAt === 0 || BigInt(nowTs) < BigInt(createdAt) + POLICY.minAccountAgeSeconds) {
    factor = POLICY.baseFactorBps;
  } else {
    factor = POLICY.baseFactorBps + POLICY.stepFactorBps * cycles;
    if (factor > POLICY.capFactorBps) factor = POLICY.capFactorBps;
  }

  let limit = (base * factor) / 10_000n;
  if (limit > POLICY.maxAdvanceCents) limit = POLICY.maxAdvanceCents;

  const shortfall = POLICY.capFactorBps - factor;
  const fee = POLICY.feeBps + (POLICY.riskPremiumBps * shortfall) / POLICY.capFactorBps;

  underwriteCount++;

  // 5. Respond — the decision alone. The fetched revenue dies with this stack frame.
  const out = {
    accountId: req.accountId,
    limitCents: Number(limit),
    factorBps: Number(factor),
    feeBps: Number(fee),
    periodsUsed: 1,
    computedAt: nowTs,
  };
  return [bytesToHex(Buffer.from(JSON.stringify(out), "utf-8")), 1, null];
}
