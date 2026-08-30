// index.js -- wires the probe loop and publisher together.
//
// Scope reminder (this is the whole point of this project): this process
// probes RPC/gateway endpoints and nothing else. It does not read Myst's or
// Teneo's status, does not touch their config or logs, and has no code path
// that could put their data on the wire. If you want a "did the collector
// itself run cleanly" liveness check, that's what /health below is for --
// it reports on THIS process, not on unrelated services sharing the Pi.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { startCollector } from "./collector.js";
import { startPublisher } from "./publisher.js";

function loadConfig() {
  const fileConfig = JSON.parse(readFileSync(new URL("./config.json", import.meta.url), "utf8"));
  const ingestUrl = process.env.EDGE_INGEST_URL;
  const ingestKey = process.env.EDGE_INTERNAL_KEY;

  if (!ingestUrl || !ingestKey) {
    console.error("EDGE_INGEST_URL and EDGE_INTERNAL_KEY must be set (see .env.example). Refusing to start.");
    process.exit(1);
  }

  return { ...fileConfig, ingestUrl, ingestKey };
}

const config = loadConfig();
console.log(`[edge-pulse] starting collector for vantage "${config.vantage}", ${config.endpoints.length} endpoints configured`);

const stopCollector = startCollector(config);
const stopPublisher = startPublisher(config);

// Minimal local status endpoint -- not exposed to the internet, just for
// `curl localhost:8787/health` when checking on the Pi over SSH.
let lastTickAt = Date.now();
const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, vantage: config.vantage, uptimeSec: Math.round(process.uptime()) }));
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(process.env.EDGE_STATUS_PORT || 8787, "127.0.0.1");

function shutdown() {
  console.log("[edge-pulse] shutting down");
  stopCollector();
  stopPublisher();
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
