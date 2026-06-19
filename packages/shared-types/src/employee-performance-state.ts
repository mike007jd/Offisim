export type EmployeePerformanceKind =
  | 'idle'
  | 'greet'
  | 'enter'
  | 'sit'
  | 'celebrate'
  | 'held'
  | 'carried'
  | 'drop-valid'
  | 'drop-invalid'
  | 'drop-accepted'
  | 'drop-rejected'
  | 'cancel'
  | 'settle';

export type EmployeePerformanceDomain = 'startup' | 'drag-drop' | 'manual';

export interface EmployeePerformanceState {
  readonly employeeId: string;
  readonly kind: EmployeePerformanceKind;
  readonly domain: EmployeePerformanceDomain;
  readonly updatedAt: number;
  readonly zoneId?: string | null;
  readonly targetZoneId?: string | null;
  readonly startupId?: string | null;
}

type EmployeePerformanceSingleAction =
  | {
      readonly type: 'set';
      readonly employeeId: string;
      readonly kind: EmployeePerformanceKind;
      readonly domain: EmployeePerformanceDomain;
      readonly at?: number;
      readonly zoneId?: string | null;
      readonly targetZoneId?: string | null;
      readonly startupId?: string | null;
    }
  | { readonly type: 'clear'; readonly employeeId: string }
  | { readonly type: 'clear-domain'; readonly domain: EmployeePerformanceDomain };

export type EmployeePerformanceAction =
  | EmployeePerformanceSingleAction
  | { readonly type: 'batch'; readonly actions: readonly EmployeePerformanceSingleAction[] };

export type EmployeePerformanceStateMap = ReadonlyMap<string, EmployeePerformanceState>;

export function reduceEmployeePerformanceStates(
  states: EmployeePerformanceStateMap,
  action: EmployeePerformanceAction,
): EmployeePerformanceStateMap {
  if (action.type === 'batch') {
    return action.actions.reduce(reduceEmployeePerformanceStates, states);
  }
  const next = new Map(states);
  if (action.type === 'clear') {
    next.delete(action.employeeId);
    return next;
  }
  if (action.type === 'clear-domain') {
    for (const [employeeId, state] of next) {
      if (state.domain === action.domain) next.delete(employeeId);
    }
    return next;
  }
  next.set(action.employeeId, {
    employeeId: action.employeeId,
    kind: action.kind,
    domain: action.domain,
    updatedAt: action.at ?? Date.now(),
    zoneId: action.zoneId ?? null,
    targetZoneId: action.targetZoneId ?? null,
    startupId: action.startupId ?? null,
  });
  return next;
}
