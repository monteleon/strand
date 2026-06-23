/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 14.2 key. (Promoted to top-level `serverExternalPackages` in Next 15;
  // using the top-level key here triggers an "Unrecognized key" warning on 14.2.)
  experimental: {
    serverComponentsExternalPackages: ["@libsql/client"],
  },
};

export default nextConfig;
