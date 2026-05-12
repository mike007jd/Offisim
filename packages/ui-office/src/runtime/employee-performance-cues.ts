import type { InteractionKind, ToolExecutionTelemetryPayload } from '@offisim/shared-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { truncate } from '../lib/format-time.js';
import { categorizeTool, type ToolCategory } from '../lib/tool-category.js';
import { useOffisimRuntime } from './offisim-runtime-context.js';

export type EmployeePerformanceCueCategory =
  | 'blocked'
  | 'waiting'
  | 'report'
  | 'tool'
  | 'dispatch'
  | 'handoff'
  | 'success'
  | 'ambient';

export type EmployeePerformanceCueKind =
  | 'dispatch'
  | 'tool.search'
  | 'tool.read'
  | 'tool.edit'
  | 'tool.shell'
  | 'tool.other'
  | 'waiting.approval'
  | 'waiting.plan'
  | 'waiting.question'
  | 'waiting.skill'
  | 'interaction.resolved'
  | 'handoff.outbound'
  | 'handoff.inbound'
  | 'handoff.completed'
  | 'reporting'
  | 'blocked'
  | 'failed'
  | 'success';

export interface EmployeePerformanceCueIntentPayload {
  readonly cueId: string;
  readonly employeeId: string;
  readonly kind: EmployeePerformanceCueKind;
  readonly category: EmployeePerformanceCueCategory;
  readonly text: string;
  readonly priority: number;
  readonly ttlMs: number;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly icon?: string;
}

export interface EmployeePerformanceClearIntentPayload {
  readonly employeeId?: string | null;
  readonly cueId?: string;
  readonly sourceType?: string;
  readonly sourceId?: string;
  readonly category?: EmployeePerformanceCueCategory;
  readonly all?: boolean;
}

export interface EmployeePerformanceCue extends EmployeePerformanceCueIntentPayload {
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly shortText: string;
}

export type EmployeePerformanceCueMap = ReadonlyMap<string, EmployeePerformanceCue>;

export const EMPLOYEE_CUE_TEXT_MAX = 60;
export const EMPTY_EMPLOYEE_PERFORMANCE_CUES: EmployeePerformanceCueMap = Object.freeze(
  new Map<string, EmployeePerformanceCue>(),
);

const PRIORITY = {
  blocked: 100,
  waiting: 90,
  report: 70,
  tool: 60,
  handoff: 50,
  dispatch: 45,
  success: 40,
  ambient: 10,
} as const satisfies Record<EmployeePerformanceCueCategory, number>;

const TTL = {
  blocked: 12_000,
  waiting: 45_000,
  report: 8_000,
  tool: 5_500,
  handoff: 7_000,
  dispatch: 6_000,
  success: 4_000,
  ambient: 3_000,
} as const satisfies Record<EmployeePerformanceCueCategory, number>;

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\b(?:sk|pk|rk|ghp|github_pat)_[A-Za-z0-9_]{12,}/g,
  /\b[A-Za-z0-9._%+-]+:[A-Za-z0-9._%+-]{12,}@/g,
  /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*['"]?[^'",\s]{8,}/gi,
];

export function sanitizeCueText(input: string, max = EMPLOYEE_CUE_TEXT_MAX): string {
  let out = input.replace(/```[\s\S]*?```/g, '[code redacted]').replace(/\s+/g, ' ').trim();
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, '[redacted]');
  }
  return truncate(out, max);
}

function cueId(parts: readonly (string | number | null | undefined)[]): string {
  return parts
    .filter((part): part is string | number => part !== null && part !== undefined && part !== '')
    .join(':');
}

function toolKind(category: ToolCategory): Extract<EmployeePerformanceCueKind, `tool.${string}`> {
  return `tool.${category}` as Extract<EmployeePerformanceCueKind, `tool.${string}`>;
}

function toolStartedText(category: ToolCategory): string {
  switch (category) {
    case 'search':
      return 'Searching project';
    case 'read':
      return 'Reading files';
    case 'edit':
      return 'Editing workspace';
    case 'shell':
      return 'Running shell';
    default:
      return 'Using tools';
  }
}

function toolCompletedText(category: ToolCategory): string {
  switch (category) {
    case 'search':
      return 'Search complete';
    case 'read':
      return 'Files reviewed';
    case 'edit':
      return 'Edits applied';
    case 'shell':
      return 'Shell complete';
    default:
      return 'Tool complete';
  }
}

export function buildTaskDispatchCue(input: {
  employeeId: string;
  stepLabel: string;
  stepIndex: number;
  totalSteps: number;
  sourceId: string;
}): EmployeePerformanceCueIntentPayload {
  return {
    cueId: cueId(['dispatch', input.sourceId, input.employeeId, input.stepIndex]),
    employeeId: input.employeeId,
    kind: 'dispatch',
    category: 'dispatch',
    text: sanitizeCueText(`Taking step ${input.stepIndex + 1}/${input.totalSteps}: ${input.stepLabel}`),
    priority: PRIORITY.dispatch,
    ttlMs: TTL.dispatch,
    sourceType: 'task.assignment.dispatched',
    sourceId: input.sourceId,
    icon: '->',
  };
}

export function buildToolCue(
  payload: ToolExecutionTelemetryPayload,
  sourceId: string,
): EmployeePerformanceCueIntentPayload | null {
  if (!payload.employeeId) return null;
  const category = categorizeTool(payload);
  const base = {
    employeeId: payload.employeeId,
    kind: toolKind(category),
    category: 'tool' as const,
    priority: PRIORITY.tool,
    sourceType: 'tool.execution.telemetry',
    sourceId,
  };
  if (payload.status === 'started') {
    return {
      ...base,
      cueId: cueId(['tool', payload.toolCallId, payload.employeeId, 'started']),
      text: toolStartedText(category),
      ttlMs: TTL.tool,
      icon: category === 'shell' ? '$' : category === 'edit' ? 'E' : category === 'read' ? 'R' : 'S',
    };
  }
  if (payload.status === 'completed') {
    return {
      ...base,
      cueId: cueId(['tool', payload.toolCallId, payload.employeeId, 'completed']),
      text: toolCompletedText(category),
      ttlMs: 2_500,
      priority: PRIORITY.success,
      category: 'success',
      kind: 'success',
      icon: 'OK',
    };
  }
  if (payload.status === 'denied') {
    return {
      ...base,
      cueId: cueId(['tool', payload.toolCallId, payload.employeeId, 'denied']),
      text: payload.errorType === 'TOOL_PERMISSION_REQUIRED' ? 'Waiting for approval' : 'Tool blocked',
      ttlMs: TTL.waiting,
      priority: PRIORITY.waiting,
      category: 'waiting',
      kind: 'waiting.approval',
      icon: '!',
    };
  }
  return {
    ...base,
    cueId: cueId(['tool', payload.toolCallId, payload.employeeId, 'error']),
    text: 'Tool step failed',
    ttlMs: TTL.blocked,
    priority: PRIORITY.blocked,
    category: 'blocked',
    kind: 'failed',
    icon: '!',
  };
}

export function buildInteractionWaitingCue(input: {
  kind: InteractionKind;
  employeeId: string;
  interactionId: string;
  restored: boolean;
}): EmployeePerformanceCueIntentPayload {
  const kindMap: Record<
    InteractionKind,
    { kind: EmployeePerformanceCueKind; text: string; icon: string }
  > = {
    permission_request: {
      kind: 'waiting.approval',
      text: input.restored ? 'Approval wait restored' : 'Waiting for approval',
      icon: '!',
    },
    plan_review: {
      kind: 'waiting.plan',
      text: input.restored ? 'Plan review restored' : 'Waiting for plan review',
      icon: '?',
    },
    agent_question: {
      kind: 'waiting.question',
      text: input.restored ? 'Question restored' : 'Needs clarification',
      icon: '?',
    },
    skill_install_confirm: {
      kind: 'waiting.skill',
      text: input.restored ? 'Skill approval restored' : 'Waiting for skill confirm',
      icon: '!',
    },
  };
  const mapped = kindMap[input.kind];
  return {
    cueId: cueId(['interaction', input.interactionId, input.employeeId, 'waiting']),
    employeeId: input.employeeId,
    kind: mapped.kind,
    category: 'waiting',
    text: mapped.text,
    priority: PRIORITY.waiting,
    ttlMs: TTL.waiting,
    sourceType: 'interaction',
    sourceId: input.interactionId,
    icon: mapped.icon,
  };
}

export function buildInteractionResolvedCue(input: {
  employeeId: string;
  interactionId: string;
}): EmployeePerformanceCueIntentPayload {
  return {
    cueId: cueId(['interaction', input.interactionId, input.employeeId, 'resolved']),
    employeeId: input.employeeId,
    kind: 'interaction.resolved',
    category: 'success',
    text: 'Decision received',
    priority: PRIORITY.success,
    ttlMs: 2_500,
    sourceType: 'interaction',
    sourceId: input.interactionId,
    icon: 'OK',
  };
}

export function buildHandoffCue(input: {
  employeeId: string;
  handoffId: string;
  direction: 'outbound' | 'inbound' | 'completed';
  reason?: string;
}): EmployeePerformanceCueIntentPayload {
  const completed = input.direction === 'completed';
  const text = completed
    ? 'Handoff received'
    : input.direction === 'outbound'
      ? `Handing off${input.reason ? `: ${input.reason}` : ''}`
      : `Receiving handoff${input.reason ? `: ${input.reason}` : ''}`;
  return {
    cueId: cueId(['handoff', input.handoffId, input.employeeId, input.direction]),
    employeeId: input.employeeId,
    kind: completed
      ? 'handoff.completed'
      : input.direction === 'outbound'
        ? 'handoff.outbound'
        : 'handoff.inbound',
    category: completed ? 'success' : 'handoff',
    text: sanitizeCueText(text),
    priority: completed ? PRIORITY.success : PRIORITY.handoff,
    ttlMs: completed ? 3_000 : TTL.handoff,
    sourceType: 'handoff',
    sourceId: input.handoffId,
    icon: completed ? 'OK' : '<>',
  };
}

export function buildEmployeeStateCue(input: {
  employeeId: string;
  next: string;
  sourceId: string;
}): EmployeePerformanceCueIntentPayload | null {
  if (input.next === 'blocked' || input.next === 'failed') {
    return {
      cueId: cueId(['state', input.sourceId, input.employeeId, input.next]),
      employeeId: input.employeeId,
      kind: input.next === 'failed' ? 'failed' : 'blocked',
      category: 'blocked',
      text: input.next === 'failed' ? 'Needs attention: failed' : 'Blocked: needs attention',
      priority: PRIORITY.blocked,
      ttlMs: TTL.blocked,
      sourceType: 'employee.state.changed',
      sourceId: input.sourceId,
      icon: '!',
    };
  }
  if (input.next === 'reporting') {
    return {
      cueId: cueId(['state', input.sourceId, input.employeeId, 'reporting']),
      employeeId: input.employeeId,
      kind: 'reporting',
      category: 'report',
      text: 'Reporting progress',
      priority: PRIORITY.report,
      ttlMs: TTL.report,
      sourceType: 'employee.state.changed',
      sourceId: input.sourceId,
      icon: 'R',
    };
  }
  if (input.next === 'success') {
    return {
      cueId: cueId(['state', input.sourceId, input.employeeId, 'success']),
      employeeId: input.employeeId,
      kind: 'success',
      category: 'success',
      text: 'Work complete',
      priority: PRIORITY.success,
      ttlMs: TTL.success,
      sourceType: 'employee.state.changed',
      sourceId: input.sourceId,
      icon: 'OK',
    };
  }
  return null;
}

export function buildReportingStreamCue(input: {
  employeeId: string;
  streamKey: string;
  text: string;
}): EmployeePerformanceCueIntentPayload {
  return {
    cueId: cueId(['reporting-stream', input.streamKey, input.employeeId]),
    employeeId: input.employeeId,
    kind: 'reporting',
    category: 'report',
    text: sanitizeCueText(input.text, 50),
    priority: PRIORITY.report,
    ttlMs: TTL.report,
    sourceType: 'llm.stream.chunk',
    sourceId: input.streamKey,
    icon: 'R',
  };
}

function materializeCue(
  payload: EmployeePerformanceCueIntentPayload,
  timestamp: number,
): EmployeePerformanceCue {
  return {
    ...payload,
    text: sanitizeCueText(payload.text),
    shortText: sanitizeCueText(payload.text, 34),
    createdAt: timestamp,
    expiresAt: timestamp + payload.ttlMs,
  };
}

function selectPrimaryCue(
  cues: Iterable<EmployeePerformanceCue>,
  now: number,
): EmployeePerformanceCue | null {
  let best: EmployeePerformanceCue | null = null;
  for (const cue of cues) {
    if (cue.expiresAt <= now) continue;
    if (!best || cue.priority > best.priority || (cue.priority === best.priority && cue.createdAt > best.createdAt)) {
      best = cue;
    }
  }
  return best;
}

export function useEmployeePerformanceCues(companyId: string | null): EmployeePerformanceCueMap {
  const { sceneIntentBus } = useOffisimRuntime();
  const [store, setStore] = useState<Map<string, Map<string, EmployeePerformanceCue>>>(() => new Map());
  const nowRef = useRef(Date.now());

  useEffect(() => {
    setStore(new Map());
  }, [companyId]);

  useEffect(() => {
    if (!companyId || !sceneIntentBus) return;

    const upsert = sceneIntentBus.on('scene.employee.performance.cue', (intent) => {
      const cue = materializeCue(
        intent.payload as EmployeePerformanceCueIntentPayload,
        intent.timestamp,
      );
      setStore((prev) => {
        const next = new Map(prev);
        const byEmployee = new Map(next.get(cue.employeeId) ?? []);
        byEmployee.set(cue.cueId, cue);
        next.set(cue.employeeId, byEmployee);
        return next;
      });
    });

    const clear = sceneIntentBus.on('scene.employee.performance.clear', (intent) => {
      const payload = intent.payload as EmployeePerformanceClearIntentPayload;
      setStore((prev) => {
        if (payload.all) return new Map();
        if (payload.employeeId) {
          const existing = prev.get(payload.employeeId);
          if (!existing) return prev;
          const byEmployee = new Map(existing);
          for (const [id, cue] of byEmployee) {
            if (
              (payload.cueId && id === payload.cueId) ||
              (payload.sourceType && cue.sourceType === payload.sourceType && (!payload.sourceId || cue.sourceId === payload.sourceId)) ||
              (payload.category && cue.category === payload.category)
            ) {
              byEmployee.delete(id);
            }
          }
          const next = new Map(prev);
          if (byEmployee.size === 0) next.delete(payload.employeeId);
          else next.set(payload.employeeId, byEmployee);
          return next;
        }
        const next = new Map(prev);
        for (const [employeeId, cues] of next) {
          const byEmployee = new Map(cues);
          for (const [id, cue] of byEmployee) {
            if (
              (payload.sourceType && cue.sourceType === payload.sourceType && (!payload.sourceId || cue.sourceId === payload.sourceId)) ||
              (payload.category && cue.category === payload.category)
            ) {
              byEmployee.delete(id);
            }
          }
          if (byEmployee.size === 0) next.delete(employeeId);
          else next.set(employeeId, byEmployee);
        }
        return next;
      });
    });

    return () => {
      clear();
      upsert();
    };
  }, [companyId, sceneIntentBus]);

  useEffect(() => {
    if (!companyId || typeof window === 'undefined') return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      nowRef.current = now;
      setStore((prev) => {
        let changed = false;
        const next = new Map<string, Map<string, EmployeePerformanceCue>>();
        for (const [employeeId, cues] of prev) {
          const active = new Map<string, EmployeePerformanceCue>();
          for (const [cueId, cue] of cues) {
            if (cue.expiresAt > now) active.set(cueId, cue);
            else changed = true;
          }
          if (active.size > 0) next.set(employeeId, active);
        }
        return changed ? next : prev;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [companyId]);

  return useMemo(() => {
    const selected = new Map<string, EmployeePerformanceCue>();
    const now = nowRef.current;
    for (const [employeeId, cues] of store) {
      const primary = selectPrimaryCue(cues.values(), now);
      if (primary) selected.set(employeeId, primary);
    }
    return selected;
  }, [store]);
}
