/**
 * Shared application constants.
 *
 * Extracted to avoid scattering magic strings across hooks and providers.
 * When multi-company support is added, COMPANY_ID should come from context
 * or URL params instead of this constant.
 */

/** Default company ID used in single-company mode (browser + Tauri). */
export const COMPANY_ID = 'company-001';

/** Default thread ID for the main conversation. */
export const THREAD_ID = 'thread-001';
