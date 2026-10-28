import type { NextConfig } from "next";

// The development server evaluates code for fast refresh; production builds never need 'unsafe-eval'.
const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  {
    key: "Content-Security-Policy",
    // blob: in connect-src lets the HR Hub PDF preview read the document it has already downloaded.
    value: `default-src 'self'; script-src 'self' 'unsafe-inline'${devEval}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  },
];

// HR & Workforce (the HR Hub) kept these headers in its standalone build: personal data is never cached or indexed.
const hrHeaders = [
  { key: "Cache-Control", value: "no-store" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "pino", "unpdf", "mammoth", "pdfkit"],
  // pdfkit loads its built-in fonts by dynamic path, which file tracing misses on Vercel.
  outputFileTracingIncludes: { "/api/policies/**": ["./node_modules/pdfkit/js/**/*"] },
  experimental: { serverActions: { bodySizeLimit: "11mb" }, optimizePackageImports: ["@phosphor-icons/react"] },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/hr/:path*", headers: hrHeaders },
      { source: "/api/hr/:path*", headers: hrHeaders },
    ];
  },
};

export default config;
