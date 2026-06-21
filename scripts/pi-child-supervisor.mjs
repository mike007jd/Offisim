// ChildAgentSupervisor — builds, runs, and re-stamps delegated child agents.
//
// Per Docs/DELEGATION_ARCHITECTURE.md, children run IN-PROCESS: the supervisor
// calls createAgentSession again inside the same Node host (live-proven by
// scripts/pi-delegation-smoke.mjs), reusing the host's auth/model registries and
// permission machinery. Rust owns only the root host process; aborting the root
// tears down the host and every child with it.
//
// The supervisor's only outward surface is the neutral `agentRun` wire line
// (scope fields + runType + opaque payload) — no Pi-specific vocabulary leaks to
// the renderer. The delegate tool (pi-delegation-extension.mjs) is its caller.

import { randomUUID } from 'node:crypto';
import { DefaultResourceLoader, SessionManager, createAgentSession } from '@earendil-works/pi-coding-agent';
import { agentRunLine } from './pi-agent-host-wire.mjs';

// Capability band → child tool allowlist. `write` returns undefined so Pi enables
// its full default tool set; the others are restrictive subsets.
const ACCESS_TOOLS = {
  read: ['read', 'grep', 'find', 'ls'],
  review: ['read', 'grep', 'find', 'ls', 'bash'],
  write: undefined,
};

// Per-child model-visible output cap (mirrors the official subagent example). A
// child that floods its summary back to the root would blow the root's context;
// truncation is byte-aware and always announced (never a silent cap).
const PER_CHILD_OUTPUT_CAP = 50 * 1024;

function normalizeAccess(access) {
  return access === 'write' || access === 'review' ? access : 'read';
}

function capChildOutput(text) {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= PER_CHILD_OUTPUT_CAP) return text;
  let truncated = text.slice(0, PER_CHILD_OUTPUT_CAP);
  while (Buffer.byteLength(truncated, 'utf8') > PER_CHILD_OUTPUT_CAP) {
    truncated = truncated.slice(0, -1);
  }
  const dropped = bytes - Buffer.byteLength(truncated, 'utf8');
  return `${truncated}\n\n[Output truncated: ${dropped} bytes omitted (per-child ${PER_CHILD_OUTPUT_CAP / 1024} KB cap).]`;
}

/**
 * @param {object} ctx
 * @param {(line: unknown) => void} ctx.emit            host stdout JSONL emitter
 * @param {string|undefined} ctx.agentDir
 * @param {object} ctx.authStorage                       shared (read-only)
 * @param {object} ctx.modelRegistry                     shared (read-only)
 * @param {string} ctx.cwd
 * @param {object} ctx.settingsManager                   shared SettingsManager
 * @param {string} ctx.threadId
 * @param {string} ctx.rootRunId
 * @param {Array<{employeeId:string,name?:string,roleSlug?:string,persona?:string,model?:string}>} ctx.roster
 * @param {(modelId?: string) => object|undefined} ctx.resolveModel
 * @param {(mode: string) => ((pi: unknown) => void)|null} ctx.buildPermissionGate
 */
export function createChildSupervisor(ctx) {
  const roster = Array.isArray(ctx.roster) ? ctx.roster : [];
  const rosterById = new Map(roster.map((entry) => [entry.employeeId, entry]));

  function emitRun(runId, employeeId, runType, payload) {
    ctx.emit(
      agentRunLine({
        threadId: ctx.threadId,
        rootRunId: ctx.rootRunId,
        runId,
        // maxDepth=1 in Phase 1: every child hangs directly off the root run.
        parentRunId: ctx.rootRunId,
        employeeId,
        relation: 'delegate',
        runType,
        payload,
      }),
    );
  }

  async function runSingle(task, signal) {
    const runId = `run-${randomUUID()}`;
    const access = normalizeAccess(task.access);
    const objective = typeof task.objective === 'string' ? task.objective.trim() : '';
    const employee = rosterById.get(task.employeeId);

    if (!employee) {
      const available = roster.map((entry) => entry.employeeId).join(', ') || 'none';
      const summary = `Unknown teammate "${task.employeeId}". Available: ${available}.`;
      emitRun(runId, task.employeeId, 'run.failed', { status: 'failed', summary });
      return `Delegation failed: ${summary}`;
    }
    if (!objective) {
      const summary = 'Delegation needs a non-empty objective.';
      emitRun(runId, employee.employeeId, 'run.failed', { status: 'failed', summary });
      return summary;
    }

    emitRun(runId, employee.employeeId, 'run.started', { objective, access });

    const tools = ACCESS_TOOLS[access];
    const persona =
      typeof employee.persona === 'string' && employee.persona.trim()
        ? employee.persona.trim()
        : undefined;
    const model = ctx.resolveModel(employee.model);

    // Children always run under the Auto gate: it's a no-op for read access (no
    // bash tool) and blocks catastrophic bash for review/write — without needing
    // a UI binding the headless child can't satisfy. Ask-mode prompting stays a
    // root-only capability in Phase 1.
    const gateFactory = ctx.buildPermissionGate ? ctx.buildPermissionGate('auto') : null;
    const extensionFactories = gateFactory ? [gateFactory] : [];
    const resourceLoader = new DefaultResourceLoader({
      cwd: ctx.cwd,
      agentDir: ctx.agentDir,
      settingsManager: ctx.settingsManager,
      ...(extensionFactories.length > 0 ? { extensionFactories } : {}),
      ...(persona ? { appendSystemPrompt: [persona] } : {}),
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: ctx.cwd,
      agentDir: ctx.agentDir,
      authStorage: ctx.authStorage,
      modelRegistry: ctx.modelRegistry,
      sessionManager: SessionManager.inMemory(ctx.cwd),
      ...(model ? { model } : {}),
      ...(tools ? { tools } : {}),
      resourceLoader,
    });

    const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
    const unsubscribe = session.subscribe((event) => {
      if (event.type === 'tool_execution_start') {
        emitRun(runId, employee.employeeId, 'tool.started', {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: 'started',
        });
        return;
      }
      if (event.type === 'tool_execution_end') {
        emitRun(runId, employee.employeeId, 'tool.completed', {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          status: event.isError ? 'failed' : 'completed',
        });
        return;
      }
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        const u = event.message.usage;
        if (u) {
          usage.input += u.input || 0;
          usage.output += u.output || 0;
          usage.cacheRead += u.cacheRead || 0;
          usage.cacheWrite += u.cacheWrite || 0;
          usage.cost += u.cost?.total || 0;
          usage.turns += 1;
        }
      }
    });

    let aborted = false;
    const onAbort = () => {
      aborted = true;
      void session.abort();
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      await session.prompt(objective);
      const summary = capChildOutput((session.getLastAssistantText() || '').trim() || '(no output)');
      if (aborted) {
        emitRun(runId, employee.employeeId, 'run.cancelled', { status: 'cancelled', summary, usage });
        return `Delegation cancelled: ${summary}`;
      }
      emitRun(runId, employee.employeeId, 'run.completed', { status: 'completed', summary, usage });
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = aborted ? 'cancelled' : 'failed';
      emitRun(runId, employee.employeeId, aborted ? 'run.cancelled' : 'run.failed', {
        status,
        summary: message,
        usage,
      });
      return `Delegation ${status}: ${message}`;
    } finally {
      unsubscribe();
      session.dispose();
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  return { runSingle, roster };
}
