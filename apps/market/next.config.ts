import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@aics/ui-market', '@aics/registry-client'],
};

export default nextConfig;
