# Edge Pulse collector (Pi-side)

Probes a configured list of RPC/gateway endpoints on an interval, buffers
results locally, and publishes them in batches to alpha1's `/internal/edge/ingest`
route. Zero npm dependencies -- Node 18+'s built-in `fetch` is the only
requirement.

Scope, deliberately narrow: this collects **only** RPC/gateway latency and
success/timeout/error data for the endpoints you list in `config.json`. It
does not read, touch, or reference Myst or Teneo Beacon in any way -- they
happen to run on the same Pi, but this process has no code path that could
mix their status into a measurement.

## Install (same pattern as the Myst/Teneo setup on this Pi)

```bash
# on the Pi, over SSH
mkdir -p ~/edge-pulse-collector && cd ~/edge-pulse-collector
# copy every file from this pi-collector/ folder here (scp, git clone, whatever you used for the others)

cp config.example.json config.json
cp .env.example .env
nano config.json   # fill in your real Pocket gateway URL, adjust vantage name
nano .env           # set EDGE_INGEST_URL to the Umbrel box's LAN address, and EDGE_INTERNAL_KEY
```

Generate a key (run once, put the same value in both this `.env` and alpha1's
`EDGE_INTERNAL_KEY`):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Test it standalone first:

```bash
node index.js
# separate terminal:
curl localhost:8787/health
```

You should see `[collector] probed N endpoints, M ok` lines every
`probeIntervalMs` and `[publisher] sent N measurements` every
`publishIntervalMs` (once alpha1's ingest route exists -- see
`../alpha1-integration/INTEGRATION.md`). Until that route is deployed,
`[publisher] send failed` is expected -- the buffer just keeps accumulating
on disk (`data/buffer.ndjson`), nothing is lost.

## Run as a service

```bash
sudo cp edge-collector.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now edge-collector
sudo systemctl status edge-collector
journalctl -u edge-collector -f
```

## Config knobs (`config.json`)

- `vantage` -- a short id for this physical location (`yyc-home`). Shows up
  on every measurement and in the public API response, so an agent buying
  the data knows where it came from.
- `endpoints` -- the list of RPC/gateway URLs to probe. Add or remove
  providers here to change what gets measured; no code changes needed.
- `probeIntervalMs` / `publishIntervalMs` -- how often to probe vs. how
  often to push a batch. Probing more often than you publish is fine and
  intended (batches amortize the network round-trip).
- `probeTimeoutMs` -- how long before a probe counts as `timeout` rather
  than `error`.
