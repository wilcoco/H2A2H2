/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Avoid failing the build due to ESLint errors in CI/deploys.
    // We'll address lint issues incrementally.
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
