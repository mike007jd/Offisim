import type { ParsedUrl, UrlFallbackResult, UrlFallbackRuntime } from './types';

type Idish = {
  id?: unknown;
  employee_id?: unknown;
  sopTemplateId?: unknown;
  sop_template_id?: unknown;
  listing_id?: unknown;
  company_id?: unknown;
  event_id?: unknown;
};

function idSetFromMapOrRows(
  input: ReadonlyMap<string, unknown> | readonly unknown[] | undefined,
  keys: readonly (keyof Idish)[],
): Set<string> | null {
  if (!input) return null;
  if (input instanceof Map) {
    const ids = new Set(input.keys());
    return ids.size > 0 ? ids : null;
  }
  const ids = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Idish;
    for (const key of keys) {
      const value = row[key];
      if (typeof value === 'string' && value.length > 0) {
        ids.add(value);
        break;
      }
    }
  }
  return ids.size > 0 ? ids : null;
}

function missing(collection: Set<string> | null, id: string | null | undefined): boolean {
  return Boolean(id && collection && !collection.has(id));
}

function withInfo(result: ParsedUrl, entity: string): UrlFallbackResult {
  return {
    result,
    toast: { level: 'info', message: `Couldn't open the link — ${entity} not found.` },
  };
}

export function applyFallbackRules(
  parsed: ParsedUrl,
  runtime: UrlFallbackRuntime,
): UrlFallbackResult {
  const agents = idSetFromMapOrRows(runtime.agents, ['id', 'employee_id']);
  const sops = idSetFromMapOrRows(runtime.sops, ['sopTemplateId', 'sop_template_id', 'id']);
  const listings = idSetFromMapOrRows(runtime.listings, ['listing_id', 'id']);
  const companies = idSetFromMapOrRows(runtime.companies, ['company_id', 'id']);

  if (parsed.workspace === 'sops') {
    const selectedSopId = parsed.sessionPatch.sops?.selectedSopId;
    if (missing(sops, selectedSopId)) {
      return withInfo(
        {
          ...parsed,
          sessionPatch: {
            ...parsed.sessionPatch,
            sops: {
              ...parsed.sessionPatch.sops,
              selectedSopId: null,
              focusedStepId: null,
            },
          },
        },
        'SOP',
      );
    }
  }

  if (parsed.workspace === 'market') {
    const selectedListingId = parsed.sessionPatch.market?.selectedListingId;
    if (missing(listings, selectedListingId)) {
      return withInfo(
        {
          ...parsed,
          sessionPatch: {
            ...parsed.sessionPatch,
            market: { ...parsed.sessionPatch.market, selectedListingId: null },
          },
        },
        'listing',
      );
    }
  }

  if (parsed.workspace === 'personnel') {
    const selectedEmployeeId = parsed.sessionPatch.personnel?.selectedEmployeeId;
    if (missing(agents, selectedEmployeeId)) {
      return withInfo(
        {
          ...parsed,
          overlay: null,
          sessionPatch: {
            ...parsed.sessionPatch,
            personnel: {
              ...parsed.sessionPatch.personnel,
              selectedEmployeeId: null,
              activeEmployeeTab: 'profile',
            },
          },
        },
        'employee',
      );
    }
  }

  if (parsed.workspace === 'activity-log') {
    const selectedEventId = parsed.sessionPatch.activityLog?.selectedEventId;
    if (selectedEventId && runtime.activeCompanyId === null) {
      return withInfo(
        {
          ...parsed,
          sessionPatch: {
            ...parsed.sessionPatch,
            activityLog: { ...parsed.sessionPatch.activityLog, selectedEventId: null },
          },
        },
        'event',
      );
    }
  }

  if (parsed.overlay === 'studio') {
    const companyId = parsed.companyId ?? runtime.activeCompanyId;
    if (!companyId || missing(companies, companyId)) {
      return {
        result: { workspace: 'office', overlay: null, sessionPatch: {} },
        toast: { level: 'info', message: "Couldn't open the link — company not found." },
      };
    }
  }

  return { result: parsed };
}
