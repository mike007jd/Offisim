import { RegistryClient } from '@offisim/registry-client';

const PLATFORM_API_URL = process.env.PLATFORM_API_URL ?? 'http://localhost:4100';

export function getRegistryClient() {
  return new RegistryClient({ baseUrl: PLATFORM_API_URL });
}
