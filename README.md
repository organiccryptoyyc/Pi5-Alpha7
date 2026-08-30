# edge-pulse

A new monetized route for alpha1 (`organiccryptoyyc/alpha1`): independent
RPC/gateway performance data, measured from a Pi 5 on your own network
rather than from cloud infrastructure alpha1 already has.

Two halves:

- **`pi-collector/`** -- deploy to the Pi 5. Probes a configurable list of
  RPC/gateway endpoints, buffers locally, publishes batches to alpha1.
- **`alpha1-integration/`** -- merge into the alpha1 repo running on your
  Umbrel box. An internal ingest route, a lightweight measurement store, and
  two new public x402 routes: `GET /v1/edge/rpc-pulse/:chain` and
  `GET /v1/edge/rpc-performance/:chain?window=24h`.

Start with `alpha1-integration/INTEGRATION.md` for the merge steps, then
`pi-collector/README.md` for the Pi deployment.

## Scope, on purpose

This collects RPC/gateway latency, success rate, timeout rate, and error
codes -- nothing else. Myst and Teneo Beacon run on the same Pi but are
never read, referenced, or included in any measurement or paid response.
Prices, weather, wallets, and general scraping were all considered and
deliberately left out -- see the conversation history in this session for
why: the only thing this Pi produces that alpha1's existing cloud-sourced
routes can't is an independent, physically-located measurement of what the
network actually looks like from outside a data center.

## Verified before delivery

- Every file syntax-checks clean (`node --check`) on Node 22.
- `alpha1-integration/_selftest.mjs` passes: ingest validation rejects
  malformed/future-dated/empty-field records, ranking math correctly favors
  a reliable-but-average provider over a fast-but-flaky one, the auth path
  returns 401 on a wrong/missing key and 503 (fail-closed) when
  `EDGE_INTERNAL_KEY` is unset entirely.
- `pi-collector/probe.js` was live-tested against real endpoints from this
  session's own network (which is allowlisted and blocked several of the
  test calls with HTTP 403) -- confirms the classifier correctly labels
  HTTP errors, DNS/network failures, and unconfigured placeholder URLs
  instead of crashing or mis-scoring them. It has not been tested against
  the Pi's actual network path or your real Pocket gateway URL -- do that
  as the first step in `pi-collector/README.md`.
- **Not yet done, and shouldn't be treated as done:** an actual deploy to
  your Pi and Umbrel box, and a live x402 payment settled against either
  new route. `INTEGRATION.md` step 8 covers this explicitly -- this
  project's own README is clear elsewhere that "built and syntax-checked"
  and "live-tested" are different claims, and that discipline applies here
  too.

## Natural next step

`edgeStore.js` already groups everything by `vantage`, so a second Pi in a
different city/ISP is a config change on that Pi (not a server-side code
change) whenever that's worth doing -- see the "not in this delivery"
section of `INTEGRATION.md`.
