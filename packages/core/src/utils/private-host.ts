// SSRF guard: one home for the outbound-destination allow/block classifier.
// Shared by a2a-client and web-fetch-tool so the private/loopback/link-local +
// cloud-metadata block list can never silently drift between the two callers.

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/u.test(part)) return Number.NaN;
    return Number(part);
  });
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return octets as [number, number, number, number];
}

/**
 * True when `hostname` is a destination an outbound request MUST NOT reach:
 * localhost / 0.0.0.0 / the GCP metadata host, any private or link-local IPv4
 * range (0/10/127/169.254/172.16-31/192.168), IPv4-mapped IPv6, or fc/fd/fe80
 * IPv6. Used as a fail-closed SSRF check before fetching a user-influenced URL.
 */
export function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '').replace(/\.$/u, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::' ||
    host === '::1' ||
    host === 'metadata.google.internal'
  ) {
    return true;
  }
  const ipv4 = parseIpv4(host);
  if (ipv4) {
    const [a, b] = ipv4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (host.startsWith('::ffff:')) {
    const mapped = parseIpv4(host.slice('::ffff:'.length));
    if (mapped) return isPrivateOrLocalHost(mapped.join('.'));
  }
  return host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
}
