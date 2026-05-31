/** @type {import('next').NextConfig} */
const path = require('path');
const nextConfig = {
  eslint: {
    // beta-5b 이후 lint 위반 정리 완료 — 빌드 단계에서 TDZ/any/hooks 위반 차단.
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Ensure Next traces/loads dependencies from this app directory (monorepo safety)
  outputFileTracingRoot: path.join(__dirname),
  // Windows + Node 22에서 webpack의 readlink 호출이 일부 .ts 라우트 파일에 대해
  // EISDIR을 던지는 환경 버그 우회 (symlink resolution 비활성화).
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.symlinks = false;
    if (config.snapshot) {
      config.snapshot.resolveBuildDependencies = { ...(config.snapshot.resolveBuildDependencies || {}), hash: true };
      config.snapshot.module = { ...(config.snapshot.module || {}), hash: true };
    }
    return config;
  },
};

module.exports = nextConfig;
