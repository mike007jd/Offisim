// Collaboration runtime transport — the ONLY place the collaboration controller
// touches the Pi host (PR-03). It invokes the dedicated `agent_runtime_collaborate`
// Tauri command (NOT `agent_runtime_execute`), so a collaboration reply can never
// take the work path: no project bind, no agent_runs / mission persistence, no
// Office dramaturgy projection. The host enforces zero tools / no workspace; this
// transport only streams the reply deltas and returns the final text + usage.
//
// Shaped as an injectable interface so the turn controller is testable with a fake
// transport (no live model) and the production transport is the only Tauri-bound
// piece.

import { invokeCommand } from '@/lib/tauri-commands.js';
import type {
  AgentRunUsage,
  AiExecutionTarget,
  AiModelCatalogEntry,
  AiRuntimeStatus,
  CollaborationProfile,
  TurnExecutionProvenance,
} from '@offisim/shared-types';
import { Channel } from '@tauri-apps/api/core';
import {
  isSameModelSource,
  requireTurnExecutionProvenance,
  validateExecutionTarget,
} from '../execution-provenance.js';
import type { PiAgentHostEvent, PiAgentHostResponse } from '../pi-runtime-driver.js';

export interface CollaborationExecutionSelection {
  target: AiExecutionTarget;
  runtimeModelRef: string;
}

function sameExecutionTarget(a: AiExecutionTarget, b: AiExecutionTarget): boolean {
  return (
    a.engineId === b.engineId &&
    a.accountId === b.accountId &&
    a.billingMode === b.billingMode &&
    a.modelId === b.modelId &&
    isSameModelSource(a.modelSource, b.modelSource)
  );
}

function isRunnableApiModel(status: AiRuntimeStatus, model: AiModelCatalogEntry): boolean {
  const account = status.accounts.find(
    (candidate) => candidate.engineId === model.engineId && candidate.accountId === model.accountId,
  );
  const expiry = model.expiresAt ? Date.parse(model.expiresAt) : Number.NaN;
  return Boolean(
    model.engineId === 'api' &&
      model.billingMode === 'api' &&
      model.runtimeModelRef.trim() &&
      model.modelId.trim() &&
      (model.availability === 'available' ||
        (model.availability === 'expiring' && Number.isFinite(expiry) && expiry > Date.now())) &&
      account?.engineId === 'api' &&
      account.billingMode === 'api' &&
      account.status === 'available' &&
      account.capabilities.execute.status === 'available' &&
      account.capabilities.models.status === 'available',
  );
}

/** Pure selection over the safe `agent_runtime_status` projection. */
export function selectCollaborationExecutionTarget(
  statusValue: unknown,
  requestedModel?: string,
  frozenTarget?: AiExecutionTarget,
): CollaborationExecutionSelection {
  const status = statusValue as Partial<AiRuntimeStatus>;
  if (!Array.isArray(status.accounts) || !Array.isArray(status.models)) {
    throw new Error('AI Accounts status is unavailable for collaboration.');
  }
  const runtimeStatus: AiRuntimeStatus = {
    accounts: status.accounts,
    models: status.models,
    orchestrationEngines: Array.isArray(status.orchestrationEngines)
      ? status.orchestrationEngines
      : [],
    checkedAt: typeof status.checkedAt === 'string' ? status.checkedAt : '',
  };
  const candidates = runtimeStatus.models.filter((model) =>
    isRunnableApiModel(runtimeStatus, model),
  );
  const requested = requestedModel?.trim();

  if (frozenTarget) {
    const target = validateExecutionTarget(frozenTarget);
    if (!target || target.engineId !== 'api' || target.billingMode !== 'api') {
      throw new Error('The collaboration turn has an invalid saved API execution target.');
    }
    const matches = candidates.filter(
      (model) =>
        model.engineId === target.engineId &&
        model.accountId === target.accountId &&
        model.billingMode === target.billingMode &&
        model.modelId === target.modelId &&
        (!requested || requested === model.runtimeModelRef || requested === model.modelId),
    );
    if (matches.length !== 1) {
      throw new Error("The collaboration turn's saved API account or exact model is unavailable.");
    }
    const [selected] = matches;
    if (!selected) throw new Error('The saved collaboration model could not be resolved.');
    return { target, runtimeModelRef: selected.runtimeModelRef };
  }

  let selected: AiModelCatalogEntry | undefined;
  if (requested) {
    const matches = candidates.filter(
      (model) => model.runtimeModelRef === requested || model.modelId === requested,
    );
    if (matches.length !== 1) {
      throw new Error(
        `The selected collaboration model is unavailable or ambiguous: ${requested}.`,
      );
    }
    [selected] = matches;
  } else {
    selected = candidates.find((model) => model.availability === 'available');
  }
  if (!selected) {
    throw new Error('No verified stable API model is available for collaboration.');
  }
  const target = validateExecutionTarget({
    engineId: selected.engineId,
    accountId: selected.accountId,
    billingMode: selected.billingMode,
    modelId: selected.modelId,
    modelSource: selected.source,
  });
  if (!target) throw new Error('The collaboration model has invalid execution provenance.');
  return { target, runtimeModelRef: selected.runtimeModelRef };
}

/** A single collaboration speaker turn the transport runs against the host. */
export interface CollaborationTurnRequest {
  /** Stable per-turn request id; also the abort handle and the turn's runtimeRequestId. */
  requestId: string;
  companyId: string;
  /** The Collaboration thread id (company-scoped daily chat) — never a project id. */
  collaborationThreadId: string;
  employeeId: string | null;
  /** The boss/user message (or round anchor) this speaker is replying to. */
  text: string;
  /** Persona + context packet, forwarded as the session's appendSystemPrompt. */
  systemPromptAppend?: string;
  model?: string;
  expectedTarget: AiExecutionTarget;
  runtimeModelRef: string;
  thinkingLevel?: string;
  collaborationProfile?: CollaborationProfile;
  mcpTools?: unknown[];
}

export interface CollaborationTurnResult {
  text: string;
  reasoning?: string;
  usage?: AgentRunUsage;
  provenance: TurnExecutionProvenance;
}

export interface CollaborationTransportRunOptions {
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
  /** Re-read the exact turn target/request from durable storage before ACK. */
  verifyDurableTarget(identity: TurnExecutionProvenance): Promise<void>;
}

/**
 * Drives ONE speaker turn. `onDelta` streams content deltas for a live preview;
 * `signal` aborts the in-flight host run (mapping to `agent_runtime_abort` with
 * the same request id, exactly like the enhance transport).
 */
export interface CollaborationTransport {
  resolveExecutionSelection(input: {
    model?: string;
    frozenTarget?: AiExecutionTarget;
  }): Promise<CollaborationExecutionSelection>;
  run(
    req: CollaborationTurnRequest,
    opts: CollaborationTransportRunOptions,
  ): Promise<CollaborationTurnResult>;
}

export interface TauriCollaborationTransportOptions {
  onAgentRun?: (event: Extract<PiAgentHostEvent, { kind: 'agentRun' }>) => void;
}

/** The production transport: invokes the isolated `agent_runtime_collaborate`
 *  gateway command and consumes the streaming Channel. */
export function createTauriCollaborationTransport(
  transportOptions: TauriCollaborationTransportOptions = {},
): CollaborationTransport {
  return {
    async resolveExecutionSelection(input) {
      const status = await invokeCommand('agent_runtime_status', { includeUsage: false });
      return selectCollaborationExecutionTarget(status, input.model, input.frozenTarget);
    },
    async run(req, opts) {
      const verifiedSelection = selectCollaborationExecutionTarget(
        await invokeCommand('agent_runtime_status', { includeUsage: false }),
        req.runtimeModelRef,
        req.expectedTarget,
      );
      if (
        verifiedSelection.runtimeModelRef !== req.runtimeModelRef ||
        !sameExecutionTarget(verifiedSelection.target, req.expectedTarget)
      ) {
        throw new Error('The collaboration execution selection changed before invocation.');
      }

      const abortHost = () => {
        void invokeCommand('agent_runtime_abort', { requestId: req.requestId }).catch(
          () => undefined,
        );
      };
      const onEvent = new Channel<PiAgentHostEvent>();
      let streamed = '';
      let reasoning = '';
      let preparation: Promise<void> | null = null;
      let preparationError: Error | null = null;
      let preparedAdapterId = '';
      let preparedAdapterVersion = '';
      const failPreparation = (error: unknown) => {
        preparationError = error instanceof Error ? error : new Error(String(error));
        abortHost();
      };
      onEvent.onmessage = (event) => {
        if (event.kind === 'executionPrepared') {
          if (preparation) {
            failPreparation(
              new Error('Agent runtime prepared the same collaboration request twice.'),
            );
            return;
          }
          try {
            if (!event.prepareId.trim() || !event.targetDigest.trim()) {
              throw new Error('Agent runtime returned an invalid execution preparation receipt.');
            }
            const identity = requireTurnExecutionProvenance(event.identity, req.requestId);
            if (!sameExecutionTarget(identity, req.expectedTarget)) {
              throw new Error('Agent runtime prepared a different collaboration execution target.');
            }
            if (
              !identity.adapter?.id ||
              !identity.adapter.version ||
              identity.adapter.id !== event.adapter.id ||
              identity.adapter.version !== event.adapter.version
            ) {
              throw new Error('Agent runtime returned inconsistent adapter diagnostics.');
            }
            preparedAdapterId = identity.adapter.id;
            preparedAdapterVersion = identity.adapter.version;
            preparation = (async () => {
              await opts.verifyDurableTarget(identity);
              if (opts.signal?.aborted) throw new Error('Collaboration execution was stopped.');
              await invokeCommand('agent_runtime_confirm_execution', {
                requestId: req.requestId,
                prepareId: event.prepareId,
                targetDigest: event.targetDigest,
              });
            })();
            void preparation.catch(failPreparation);
          } catch (error) {
            preparation = Promise.reject(error);
            void preparation.catch(failPreparation);
          }
        } else if (event.kind === 'messageDelta' && event.delta) {
          if (!preparation || preparationError) {
            failPreparation(
              new Error('Agent runtime streamed collaboration output before target confirmation.'),
            );
            return;
          }
          if (event.channel === 'reasoning') {
            reasoning += event.delta;
          } else {
            streamed += event.delta;
            opts?.onDelta?.(event.delta);
          }
        } else if (event.kind === 'agentRun') {
          transportOptions.onAgentRun?.(event);
        }
      };

      const onAbort = abortHost;
      const signal = opts?.signal;
      if (signal) {
        if (signal.aborted) {
          onAbort();
          throw new Error('Collaboration execution was stopped.');
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      try {
        const response = (await invokeCommand('agent_runtime_collaborate', {
          req: {
            requestId: req.requestId,
            // The frozen capability enum the host routes on. Always 'collaboration'
            // from this transport — the host has its own `mode:'collaborate'`
            // dispatch, but forwarding the enum keeps the wire contract explicit.
            capabilityProfile: 'collaboration',
            text: req.text,
            companyId: req.companyId,
            collaborationThreadId: req.collaborationThreadId,
            employeeId: req.employeeId,
            model: req.runtimeModelRef,
            expectedTarget: req.expectedTarget,
            runtimeModelRef: req.runtimeModelRef,
            thinkingLevel: req.thinkingLevel?.trim() || undefined,
            collaborationProfile: req.collaborationProfile,
            mcpTools: req.mcpTools,
            systemPromptAppend: req.systemPromptAppend?.trim() || undefined,
          },
          onEvent,
        })) as PiAgentHostResponse;
        if (!preparation) {
          onAbort();
          throw new Error('Agent runtime did not prepare the collaboration execution target.');
        }
        await preparation;
        if (preparationError) throw preparationError;
        const provenance = requireTurnExecutionProvenance(response.provenance, req.requestId);
        if (!sameExecutionTarget(provenance, req.expectedTarget)) {
          throw new Error('Agent runtime returned a different collaboration execution target.');
        }
        if (
          !preparedAdapterId ||
          !preparedAdapterVersion ||
          !provenance.adapter ||
          provenance.adapter.id !== preparedAdapterId ||
          provenance.adapter.version !== preparedAdapterVersion
        ) {
          throw new Error('Agent runtime adapter identity changed after execution confirmation.');
        }
        const text = response.text || streamed;
        const finalReasoning = (response.reasoning || reasoning).trim();
        return {
          text,
          ...(finalReasoning ? { reasoning: finalReasoning } : {}),
          ...(response.usage ? { usage: response.usage } : {}),
          provenance,
        };
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    },
  };
}
