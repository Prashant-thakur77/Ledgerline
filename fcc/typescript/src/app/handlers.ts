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

import { OP_COMMAND_COMPUTE_LIMIT, OP_TYPE_UNDERWRITE } from "./config.js";

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
}

export function registerUnderwrite(framework: Framework): void {
  framework.handle(OP_TYPE_UNDERWRITE, OP_COMMAND_COMPUTE_LIMIT, handleComputeLimit);
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
      p.periodEnd <= p.periodStart
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
