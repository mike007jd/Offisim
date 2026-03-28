import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@offisim/ui-market', '@offisim/registry-client'],
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
};

export default nextConfig;
