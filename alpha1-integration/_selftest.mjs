// Regression test for edgeStore/edgeDataSource/edgeIngestRoute -- no real
// alpha1 server, Pi, or network access required. Run with `node _selftest.mjs`
// any time these files change; it exercises validation, ranking math, and
// the ingest route's auth (including fail-closed when EDGE_INTERNAL_KEY is
// unset) against fabricated data and a fake Express req/res.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEdgeStore } from "./edgeStore.js";
import { makeEdgeDataSource, parseWindow } from "./edgeDataSource.js";
import { registerEdgeIngestRoute } from "./edgeIngestRoute.js";

const dir = mkdtempSync(join(tmpdir(), "edgestore-test-"));
const filePath = join(dir, "measurements.ndjson");

const store = createEdgeStore({ filePath, retentionMs: 7 * 24 * 60 * 60 * 1000 });

const now = Date.now();
const fixtures = [];
// providerA: fast, always succeeds
for (let i = 0; i < 20; i++) {
  fixtures.push({ vantage: "yyc-home", chain: "eth", provider: "providerA", ts: now - i * 1000, success: true, timeout: false, latencyMs: 80 + (i % 5), errorCode: null });
}
// providerB: slower, and 3 timeouts mixed in
for (let i = 0; i < 20; i++) {
  const isTimeout = i % 7 === 0;
  fixtures.push({
    vantage: "yyc-home",
    chain: "eth",
    provider: "providerB",
    ts: now - i * 1000,
    success: !isTimeout,
    timeout: isTimeout,
    latencyMs: isTimeout ? null : 200 + (i % 10),
    errorCode: isTimeout ? "timeout" : null,
  });
}
// malformed records that must be rejected
const malformed = [
  { vantage: "yyc-home", chain: "eth", provider: "x" }, // missing ts/success/timeout
  { vantage: "yyc-home", chain: "eth", provider: "x", ts: now + 999999, success: true, timeout: false }, // future-dated
  { vantage: "", chain: "eth", provider: "x", ts: now, success: true, timeout: false }, // empty vantage
  null,
  "not an object",
];

const acceptedCount = store.append([...fixtures, ...malformed]);
assert.equal(acceptedCount, fixtures.length, `expected ${fixtures.length} accepted, got ${acceptedCount}`);
console.log(`[ok] append accepted ${acceptedCount}/${fixtures.length + malformed.length}, rejected malformed rows correctly`);

const ds = makeEdgeDataSource(store);

// --- pulse ---
const pulse = ds.getEdgeRpcPulse("eth");
assert.equal(pulse.readings.length, 2, "expected latest reading for both providers");
console.log("[ok] pulse returns one latest reading per provider:", pulse.readings.map((r) => `${r.provider}@${r.latencyMs}ms`));

// --- performance / ranking ---
const perf = ds.getEdgeRpcPerformance("eth", "24h");
assert.equal(perf.providers.length, 2);
assert.equal(perf.providers[0].provider, "providerA", "providerA (faster, 100% success) should rank first");
assert.ok(perf.providers[0].successRate === 1, "providerA success rate should be 1.0");
const providerB = perf.providers.find((p) => p.provider === "providerB");
assert.ok(providerB.timeoutRate > 0, "providerB should show a nonzero timeout rate");
assert.equal(perf.recommended.provider, "providerA");
console.log("[ok] performance ranking:", JSON.stringify(perf.providers, null, 2));

// --- bad window ---
assert.equal(parseWindow("3 weeks"), null, "garbage window string should be rejected");
const badWindowResult = ds.getEdgeRpcPerformance("eth", "3 weeks");
assert.equal(badWindowResult, null, "route layer should be able to detect bad window and 400");
console.log("[ok] invalid window value rejected as expected");

// --- empty chain ---
const emptyChain = ds.getEdgeRpcPulse("nonexistent-chain");
assert.equal(emptyChain.readings.length, 0);
console.log("[ok] unknown chain returns empty readings with a note, not a crash");

// --- ingest route auth/validation, via a fake req/res ---
process.env.EDGE_INTERNAL_KEY = "correct-horse-battery-staple";

function fakeReqRes(body, headers = {}) {
  const req = { body, get: (h) => headers[h.toLowerCase()] };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return { req, res };
}

// capture the handler registered on a fake app
let handler;
const fakeApp = { post: (path, fn) => { if (path === "/internal/edge/ingest") handler = fn; } };
registerEdgeIngestRoute(fakeApp, store);
assert.ok(handler, "route handler should have been registered");

// wrong key -> 401
{
  const { req, res } = fakeReqRes({ vantage: "yyc-home", measurements: [{ chain: "eth", provider: "x", ts: Date.now(), success: true, timeout: false }] }, { "x-internal-key": "wrong" });
  handler(req, res);
  assert.equal(res.statusCode, 401);
  console.log("[ok] wrong shared secret -> 401");
}

// missing key entirely -> 401 (not a crash)
{
  const { req, res } = fakeReqRes({ vantage: "yyc-home", measurements: [] });
  handler(req, res);
  assert.equal(res.statusCode, 401);
  console.log("[ok] missing shared secret header -> 401");
}

// correct key, valid body -> 200 + accepted count
{
  const { req, res } = fakeReqRes(
    { vantage: "yyc-home", measurements: [{ chain: "sol", provider: "test", ts: Date.now(), success: true, timeout: false, latencyMs: 55, errorCode: null }] },
    { "x-internal-key": "correct-horse-battery-staple" }
  );
  handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.accepted, 1);
  console.log("[ok] correct key + valid batch -> 200, accepted:1");
}

// fail-closed when EDGE_INTERNAL_KEY unset
{
  delete process.env.EDGE_INTERNAL_KEY;
  const { req, res } = fakeReqRes({ vantage: "x", measurements: [] }, { "x-internal-key": "anything" });
  handler(req, res);
  assert.equal(res.statusCode, 503);
  console.log("[ok] EDGE_INTERNAL_KEY unset -> 503 fail-closed, not open");
}

rmSync(dir, { recursive: true, force: true });
console.log("\nAll self-tests passed.");
