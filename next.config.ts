import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
  outputFileTracingRoot: path.join(__dirname),
  webpack: (config) => {
    // Windows + Node 22의 webpack readlink EISDIR 버그 우회
    config.resolve = config.resolve || {};
    config.resolve.symlinks = false;
    config.snapshot = config.snapshot || {};
    config.snapshot.resolveBuildDependencies = { ...(config.snapshot.resolveBuildDependencies || {}), hash: true };
    config.snapshot.module = { ...(config.snapshot.module || {}), hash: true };
    return config;
  },
};

export default nextConfig;
