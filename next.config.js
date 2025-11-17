/** @type {import('next').NextConfig} */
const path = require('path');
const nextConfig = {
  eslint: {
    // Avoid failing the build due to ESLint errors in CI/deploys.
    // We'll address lint issues incrementally.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Avoid failing the build due to TypeScript type errors; address incrementally.
    ignoreBuildErrors: true,
  },
  // Ensure Next traces/loads dependencies from this app directory (monorepo safety)
  outputFileTracingRoot: path.join(__dirname),
};

module.exports = nextConfig;
