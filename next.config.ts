import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.RESEARCH_TRIAL_BUILD === "1" ? "standalone" : undefined,
  outputFileTracingIncludes: {
    "/api/latex/pdf-cmaps/\\[name\\]": ["./node_modules/pdfjs-dist/cmaps/*.bcmap"],
    "/api/word/import": ["./node_modules/pdfjs-dist/cmaps/*.bcmap", "./node_modules/pdfjs-dist/standard_fonts/*",
      "./node_modules/pdfjs-dist/legacy/build/pdf.mjs", "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/@napi-rs/canvas*/**/*"],
  },
};

export default nextConfig;
