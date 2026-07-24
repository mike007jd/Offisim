import type { AgentRuntimeModelOption } from './usePiAgentModels.js';

export interface ComposerModelGroup {
  readonly laneKey: string;
  readonly account: string;
  readonly regularItems: readonly AgentRuntimeModelOption[];
  readonly freeItems: readonly AgentRuntimeModelOption[];
}

function isFreeComposerModel(option: AgentRuntimeModelOption): boolean {
  // Only an explicit `:free` suffix marks a free model; a paid model nearing
  // its expiration date must not sink into the collapsed free group.
  return option.selectionKind === 'api-model' && option.modelId.toLowerCase().endsWith(':free');
}

export function matchesComposerModelSearch(
  option: AgentRuntimeModelOption,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;
  return [option.name, option.modelId, option.accountName].some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  );
}

export function orderComposerModelGroups(
  groups: ReadonlyMap<
    string,
    { readonly account: string; readonly items: readonly AgentRuntimeModelOption[] }
  >,
  effectiveLaneKey: string | undefined,
  preserveSingleLane: boolean,
): readonly ComposerModelGroup[] {
  const ordered = [...groups].map(([laneKey, group], originalIndex) => {
    if (preserveSingleLane) {
      return {
        laneKey,
        account: group.account,
        regularItems: group.items,
        freeItems: [],
        originalIndex,
        rank: 0,
      };
    }

    const regularItems = group.items.filter((option) => !isFreeComposerModel(option));
    const freeItems = group.items.filter(isFreeComposerModel);
    const isOrchestrationLane = group.items.some(
      (option) => option.selectionKind === 'orchestration-engine',
    );
    const rank =
      laneKey === effectiveLaneKey ? 0 : isOrchestrationLane ? 1 : regularItems.length ? 2 : 3;
    return {
      laneKey,
      account: group.account,
      regularItems,
      freeItems,
      originalIndex,
      rank,
    };
  });

  if (!preserveSingleLane) {
    ordered.sort(
      (left, right) => left.rank - right.rank || left.originalIndex - right.originalIndex,
    );
  }

  return ordered.map(({ originalIndex: _originalIndex, rank: _rank, ...group }) => group);
}
