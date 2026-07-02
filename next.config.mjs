// Security response headers. Defence-in-depth for a local-first app: no
// framing (clickjacking), no MIME sniffing, no referrer leakage, and a CSP
// that keeps the app same-origin. `frame-ancestors 'none'` also blunts the
// DNS-rebinding surface the middleware host-guard already covers. `'unsafe-
// inline'`/`'unsafe-eval'` are required by Next 14's runtime + framer-motion;
// tighten to nonces if the app ever adds a stricter build step.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 14.2 key. (Promoted to top-level `serverExternalPackages` in Next 15;
  // using the top-level key here triggers an "Unrecognized key" warning on 14.2.)
  experimental: {
    serverComponentsExternalPackages: ["@libsql/client"],
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
