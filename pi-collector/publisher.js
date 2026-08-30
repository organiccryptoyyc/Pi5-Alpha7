// publisher.js -- batches the local buffer to alpha1's ingest route.
//
// Durability rule: a batch is only removed from disk after the server
// acknowledges it. A dead network, a rebooted Umbrel box, or a Pi power
// blip just means the next tick retries -- nothing is dropped short of the
// disk filling up.

import { clearFile, readRecords, rotateForSending } from "./buffer.js";

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function postBatch(url, key, vantage, records, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-key": key,
      },
      body: JSON.stringify({ vantage, measurements: records }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ingest rejected batch: ${res.status} ${text.slice(0, 200)}`);
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}

export function startPublisher(config) {
  let stopped = false;
  let timer = null;
  let backoffMs = 5000;
  const maxBackoffMs = 5 * 60 * 1000;

  async function tick() {
    if (stopped) return;
    let nextDelay = config.publishIntervalMs;

    try {
      await rotateForSending(config.bufferFile, config.bufferFileTmp);
      const pending = await readRecords(config.bufferFileTmp);

      if (pending.length > 0) {
        const batches = chunk(pending, config.maxBatchSize);
        let sentThrough = 0;
        for (const batch of batches) {
          await postBatch(config.ingestUrl, config.ingestKey, config.vantage, batch, config.publishTimeoutMs ?? 10000);
          sentThrough += batch.length;
        }
        await clearFile(config.bufferFileTmp);
        console.log(`[publisher] sent ${sentThrough} measurements`);
      }
      backoffMs = 5000; // reset backoff after any clean tick, empty batch included
    } catch (err) {
      console.error(`[publisher] send failed, will retry in ${Math.round(backoffMs / 1000)}s:`, err.message || err);
      nextDelay = backoffMs;
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
    }

    if (!stopped) timer = setTimeout(tick, nextDelay);
  }

  timer = setTimeout(tick, config.publishIntervalMs);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
