import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  handleComputeLimitFromSource,
  setFetchImplForTests,
} from "../app/handlers.js";

/**
 * COMPUTE_LIMIT_FROM_SOURCE: the enclave reads the processor itself.
 *
 * The properties that matter: the key is read only from the enclave's environment, the fetched revenue
 * appears nowhere in the response, and the decision matches what the same figure produces through the
 * plain COMPUTE_LIMIT arithmetic.
 */

const DAY = 24 * 60 * 60;
const ACCOUNT = "0x" + "ab".repeat(32);

function msg(body: unknown): string {
  return "0x" + Buffer.from(JSON.stringify(body), "utf-8").toString("hex");
}

function stripePage(nets: number[], hasMore = false) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: nets.map((net, i) => ({ id: `txn_${i}`, type: "charge", net })),
      has_more: hasMore,
    }),
  } as unknown as Response;
}

let requests: string[];

beforeEach(() => {
  requests = [];
  process.env.STRIPE_API_KEY = "rk_test_enclave_only";
});

afterEach(() => {
  delete process.env.STRIPE_API_KEY;
  setFetchImplForTests(fetch);
});

describe("UNDERWRITE/COMPUTE_LIMIT_FROM_SOURCE", () => {
  const base = {
    accountId: ACCOUNT,
    periodStart: 1_754_000_000,
    periodEnd: 1_754_000_000 + 30 * DAY,
    nowTs: 1_756_700_000,
  };

  it("fetches inside the enclave and returns only the decision", async () => {
    setFetchImplForTests((async (url: any, init: any) => {
      requests.push(String(url) + "|" + JSON.stringify(init?.headers ?? {}));
      return stripePage([250_000, 141_678]); // $2,500.00 + $1,416.78 net
    }) as typeof fetch);

    const [data, status, err] = await handleComputeLimitFromSource(msg(base));
    expect(err).toBeNull();
    expect(status).toBe(1);

    const out = JSON.parse(Buffer.from(data!.slice(2), "hex").toString("utf-8"));
    // $3,916.78 at the 2.5% cold-start factor: $97.91, matching the public path.
    expect(out.limitCents).toBe(9791);
    expect(out.factorBps).toBe(250);
    expect(out.feeBps).toBe(890);

    // The revenue figure must not appear anywhere in the response.
    expect(JSON.stringify(out)).not.toContain("391678");
    // The key was sent to the processor and nowhere else.
    expect(requests[0]).toContain("Bearer rk_test_enclave_only");
    expect(JSON.stringify(out)).not.toContain("rk_test");
  });

  it("pages through the processor's results", async () => {
    let calls = 0;
    setFetchImplForTests((async () => {
      calls++;
      return calls === 1 ? stripePage([100_000], true) : stripePage([50_000]);
    }) as typeof fetch);

    const [data] = await handleComputeLimitFromSource(msg(base));
    const out = JSON.parse(Buffer.from(data!.slice(2), "hex").toString("utf-8"));
    expect(calls).toBe(2);
    expect(out.limitCents).toBe(3750); // $1,500 × 2.5%
  });

  it("refuses to run without a provisioned key", async () => {
    delete process.env.STRIPE_API_KEY;
    const [data, status, err] = await handleComputeLimitFromSource(msg(base));
    expect(data).toBeNull();
    expect(status).toBe(0);
    expect(err).toContain("no STRIPE_API_KEY");
  });

  it("refuses a window that is not a month", async () => {
    const [, status, err] = await handleComputeLimitFromSource(
      msg({ ...base, periodEnd: base.periodStart + 365 * DAY })
    );
    expect(status).toBe(0);
    expect(err).toContain("26 to 32 days");
  });

  it("surfaces a processor error instead of inventing a zero", async () => {
    setFetchImplForTests((async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch);
    const [, status, err] = await handleComputeLimitFromSource(msg(base));
    expect(status).toBe(0);
    expect(err).toContain("401");
  });

  it("rejects unknown fields outright", async () => {
    const [, status, err] = await handleComputeLimitFromSource(msg({ ...base, revenueCents: 1 }));
    expect(status).toBe(0);
    expect(err).toContain('unknown field "revenueCents"');
  });
});
