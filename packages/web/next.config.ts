import path from "path";
import type { NextConfig } from "next";

const monorepoRoot = path.join(__dirname, "../..");

const nextConfig: NextConfig = {
  agentRules: false,
  // TODO(security): remove once Next.js is upgraded past the 16.4.2 advisory.
  experimental: { agentUpgrade: false },
  output: "standalone",
  // Both must match the monorepo root for Turbopack to resolve workspace packages
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
  async headers() {
    return [
      {
        source: "/mermaid-renderer.html",
        // Also isolate direct navigation, not just embeds with the sandbox attribute.
        // The generated document supplies its stricter hash-based resource policy.
        headers: [{ key: "Content-Security-Policy", value: "sandbox allow-scripts" }],
      },
    ];
  },
};

export default nextConfig;
