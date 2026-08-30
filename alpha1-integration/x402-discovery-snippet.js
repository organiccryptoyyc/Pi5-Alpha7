// x402-discovery-snippet.js -- discovery-extension declarations for the two
// new routes, to merge into x402Middleware.js's routes map alongside every
// other route's declareDiscoveryExtension() call.
//
// Kept deliberately minimal -- one-line description, a flat 3-5 field
// example, no nested objects/arrays. This is a direct application of the
// seller-trust root-cause finding already documented in this project's
// README: a large/deeply-nested discovery-extension payload was the
// confirmed, isolated cause of that route's live-payment failures,
// independent of price or URL shape. Both routes below follow the same
// minimal-example style as geo/ip and heic-to-png, the two routes the
// README cites as the safe pattern.

export const edgeRoutes = {
  "edge/rpc-pulse": {
    price: "$0.015",
    description: "Latest RPC/gateway latency and success reading from an independently-hosted vantage point.",
    pathParams: { chain: "eth" },
    queryParams: { provider: "llamarpc" },
    output: {
      example: {
        chain: "eth",
        readings: [{ vantage: "yyc-home", provider: "llamarpc", latencyMs: 84, success: true }],
      },
    },
  },
  "edge/rpc-performance": {
    price: "$0.045",
    description: "Ranked RPC/gateway performance over a trailing window, measured from an independent vantage point -- which endpoint to actually use right now.",
    pathParams: { chain: "sol" },
    queryParams: { window: "24h" },
    output: {
      example: {
        chain: "sol",
        window: "24h",
        recommended: { vantage: "yyc-home", provider: "solana-mainnet" },
      },
    },
  },
};

// Suggested pricing rationale (matches this project's existing tiers):
// - rpc-pulse ($0.015): above the $0.005-0.008 commodity snapshot tier
//   (this cost real infrastructure to produce, isn't a free-API pass-through)
//   but below composite-bundle pricing (no aggregation logic, one reading).
// - rpc-performance ($0.045): priced like the composite/judgment tier
//   (chain-snapshot $0.012, wallet-risk $0.045) since it aggregates,
//   ranks, and recommends rather than passing through a single value.
