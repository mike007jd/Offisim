export function byteLength(value: string): number {
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(value, 'utf8');
  }
  return new TextEncoder().encode(value).length;
}

// Number of bytes to drop from the end of a UTF-8 slice cut at `length` so the
// result ends on a complete code point. Returns the count of incomplete
// trailing bytes (0 when the slice already ends on a sequence boundary).
function incompleteTrailingBytes(bytes: Uint8Array, length: number): number {
  if (length <= 0) return 0;
  // Walk back over continuation bytes (0x80-0xBF) to find the last lead byte.
  let i = length - 1;
  while (i >= 0 && ((bytes[i] ?? 0) & 0xc0) === 0x80) {
    i--;
  }
  if (i < 0) return length; // no lead byte in range; the whole tail is broken
  const lead = bytes[i] ?? 0;
  let expected: number;
  if (lead < 0x80) expected = 1;
  else if ((lead & 0xe0) === 0xc0) expected = 2;
  else if ((lead & 0xf0) === 0xe0) expected = 3;
  else if ((lead & 0xf8) === 0xf0) expected = 4;
  else return length - i; // invalid lead byte; drop it and its trailing bytes
  const available = length - i;
  // Complete sequence: keep it. Incomplete: drop the lead + partial bytes.
  return available >= expected ? 0 : available;
}

export function clampUtf8(value: string, maxBytes: number): string {
  if (byteLength(value) <= maxBytes) return value;
  if (maxBytes <= 0) return '';
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(value, 'utf8');
    const end = maxBytes - incompleteTrailingBytes(buf, maxBytes);
    return buf.subarray(0, end).toString('utf8');
  }
  const encoded = new TextEncoder().encode(value);
  const end = maxBytes - incompleteTrailingBytes(encoded, maxBytes);
  return new TextDecoder('utf-8', { fatal: false }).decode(encoded.subarray(0, end));
}
