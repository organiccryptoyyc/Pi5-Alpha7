# Integrating edge/rpc-pulse into alpha1

I don't have push access to your GitHub repo or SSH access to the Umbrel box,
so this is a merge guide, not an applied patch. Every file in this folder is
either drop-in (copy as-is) or a snippet (paste into an existing file at the
marked spot). Follow in order -- each step assumes the previous one is done.

## 1. Drop in the new files

Copy these two into the same directory as `server.js` / `dataSources.js` /
`x402Middleware.js`:

- `edgeStore.js`
- `edgeIngestRoute.js`
- `edgeDataSource.js`

No new npm dependencies -- all three use only Node built-ins (`node:fs`,
`node:crypto`) and Express, which is already a dependency.

## 2. Wire up the store at boot (server.js)

Near the top of `server.js`, wherever the OFAC list cache or similar
module-level state gets initialized:

```js
import { createEdgeStore } from "./edgeStore.js";
import { registerEdgeIngestRoute } from "./edgeIngestRoute.js";

const edgeStore = createEdgeStore({
  filePath: process.env.EDGE_DATA_PATH || "./data/edge-measurements.ndjson",
  retentionMs: (Number(process.env.EDGE_RETENTION_DAYS) || 30) * 24 * 60 * 60 * 1000,
});

registerEdgeIngestRoute(app, edgeStore);
```

Register this BEFORE `buildX402Middleware()` is applied to the app (or after
-- it doesn't matter, since `/internal/edge/ingest` is never added to
x402Middleware.js's routes map, exactly like `/internal/paysh/*`). Just make
sure it's registered at all; an unregistered route with no `app.post()` call
simply 404s.

## 3. Add the public routes

Paste the contents of `server-route-snippet.js` into `server.js`, in the
same section as the other `/v1/*` route definitions. It expects `edgeStore`
(from step 2) to already be in scope.

## 4. Add the x402 discovery declarations

Open `x402-discovery-snippet.js` and merge its `edgeRoutes` entries into
whatever object `x402Middleware.js` reads route pricing/discovery
declarations from (same shape as your other routes' `declareDiscoveryExtension()`
calls). Keep the examples exactly as minimal as written here -- see the
comment in that file for why.

## 5. Environment and Portainer

Add to `.env` (or as stack-level variables in Portainer, same pattern as
`CDP_API_KEY_ID`):

```
EDGE_INTERNAL_KEY=<the same value you put in the Pi's .env>
EDGE_RETENTION_DAYS=30
```

Generate the key once, use it in both places:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 6. docker-compose.yml

Merge `docker-compose.snippet.yml` into the existing
`onchain-snapshot-api` service -- adds a named volume (`edge-data`) mounted
at `/app/data` so `edge-measurements.ndjson` survives a redeploy, and passes
through the two new env vars. If `EDGE_DATA_PATH` isn't set, the default
`./data/edge-measurements.ndjson` resolves relative to the container's
working directory, which is why the volume mounts at `/app/data` -- adjust
if this project's actual `WORKDIR` differs.

## 7. Deploy and test

Redeploy via Portainer (plain "Pull and redeploy", per this project's own
documented gotcha about the re-pull toggle). Then, from the Pi:

```bash
curl -s http://umbrel-box.local:4021/internal/edge/ingest \
  -H "content-type: application/json" \
  -H "x-internal-key: $EDGE_INTERNAL_KEY" \
  -d '{"vantage":"test","measurements":[{"chain":"eth","provider":"test","ts":'"$(date +%s000)"',"success":true,"timeout":false,"latencyMs":100,"errorCode":null}]}'
# expect: {"accepted":1,"rejected":0}
```

Then confirm the public route sees it:

```bash
curl -s http://umbrel-box.local:4021/v1/edge/rpc-pulse/eth
```

Once that round-trip works, start the real collector service on the Pi (see
`../pi-collector/README.md`) and let it run for a day before trying
`/v1/edge/rpc-performance/eth?window=24h` for real -- a performance window
needs actual samples in it to say anything.

## 8. Before it's live-payment-tested

Same discipline this project already applies to every new route: don't
assume it works until a real x402 payment settles against it. Run a live
payment test against `/v1/edge/rpc-pulse/eth` the same way past rounds in
your README describe (a funded test wallet, watching for the settled
payment), and note the result the same way -- "built and syntax-checked" is
not the same claim as "live-tested," and this README's own history shows why
that distinction matters (see the seller-trust and pay.sh sections).

## What's deliberately NOT in this delivery

- Myst and Teneo Beacon status: never read, never referenced, per your
  explicit call to leave them out entirely.
- A second vantage point / multi-Pi comparison route: the notes from your
  ChatGPT thread frame this as the real moat, but it needs a second
  physical collector to mean anything. `edgeStore.js`'s `vantage` field and
  the `performance()` grouping-by-vantage logic are already shaped to
  support it -- adding a second Pi later is a config change on that Pi
  (`config.json`'s `vantage` field) and zero server-side code changes.
- Pre-computed rollups (5m/1h/1d aggregates): the `performance()` query
  filters raw records on demand. Fine at current volume; revisit only if
  the retained window grows large enough that filtering gets slow (watch
  `edgeStore._debugRecordCount()` if curious).
