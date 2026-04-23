import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  serverExternalPackages: ["yahoo-finance2", "@anthropic-ai/sdk"],
};
export default nextConfig;
