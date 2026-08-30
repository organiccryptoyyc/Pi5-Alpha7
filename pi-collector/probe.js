// probe.js -- single-endpoint measurement. No dependencies: uses Node's global fetch.
//
// Deliberately dumb: one JSON-RPC call, timed, classified. All the interesting
// work (aggregation, ranking, pricing) happens on the alpha1 side, not here --
// this file's only job is to produce an honest measurement.

const RPC_METHOD_BY_KIND = {
  "evm-rpc": { method: "eth_blockNumber", params: [] },
  "solana-rpc": { method: "getSlot", params: [] },
};

/**
 * Probe one endpoint once.
 * @param {{chain:string, provider:string, url:string, kind:string}} endpoint
 * @param {number} timeoutMs
 * @returns {Promise<object>} a measurement record, always resolves (never throws)
 */
export async function probeEndpoint(endpoint, timeoutMs) {
  const { chain, provider, url, kind } = endpoint;
  const rpc = RPC_METHOD_BY_KIND[kind];
  const base = { chain, provider, ts: Date.now() };

  if (!rpc) {
    return { ...base, success: false, timeout: false, latencyMs: null, errorCode: `unknown_kind:${kind}` };
  }
  if (!url || url.startsWith("REPLACE_")) {
    return { ...base, success: false, timeout: false, latencyMs: null, errorCode: "unconfigured_endpoint" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: rpc.method, params: rpc.params }),
      signal: controller.signal,
    });
    const latencyMs = Math.round(performance.now() - started);

    if (!res.ok) {
      return { ...base, success: false, timeout: false, latencyMs, errorCode: `http_${res.status}` };
    }

    const body = await res.json();
    if (body && body.error) {
      return { ...base, success: false, timeout: false, latencyMs, errorCode: `rpc_error:${body.error.code ?? "unknown"}` };
    }
    if (!body || body.result === undefined) {
      return { ...base, success: false, timeout: false, latencyMs, errorCode: "malformed_response" };
    }

    return { ...base, success: true, timeout: false, latencyMs, errorCode: null };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const isTimeout = err.name === "AbortError";
    return {
      ...base,
      success: false,
      timeout: isTimeout,
      latencyMs: isTimeout ? null : latencyMs,
      errorCode: isTimeout ? "timeout" : `network:${err.code || err.message || "unknown"}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe every configured endpoint concurrently. One slow/dead endpoint never
 * blocks the others -- each has its own AbortController and timeout.
 */
export async function probeAll(endpoints, timeoutMs) {
  return Promise.all(endpoints.map((e) => probeEndpoint(e, timeoutMs)));
}
