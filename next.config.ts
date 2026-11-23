import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.RESEARCH_TRIAL_BUILD === "1" ? "standalone" : undefined,
};

export default nextConfig;
