import type { AiExecutionTarget } from '@offisim/shared-types';
import { validateExecutionTarget } from './execution-provenance.js';

export interface DurableThreadRootRun {
  run_id: string;
  company_id: string;
  parent_run_id: string | null;
  runtime_context_json: string | null;
  started_at: string;
}

export interface DurableThreadExecutionAuthority {
  readonly target: AiExecutionTarget;
  /** Exact native/catalog selector. Two presets may intentionally share one leaf model id. */
  readonly runtimeModelRef: string;
}

function durableExecutionAuthority(
  raw: string | null,
): DurableThreadExecutionAuthority | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { executionTarget?: unknown; model?: unknown };
    const target = validateExecutionTarget(parsed.executionTarget) ?? undefined;
    const runtimeModelRef = typeof parsed.model === 'string' ? parsed.model.trim() : '';
    return target && runtimeModelRef ? { target, runtimeModelRef } : undefined;
  } catch {
    return undefined;
  }
}

function startedAtMillis(row: DurableThreadRootRun): number {
  const value = Date.parse(row.started_at);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

/**
 * Recover the newest usable engine/account/model binding from durable root runs.
 * A just-created root may not have a runtime context yet, so malformed or empty
 * rows are skipped until the latest valid target is found.
 */
export function resolveAuthoritativeThreadExecutionAuthority(
  rows: readonly DurableThreadRootRun[],
  companyId: string,
): DurableThreadExecutionAuthority | undefined {
  return [...rows]
    .filter((row) => row.company_id === companyId && row.parent_run_id === null)
    .sort((left, right) => {
      const timeOrder = startedAtMillis(right) - startedAtMillis(left);
      return timeOrder || right.run_id.localeCompare(left.run_id);
    })
    .map((row) => durableExecutionAuthority(row.runtime_context_json))
    .find((authority): authority is DurableThreadExecutionAuthority => Boolean(authority));
}

export interface ThreadExecutionSelectionPlan {
  requestedModel: string | undefined;
  frozenAuthority: DurableThreadExecutionAuthority | undefined;
  authoritativeAuthority: DurableThreadExecutionAuthority | undefined;
  requiresCatalog: boolean;
}

/**
 * No explicit model means continue the prior exact leaf. An explicit selector
 * is resolved from the live catalog, then checked against the prior lane.
 */
export function planThreadExecutionSelection(
  authoritativeAuthority: DurableThreadExecutionAuthority | undefined,
  requestedModel: string | undefined,
  initialAuthority: DurableThreadExecutionAuthority | undefined,
): ThreadExecutionSelectionPlan {
  if (!authoritativeAuthority) {
    return {
      requestedModel,
      frozenAuthority: initialAuthority,
      authoritativeAuthority: undefined,
      requiresCatalog: true,
    };
  }
  return requestedModel
    ? {
        requestedModel,
        frozenAuthority: undefined,
        authoritativeAuthority,
        requiresCatalog: true,
      }
    : {
        requestedModel: undefined,
        frozenAuthority: authoritativeAuthority,
        authoritativeAuthority,
        requiresCatalog: false,
      };
}

/** A later Turn may change only the exact model leaf inside its durable lane. */
export function assertThreadExecutionLane(
  authoritative: AiExecutionTarget,
  candidate: AiExecutionTarget,
): void {
  if (
    authoritative.engineId !== candidate.engineId ||
    authoritative.accountId !== candidate.accountId ||
    authoritative.billingMode !== candidate.billingMode
  ) {
    throw new Error(
      'A task cannot switch AI engine, account, or billing lane after execution begins.',
    );
  }
}
