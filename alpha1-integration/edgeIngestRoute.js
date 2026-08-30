// edgeIngestRoute.js -- internal write endpoint for the Pi collector.
//
// Deliberately NOT registered in x402Middleware.js's routes map -- same
// pattern as /internal/paysh/*: this is an internal, shared-secret-gated
// route, not part of the paid public catalog. If EDGE_INTERNAL_KEY is unset,
// every request here 503s rather than silently accepting unauthenticated
// writes. Register this in server.js the same way /internal/paysh/* is
// registered (see INTEGRATION.md) -- do NOT put it behind buildX402Middleware().

import { timingSafeEqual, createHash } from "node:crypto";

const MAX_MEASUREMENTS_PER_REQUEST = 1000; // server-side cap, independent of the Pi's own maxBatchSize

function constantTimeEquals(a, b) {
  // Hash both to a fixed length first so timingSafeEqual never throws on a
  // length mismatch (which would itself leak timing information) -- same
  // technique this project already uses in allowlist.js.
  const ha = createHash("sha256").update(String(a)).digest();
  const hb = createHash("sha256").update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * @param {import('express').Express} app
 * @param {ReturnType<typeof import('./edgeStore.js').createEdgeStore>} edgeStore
 */
export function registerEdgeIngestRoute(app, edgeStore) {
  app.post("/internal/edge/ingest", (req, res) => {
    const configuredKey = process.env.EDGE_INTERNAL_KEY;
    if (!configuredKey) {
      // fail closed: no key configured means this route is off, not open
      return res.status(503).json({ error: "edge ingest not configured" });
    }

    const providedKey = req.get("x-internal-key");
    if (!providedKey || !constantTimeEquals(providedKey, configuredKey)) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const { vantage, measurements } = req.body || {};
    if (typeof vantage !== "string" || vantage.length === 0) {
      return res.status(400).json({ error: "missing vantage" });
    }
    if (!Array.isArray(measurements) || measurements.length === 0) {
      return res.status(400).json({ error: "missing measurements array" });
    }
    if (measurements.length > MAX_MEASUREMENTS_PER_REQUEST) {
      return res.status(413).json({ error: `too many measurements in one request (max ${MAX_MEASUREMENTS_PER_REQUEST})` });
    }

    // the Pi already stamps vantage per-record; this just backfills it if a
    // future collector variant omits it, using the top-level field as default
    const withVantage = measurements.map((m) => ({ vantage, ...m }));
    const accepted = edgeStore.append(withVantage);

    res.json({ accepted, rejected: measurements.length - accepted });
  });
}
