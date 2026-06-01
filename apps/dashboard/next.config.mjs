/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // pg and @clickhouse/client are server-only; keep them external from the
  // server bundle so native/dynamic requires resolve at runtime.
  serverExternalPackages: ['pg', '@clickhouse/client'],
};

export default nextConfig;
