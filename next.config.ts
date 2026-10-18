import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Browsers only honour this over HTTPS, so it's a no-op in local development.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image deployed with Dokploy.
  output: "standalone",
  poweredByHeader: false,
  // PGlite ships WASM and data files that must be loaded from node_modules as-is.
  // The OpenClaw client resolves `ws` internals at runtime, which bundling breaks.
  serverExternalPackages: ["@electric-sql/pglite", "@openclaw/gateway-client", "@openclaw/gateway-protocol", "ws"],
  // …and because it builds those paths at runtime, file tracing can't see them:
  // ship the packages whole in the standalone output.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/ws/**/*", "./node_modules/@openclaw/**/*", "./node_modules/ipaddr.js/**/*"],
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
