/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  output: 'standalone',
  // `resolveProjectRoot()` (lib/utils/project-path.ts) builds project paths from
  // `process.cwd()` plus a runtime-only project id, which file tracing can't
  // resolve statically — it falls back to tracing the entire repo root into
  // `.next/standalone` (verified via `du -sh .next/standalone` + a `find` for
  // `.git`/`data`/`.env*`, task 10 of the cleanup audit). Exclude the
  // repo-only directories/files that don't belong in the packaged output.
  outputFileTracingExcludes: {
    '/*': ['.git', '.git/**/*', 'data/**/*', '.flow/**/*', 'tests/**/*', '.env*'],
  },
  // Disable critters optimizeCss to avoid missing module during build
  experimental: {
    optimizeCss: false,
    scrollRestoration: true,
  },
  // Inject project root path as environment variable
  env: {
    NEXT_PUBLIC_PROJECT_ROOT: process.cwd(),
  },
  // Add webpack configuration to handle server-side code properly
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Exclude server-only modules from client bundle
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
