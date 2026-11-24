import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.RESEARCH_TRIAL_BUILD === "1" ? "standalone" : undefined,
  outputFileTracingIncludes: { "/api/latex/pdf-cmaps/\\[name\\]": ["./node_modules/pdfjs-dist/cmaps/*.bcmap"] },
};

export default nextConfig;
