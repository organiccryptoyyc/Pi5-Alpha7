// server-route-snippet.js -- paste into server.js.
//
// Placement: register these as ordinary public routes, same as every other
// /v1/* route in this file -- they DO go through buildX402Middleware(),
// unlike /internal/edge/ingest above. Add "edge/rpc-pulse" and
// "edge/rpc-performance" to whatever route-pricing map x402Middleware.js
// reads from server.js (see x402-discovery-snippet.js for the declaration
// shape that goes alongside it).

import { makeEdgeDataSource } from "./edgeDataSource.js";
// edgeStore is the singleton created at boot -- see INTEGRATION.md step 3
// for exactly where to instantiate createEdgeStore() in this file.
const edgeDataSource = makeEdgeDataSource(edgeStore);

app.get("/v1/edge/rpc-pulse/:chain", (req, res) => {
  const { chain } = req.params;
  const { provider, vantage } = req.query;
  const result = edgeDataSource.getEdgeRpcPulse(chain, { provider, vantage });
  res.json(result);
});

app.get("/v1/edge/rpc-performance/:chain", (req, res) => {
  const { chain } = req.params;
  const { window, provider, vantage } = req.query;
  const result = edgeDataSource.getEdgeRpcPerformance(chain, window, { provider, vantage });
  if (result === null) {
    return res.status(400).json({ error: "invalid window -- use one of: 1h, 6h, 24h, 7d" });
  }
  res.json(result);
});
