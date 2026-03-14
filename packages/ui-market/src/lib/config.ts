export const PLATFORM_API_URL =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_PLATFORM_API_URL) ||
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_PLATFORM_URL) ||
  'http://localhost:4100';
