/**
 * Studio PlotSize localStorage helpers — persisted per company so a chosen size
 * survives reload and company switching. Not stored in any database table.
 */

import { PLOT_SIZES, type PlotSize } from './StudioState.js';

const PLOT_SIZE_STORAGE_KEY_PREFIX = 'offisim:studio:plot-size:';

/** Sentinel used as the storage key suffix when no companyId exists yet (create mode). */
export const CREATE_PLOT_KEY = 'create';

export function plotSizeStorageKey(companyIdOrCreate: string): string {
  return `${PLOT_SIZE_STORAGE_KEY_PREFIX}${companyIdOrCreate}`;
}

export function readStoredPlotSize(companyIdOrCreate: string): PlotSize | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(plotSizeStorageKey(companyIdOrCreate));
    if (!raw) return null;
    return PLOT_SIZES.find((p) => p.name === raw) ?? null;
  } catch {
    return null;
  }
}

export function writeStoredPlotSize(companyIdOrCreate: string, size: PlotSize): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(plotSizeStorageKey(companyIdOrCreate), size.name);
  } catch {
    // ignore quota / disabled storage
  }
}

export function migrateCreatePlotSize(newCompanyId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const createKey = plotSizeStorageKey(CREATE_PLOT_KEY);
    const value = window.localStorage.getItem(createKey);
    if (!value) return;
    window.localStorage.setItem(plotSizeStorageKey(newCompanyId), value);
    window.localStorage.removeItem(createKey);
  } catch {
    // ignore
  }
}
