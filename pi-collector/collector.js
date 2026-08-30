// collector.js -- the probe loop. Runs forever, probes every configured
// endpoint on an interval, appends results to the local buffer.
//
// Deliberately does NOT touch Myst or Teneo in any way -- this process only
// knows about the endpoints listed in config.json. If you want a liveness
// gate on those services, see index.js's optional healthGate() -- it never
// puts their status in a measurement record, only decides whether to publish.

import { appendMeasurements, ensureDir } from "./buffer.js";
import { probeAll } from "./probe.js";

export function startCollector(config) {
  ensureDir(config.bufferFile);
  let stopped = false;

  async function tick() {
    if (stopped) return;
    try {
      const results = await probeAll(config.endpoints, config.probeTimeoutMs);
      await appendMeasurements(config.bufferFile, results.map((r) => ({ vantage: config.vantage, ...r })));
      const okCount = results.filter((r) => r.success).length;
      console.log(`[collector] probed ${results.length} endpoints, ${okCount} ok`);
    } catch (err) {
      // A probe-loop failure should never crash the process -- next tick tries again.
      console.error("[collector] tick failed:", err);
    }
  }

  const timer = setInterval(tick, config.probeIntervalMs);
  tick(); // don't wait a full interval for the first reading

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
