import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@aics/ui-market', '@aics/registry-client'],
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
};

export default nextConfig;
