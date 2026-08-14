/** Ledgerline private underwriting — the enclave-side mirror of AdvanceManager's math. */

import { beforeEach, describe, expect, it } from "vitest";

import { bytesToHex } from "../base/encoding.js";
import { handleComputeLimit } from "../app/handlers.js";

const ACCOUNT = "0x" + "c6".repeat(32);
const MONTH = 30 * 24 * 60 * 60;
const JAN = 1767225600;
const NOW = JAN + 12 * MONTH;

function call(payload: unknown): [any, number, string | null] {
  const hex = bytesToHex(Buffer.from(JSON.stringify(payload), "utf-8"));
  const [data, status, err] = handleComputeLimit(hex);
  const decoded = data ? JSON.parse(Buffer.from(data.slice(2), "hex").toString("utf-8")) : null;
  return [decoded, status, err];
}

function months(cents: number, n: number, startAt = JAN) {
  return Array.from({ length: n }, (_, i) => ({
    revenueCents: cents,
    periodStart: startAt + i * MONTH,
    periodEnd: startAt + (i + 1) * MONTH,
  }));
}

describe("UNDERWRITE/COMPUTE_LIMIT", () => {
  it("prices an unknown-age account at the base factor — the recycling bound", () => {
    const [out, status] = call({
      accountId: ACCOUNT,
      periods: months(400_000, 3),
      nowTs: NOW,
    });
    expect(status).toBe(1);
    expect(out.factorBps).toBe(250);
    expect(out.limitCents).toBe(10_000); // 2.5% of $4,000
    expect(out.feeBps).toBe(890); // 500 + 400*(10000-250)/10000
  });

  it("gives an aged account credit for history and cycles, up to the cap", () => {
    const [out] = call({
      accountId: ACCOUNT,
      periods: months(400_000, 3),
      accountCreatedAt: JAN - 12 * MONTH,
      closedCleanCycles: 2,
      nowTs: NOW,
    });
    // 250 + 2000*2 + 800*2 = 5850
    expect(out.factorBps).toBe(5850);
    expect(out.limitCents).toBe(234_000);

    const [capped] = call({
      accountId: ACCOUNT,
      periods: months(400_000, 3),
      accountCreatedAt: JAN - 12 * MONTH,
      closedCleanCycles: 9,
      nowTs: NOW,
    });
    expect(capped.factorBps).toBe(10_000);
    expect(capped.feeBps).toBe(500); // the premium melts at the cap
  });

  it("prices a collapse on the collapse, not the history", () => {
    const periods = [...months(400_000, 2), ...months(40_000, 1, JAN + 2 * MONTH)];
    const [out] = call({ accountId: ACCOUNT, periods, nowTs: NOW });
    // mean $2,800 vs latest $400 -> base is the collapse; 2.5% of $400.
    expect(out.limitCents).toBe(1_000);
  });

  it("re-validates instead of trusting: overlapping periods are rejected", () => {
    const periods = months(400_000, 2);
    periods[1].periodStart = periods[0].periodEnd - 1;
    const [, status, err] = call({ accountId: ACCOUNT, periods, nowTs: NOW });
    expect(status).toBe(0);
    expect(err).toContain("overlapping");
  });

  it("rejects unknown fields, malformed periods and bad account ids", () => {
    expect(call({ accountId: ACCOUNT, periods: months(1, 1), nowTs: NOW, extra: 1 })[1]).toBe(0);
    expect(call({ accountId: "0x1234", periods: months(1, 1), nowTs: NOW })[1]).toBe(0);
    expect(
      call({
        accountId: ACCOUNT,
        periods: [{ revenueCents: 1, periodStart: 10, periodEnd: 5 }],
        nowTs: NOW,
      })[1]
    ).toBe(0);
  });

  it("returns the decision and only the decision — no revenue figure in the output", () => {
    const [out] = call({ accountId: ACCOUNT, periods: months(400_000, 3), nowTs: NOW });
    const keys = Object.keys(out).sort();
    expect(keys).toEqual(["accountId", "computedAt", "factorBps", "feeBps", "limitCents", "periodsUsed"]);
    expect(JSON.stringify(out)).not.toContain("400000");
  });
});

describe("the refund covenant, inside the boundary", () => {
  // The public AdvanceManager freezes originations at Visa's VAMP threshold (2.2% of gross refunded).
  // The enclave must refuse the same accounts, or the private path becomes the loophole.

  function withRefunds(net: number, refunds: number, startAt = JAN) {
    return [{ revenueCents: net, periodStart: startAt, periodEnd: startAt + MONTH, refundCents: refunds }];
  }

  it("refuses an account whose latest period sits past the freeze ratio", () => {
    // 10,000 / 400,000 of gross = 2.5% — over 2.2%.
    const [out, status, err] = call({
      accountId: ACCOUNT,
      periods: [...months(400_000, 2), ...withRefunds(390_000, 10_000, JAN + 2 * MONTH)],
      nowTs: NOW,
    });
    expect(status).toBe(0);
    expect(out).toBeNull();
    expect(err).toMatch(/refund ratio/);
    // The refusal names the policy, never the figures.
    expect(err).not.toMatch(/\d/);
  });

  it("a warn-level month underwrites fine — only the freeze gates origination", () => {
    // 8,000 / 400,000 = 2% — past the public warn (1.5%), under the freeze (2.2%).
    const [out, status] = call({
      accountId: ACCOUNT,
      periods: [...months(400_000, 2), ...withRefunds(392_000, 8_000, JAN + 2 * MONTH)],
      nowTs: NOW,
    });
    expect(status).toBe(1);
    expect(out.limitCents).toBeGreaterThan(0);
  });

  it("only the latest period gates — a hot month, once behind a clean one, no longer freezes", () => {
    const [, status] = call({
      accountId: ACCOUNT,
      periods: [...withRefunds(390_000, 10_000), ...months(400_000, 1, JAN + MONTH)],
      nowTs: NOW,
    });
    expect(status).toBe(1);
  });

  it("a malformed refundCents is rejected in validation, not silently zeroed", () => {
    const [, status, err] = call({
      accountId: ACCOUNT,
      periods: withRefunds(400_000, -1),
      nowTs: NOW,
    });
    expect(status).toBe(0);
    expect(err).toMatch(/malformed period/);
  });
});
