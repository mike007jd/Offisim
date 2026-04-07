/**
 * Re-exports the real MarketWorkspacePage from @offisim/ui-office.
 *
 * This file exists so the WorkspaceRouter can lazy-import via a default
 * export without pulling in the entire ui-office barrel.
 */
export { MarketWorkspacePage as default } from '@offisim/ui-office';
