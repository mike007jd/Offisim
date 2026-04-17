export function byteLength(value: string): number {
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(value, 'utf8');
  }
  return new TextEncoder().encode(value).length;
}

export function clampUtf8(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(value, 'utf8');
    return buf.subarray(0, maxBytes).toString('utf8');
  }
  const encoded = new TextEncoder().encode(value);
  return new TextDecoder('utf-8', { fatal: false }).decode(encoded.subarray(0, maxBytes));
}
