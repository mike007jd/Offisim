import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  isToolCallEventType,
} from '@earendil-works/pi-coding-agent';
import stripJsonComments from 'strip-json-comments';
import { Type } from 'typebox';
import { createLspDiagnosticsExtensionFactory } from '../apps/desktop/src-tauri/src/pi_agent_host/lsp_diagnostics_extension.mjs';
import {
  createWorkspaceCheckpointManager,
  createWorkspaceLeaseManager,
} from '../packages/core/dist/browser.js';
import { resolveApiRunUsage } from './agent-run-usage.mjs';
import { projectApiAccountCatalog } from './ai-account-catalog.mjs';
import {
  agentRunLine,
  decodePiRequestPayload,
  errorLine,
  executionPreparedLine,
  lifecycleLine,
  messageDeltaLine,
  messageEndLine,
  readyLine,
  resultLine,
  startedLine,
  toolLine,
  uiRequestLine,
} from './pi-agent-host-wire.mjs';
import {
  COLLABORATION_FORBIDDEN_TOOLS,
  collaborationToolAllowlist,
  evaluateAskBashCommand,
  evaluateAutoBashCommand,
  normalizeCollaborationProfile,
  normalizePermissionMode,
  toolAllowlistForMode,
} from './pi-agent-permission-modes.mts';
import {
  DELEGATION_DEFAULTS,
  createChildSupervisor,
  createDelegationLimits,
} from './pi-child-supervisor.mjs';
import { createDelegationExtensionFactory } from './pi-delegation-extension.mjs';
import {
  assertSameExecutionAccount,
  createExecutionTargetGate,
  executionAccountIdentity,
} from './pi-execution-provenance.mjs';
import { createMcpCallChannel } from './pi-host-mcp-channel.mjs';
import { createVerifyCallChannel } from './pi-host-verify-channel.mjs';
import { createWorktreeCallChannel } from './pi-host-worktree-channel.mjs';
import { createMcpBridgeExtensionFactory, isWriteMcpTool } from './pi-mcp-bridge-extension.mjs';
import { createMissionBridgeExtensionFactory } from './pi-mission-bridge-extension.mjs';
import { createPublishArtifactExtensionFactory } from './pi-publish-artifact-extension.mjs';
import {
  createTaskBashProcessRegistry,
  createTaskScopedAgentSessionFactory,
} from './pi-task-bash-process-registry.mjs';

/**
 * Pi thinking levels (reasoning effort), least → most. The renderer already
 * constrains its picker to this closed set; the host re-validates request input
 * before it reaches the SDK so an unknown string degrades to `undefined` (Pi
 * falls back to its own default) rather than being silently clamped to `off`. A
 * valid-but-unsupported level is left for Pi to clamp to the model's nearest
 * capability inside `createAgentSession`.
 */
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const MCP_APPROVAL_TIMEOUT_MS = 75_000;
const ROOT_CONTROL_CUSTOM_TYPE = 'offisim.control';
const DELEGATION_LIMIT_KEYS = Object.freeze([
  'maxDepth',
  'maxParallelPerDelegation',
  'maxTotalChildren',
  'maxTotalTokens',
]);
const PROJECT_WORKSPACE_REQUIRED_TOOL = 'project_workspace_required';
const ProjectWorkspaceRequiredParams = Type.Object({});

function normalizeExecuteWorkspace(payload) {
  const requirement = payload.workspaceRequirement;
  const availability = payload.workspaceAvailability;
  const reasonCode = payload.workspaceUnavailableReasonCode;
  if (requirement !== 'required' && requirement !== 'optional') {
    throw Object.assign(new Error('Pi work requests require a valid workspaceRequirement.'), {
      code: 'invalid-request',
    });
  }
  if (availability !== 'bound' && availability !== 'unavailable') {
    throw Object.assign(new Error('Pi work requests require a valid workspaceAvailability.'), {
      code: 'invalid-request',
    });
  }
  if (availability === 'bound') {
    if (reasonCode !== null) {
      throw Object.assign(
        new Error('A bound Pi work request cannot carry a workspace-unavailable reason.'),
        { code: 'invalid-request' },
      );
    }
    return { requirement, availability };
  }
  if (requirement !== 'optional') {
    throw Object.assign(
      new Error('A required Pi work request cannot run without a Project workspace.'),
      { code: 'project-workspace-required' },
    );
  }
  if (reasonCode !== 'none' && reasonCode !== 'ambiguous') {
    throw Object.assign(
      new Error('A workspace-unavailable Pi work request requires reason none or ambiguous.'),
      { code: 'invalid-request' },
    );
  }
  return { requirement, availability, reasonCode };
}

function workspaceUnavailableSystemPrompt(reasonCode) {
  return [
    'This Offisim turn has no authorized Project workspace.',
    `Workspace recovery result: ${reasonCode}.`,
    'You have no file, shell, Git, delegation, mission, skill, or MCP access in this turn.',
    'Answer normally when the request can be handled from conversation context alone.',
    `When the request truly requires any unavailable capability, call ${PROJECT_WORKSPACE_REQUIRED_TOOL} exactly once, then clearly tell the user to restore or reselect the Project folder.`,
    'Never claim that you inspected, changed, ran, or verified project files in this state.',
  ].join('\n');
}

function createProjectWorkspaceRequiredExtensionFactory(reasonCode) {
  return (pi) => {
    pi.registerTool({
      name: PROJECT_WORKSPACE_REQUIRED_TOOL,
      label: 'Project Workspace Required',
      description:
        'Use only when the user request truly requires project files, shell, Git, delegation, mission, skills, or MCP access and the Project workspace is unavailable.',
      parameters: ProjectWorkspaceRequiredParams,
      async execute() {
        return {
          content: [
            {
              type: 'text',
              text: `PROJECT_WORKSPACE_REQUIRED reason=${reasonCode}. No Project folder is authorized for this turn. Ask the user to restore or reselect the Project folder; do not claim project work was completed.`,
            },
          ],
        };
      },
    });
  };
}

function assertWorkspaceToolAllowed(workspaceUnavailable, toolName) {
  if (workspaceUnavailable && toolName !== PROJECT_WORKSPACE_REQUIRED_TOOL) {
    throw Object.assign(
      new Error(`Workspace-unavailable work must not execute tool "${toolName}".`),
      { code: 'workspace-isolation' },
    );
  }
}

/**
 * Accept a delegation-limit override only when the whole packet is a known,
 * positive-safe-integer shape. One bad/unknown field discards the whole packet,
 * restoring host defaults; valid values can only tighten those defaults.
 */
function normalizeDelegationLimitOverrides(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const keys = Object.keys(value);
  if (keys.some((key) => !DELEGATION_LIMIT_KEYS.includes(key))) return undefined;

  const overrides = {};
  for (const key of keys) {
    const requested = value[key];
    if (!Number.isSafeInteger(requested) || requested <= 0) return undefined;
    overrides[key] = Math.min(requested, DELEGATION_DEFAULTS[key]);
  }
  return overrides;
}

function normalizeThinkingLevel(value) {
  return typeof value === 'string' && THINKING_LEVELS.includes(value) ? value : undefined;
}

function normalizePromptImages(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((image) => {
    const data = asNonEmptyString(image?.data);
    const mimeType = asNonEmptyString(image?.mimeType)?.toLowerCase();
    if (!data || !mimeType || !/^image\/(png|jpe?g|gif|webp)$/.test(mimeType)) return [];
    return [{ type: 'image', data, mimeType }];
  });
}

// Ask mode pauses a tool call and asks the user through Pi's extension UI
// (`ctx.ui.confirm`). Pi's TUI would render that dialog itself; the host is
// headless, so we inject a custom `uiContext` (via `session.bindExtensions`) that
// forwards every blocking prompt to the renderer as a `uiRequest` line and parks
// the promise until a matching `uiResponse` line lands on stdin. The request id is
// minted by the uiContext (not the tool-call id), so any Pi UI primitive —
// confirm / select / input / editor — routes the same way. Mirrors Pi RPC's
// `extension_ui_request` / `extension_ui_response` while staying on
// `createAgentSession` (no persistent RPC sidecar).
let uiRequestSeq = 0;
const pendingUiRequests = new Map(); // request id -> settle(responseObject)

function requestUiResponse(method, fields, opts) {
  uiRequestSeq += 1;
  const id = `ui-${uiRequestSeq}`;
  return new Promise((resolve) => {
    const settle = (response) => {
      if (!pendingUiRequests.delete(id)) return;
      resolve(response);
    };
    pendingUiRequests.set(id, settle);
    emit(uiRequestLine({ id, method, ...fields }));
    // ExtensionUIDialogOptions: a parked prompt can be cancelled by an abort
    // signal or a timeout. Either way the primitive resolves to its "no answer"
    // value (false / undefined) so the agent loop never hangs.
    const signal = opts?.signal;
    if (signal?.aborted) settle({ id, cancelled: true });
    else if (signal)
      signal.addEventListener('abort', () => settle({ id, cancelled: true }), { once: true });
    const timeout = typeof opts?.timeout === 'number' ? opts.timeout : 0;
    if (timeout > 0) setTimeout(() => settle({ id, cancelled: true }), timeout).unref?.();
  });
}

function resolveUiResponse(response) {
  if (!response || typeof response.id !== 'string') return;
  const settle = pendingUiRequests.get(response.id);
  if (settle) settle(response);
}

/** stdin EOF / abort — unblock every parked prompt as cancelled so the loop unwinds. */
function rejectAllUiRequests() {
  for (const settle of [...pendingUiRequests.values()]) settle({ cancelled: true });
  pendingUiRequests.clear();
}

// MCP-call park-and-resume channel (B2). The Rust host intercepts the emitted
// `mcpCall` lines (calling mcp_bridge::call_tool) and writes `mcpResult` back to
// stdin; the renderer is never on this path. `mcpChannel.requestMcpResult` is
// wired into the MCP bridge extension (B3); the host below only routes inbound
// `mcpResult` lines (resolveMcpResult) and unwinds on stdin close.
const mcpChannel = createMcpCallChannel(emit);
const worktreeChannel = createWorktreeCallChannel(emit);
const verifyChannel = createVerifyCallChannel(emit);
const activeChildControllers = new Map();
const taskBashRegistry = createTaskBashProcessRegistry({
  executeBoundCommand: async ({ command, cwd, shellPath, timeoutMs, taskWorkspaceLease, signal }) =>
    assertWorktreeOk(
      await worktreeChannel.requestWorktreeResult(
        'executeBash',
        {
          ...taskWorkspaceLease,
          cwd,
          command,
          shellPath,
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        },
        { signal },
      ),
      'executeBash',
    ),
  executeBoundWorkspaceOperation: async ({ op, args, taskWorkspaceLease, signal }) =>
    assertWorktreeOk(
      await worktreeChannel.requestWorktreeResult(
        op,
        {
          ...(taskWorkspaceLease ?? {}),
          ...args,
        },
        { signal },
      ),
      op,
    ),
});
const createTaskScopedAgentSession = createTaskScopedAgentSessionFactory(
  createAgentSession,
  taskBashRegistry,
);
let activeRootSession = null;
let activeControlSession = null;
let activeExecutionTargetGate = null;
let hostTerminating = false;
const pendingRootControls = [];
const acceptedRootControls = { steer: [], followUp: [] };
const observedRootControlIds = new Set();
const rootControlLedger = new Map();
let rootControlDrain = Promise.resolve();
let rootControlsOpen = false;
let activeRootRunId = null;
let nativeRootQueueCounts = { steer: 0, followUp: 0 };

function createWorkAgentSession(options) {
  return createTaskScopedAgentSession(options);
}

async function shutdownActiveWork({ abort }) {
  const pending = [];
  if (abort) {
    if (activeRootSession) pending.push(Promise.resolve(activeRootSession.abort()));
    for (const controller of activeChildControllers.values()) controller.abort();
    rejectAllUiRequests();
    mcpChannel.rejectAllMcpCalls();
    worktreeChannel.rejectAllWorktreeCalls();
    verifyChannel.rejectAllVerifyCalls();
  }
  activeExecutionTargetGate?.close(
    abort
      ? 'Execution target acknowledgement was aborted.'
      : 'Execution target acknowledgement channel closed.',
  );
  pending.push(taskBashRegistry.cleanup());
  await Promise.allSettled(pending);
}

function createRequestExecutionTargetGate(payload) {
  if (activeExecutionTargetGate) {
    throw Object.assign(new Error('The host already owns an execution target gate.'), {
      code: 'execution-target-gate-reused',
    });
  }
  activeExecutionTargetGate = createExecutionTargetGate({
    emit: (line) => emit(executionPreparedLine(line)),
    requestId: payload.requestId,
  });
  return activeExecutionTargetGate;
}

function requireRuntimeModel(payload, modelRegistry) {
  const runtimeModelRef = asNonEmptyString(payload.runtimeModelRef);
  if (!runtimeModelRef) {
    throw Object.assign(new Error('An exact runtimeModelRef is required.'), {
      code: 'execution-target-missing',
    });
  }
  if (payload.model && asNonEmptyString(payload.model) !== runtimeModelRef) {
    throw Object.assign(new Error('The legacy model selector differs from runtimeModelRef.'), {
      code: 'execution-target-mismatch',
    });
  }
  const model = selectedModel(modelRegistry, runtimeModelRef);
  if (!model) {
    throw Object.assign(new Error(`Runtime model was not found: ${runtimeModelRef}`), {
      code: 'model-not-found',
    });
  }
  return { model, runtimeModelRef };
}

function publishControlState(control, state, errorMessage) {
  emit(
    lifecycleLine({
      event: 'control',
      payload: {
        state,
        action: control.action,
        controlId: control.controlId,
        ...(errorMessage ? { errorMessage } : {}),
      },
    }),
  );
}

function controlPayloadFingerprint(control) {
  const images = normalizePromptImages(control.images).map(({ data, mimeType }) => ({
    data,
    mimeType,
  }));
  return createHash('sha256')
    .update(JSON.stringify({ action: control.action, text: control.text, images }))
    .digest('hex');
}

function emitControlState(control, state, errorMessage) {
  const recorded = rootControlLedger.get(control.controlId);
  rootControlLedger.set(control.controlId, {
    control: { ...control },
    state,
    errorMessage,
    rootRunId: recorded?.rootRunId ?? activeRootRunId,
    payloadFingerprint: recorded?.payloadFingerprint ?? controlPayloadFingerprint(control),
  });
  publishControlState(control, state, errorMessage);
}

function rootControlMessage(control, rootRunId) {
  return {
    customType: ROOT_CONTROL_CUSTOM_TYPE,
    content: [{ type: 'text', text: control.text }, ...normalizePromptImages(control.images)],
    display: true,
    details: {
      version: 1,
      rootRunId,
      controlId: control.controlId,
      action: control.action,
      payloadFingerprint: controlPayloadFingerprint(control),
    },
  };
}

function rootControlFromCustomMessage(message, rootRunId) {
  if (message?.role !== 'custom' || message.customType !== ROOT_CONTROL_CUSTOM_TYPE) return null;
  const details = message.details;
  if (
    !details ||
    details.version !== 1 ||
    asNonEmptyString(details.rootRunId) !== rootRunId ||
    (details.action !== 'steer' && details.action !== 'followUp')
  )
    return null;
  const controlId = asNonEmptyString(details.controlId);
  const payloadFingerprint = asNonEmptyString(details.payloadFingerprint);
  if (!controlId || !payloadFingerprint) return null;
  const content = Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: String(message.content ?? '') }];
  const text = content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
  const images = content.filter((part) => part?.type === 'image');
  const control = { action: details.action, controlId, text, images };
  if (controlPayloadFingerprint(control) !== payloadFingerprint) return null;
  return { control, payloadFingerprint, rootRunId };
}

function hydrateRootControlLedger(sessionManager, rootRunId) {
  if (!rootRunId) return;
  for (const entry of sessionManager.getBranch()) {
    if (entry.type !== 'custom_message') continue;
    const decoded = rootControlFromCustomMessage(
      {
        role: 'custom',
        customType: entry.customType,
        content: entry.content,
        details: entry.details,
      },
      rootRunId,
    );
    if (!decoded || rootControlLedger.has(decoded.control.controlId)) continue;
    rootControlLedger.set(decoded.control.controlId, {
      control: decoded.control,
      state: 'consumed',
      rootRunId,
      payloadFingerprint: decoded.payloadFingerprint,
    });
  }
}

function emitRootQueueState() {
  emit(
    lifecycleLine({
      event: 'queue',
      payload: {
        steeringCount: nativeRootQueueCounts.steer + acceptedRootControls.steer.length,
        followUpCount: nativeRootQueueCounts.followUp + acceptedRootControls.followUp.length,
      },
    }),
  );
}

function settleObservedRootControl(controlId, action) {
  const current = rootControlLedger.get(controlId);
  if (!current || current.state !== 'accepted') return;
  const accepted = acceptedRootControls[action];
  const index = accepted.findIndex((control) => control.controlId === controlId);
  if (index >= 0) accepted.splice(index, 1);
  emitControlState(current.control, 'consumed');
  emitRootQueueState();
}

function consumeRootControlMessage(message) {
  const decoded = rootControlFromCustomMessage(message, activeRootRunId);
  if (!decoded) return;
  const record = rootControlLedger.get(decoded.control.controlId);
  if (!record || record.payloadFingerprint !== decoded.payloadFingerprint) return;
  observedRootControlIds.add(decoded.control.controlId);
  queueMicrotask(() => {
    const current = rootControlLedger.get(decoded.control.controlId);
    if (!current || current.state !== 'accepted') return;
    settleObservedRootControl(decoded.control.controlId, decoded.control.action);
  });
}

function drainRootControls() {
  if (!activeControlSession || pendingRootControls.length === 0) return;
  const session = activeControlSession;
  rootControlDrain = rootControlDrain.then(async () => {
    while (activeControlSession === session && pendingRootControls.length > 0) {
      const control = pendingRootControls.shift();
      let acceptedControl = null;
      try {
        const message = rootControlMessage(control, activeRootRunId);
        await session.sendCustomMessage(message, { deliverAs: control.action, triggerTurn: true });
        acceptedControl = { ...control };
        acceptedRootControls[control.action].push(acceptedControl);
        emitControlState(acceptedControl, 'accepted');
        emitRootQueueState();
        if (observedRootControlIds.has(control.controlId)) {
          settleObservedRootControl(control.controlId, control.action);
        }
      } catch (error) {
        if (acceptedControl) {
          const accepted = acceptedRootControls[control.action];
          const index = accepted.indexOf(acceptedControl);
          if (index >= 0) accepted.splice(index, 1);
        }
        if (rootControlLedger.get(control.controlId)?.state !== 'consumed') {
          emitControlState(
            control,
            'failed',
            normalizePiErrorMessage(error instanceof Error ? error.message : String(error)),
          );
          emitRootQueueState();
        }
      }
    }
  });
}

function resolveRuntimeControl(message) {
  if (message?.type !== 'control') return;
  if (message.action === 'reattach') {
    if (activeControlSession) {
      emitRootQueueState();
      for (const record of rootControlLedger.values()) {
        if (record.state !== 'pending') {
          publishControlState(record.control, record.state, record.errorMessage);
        }
      }
    }
    emit(lifecycleLine({ event: 'reattach', payload: { state: 'ready' } }));
    return;
  }
  if (message.action === 'stopChild') {
    const runId = asNonEmptyString(message.runId);
    if (runId) activeChildControllers.get(runId)?.abort();
    return;
  }
  if (message.action !== 'steer' && message.action !== 'followUp') return;
  const controlId = asNonEmptyString(message.controlId);
  const text = asNonEmptyString(message.text);
  if (!controlId || !text) return;
  const control = { action: message.action, controlId, text, images: message.images };
  const recorded = rootControlLedger.get(controlId);
  if (recorded) {
    const samePayload = recorded.payloadFingerprint === controlPayloadFingerprint(control);
    if (!samePayload) {
      publishControlState(
        control,
        'rejected',
        'This control id was already used for another queued instruction.',
      );
    } else if (recorded.state !== 'pending') {
      publishControlState(recorded.control, recorded.state, recorded.errorMessage);
    }
    return;
  }
  if (!rootControlsOpen) {
    emitControlState(control, 'rejected', 'The Pi run is no longer accepting queued instructions.');
    return;
  }
  rootControlLedger.set(controlId, {
    control: { ...control },
    state: 'pending',
    rootRunId: activeRootRunId,
    payloadFingerprint: controlPayloadFingerprint(control),
  });
  pendingRootControls.push(control);
  drainRootControls();
}

async function closeRootControls() {
  rootControlsOpen = false;
  await rootControlDrain.catch(() => {});
  for (const control of pendingRootControls) {
    emitControlState(control, 'failed', 'The Pi run ended before this instruction was accepted.');
  }
  for (const action of ['steer', 'followUp']) {
    for (const control of acceptedRootControls[action]) {
      if (rootControlLedger.get(control.controlId)?.state === 'accepted') {
        emitControlState(
          control,
          'failed',
          'The Pi run ended before this instruction was consumed.',
        );
      }
    }
    acceptedRootControls[action].length = 0;
  }
  activeControlSession = null;
  activeRootRunId = null;
  pendingRootControls.length = 0;
  observedRootControlIds.clear();
}

function assertWorktreeOk(response, label) {
  if (!response || response.ok !== true) {
    const error = new Error(`${label} failed: ${response?.error ?? 'unknown error'}`);
    if (typeof response?.errorCode === 'string' && response.errorCode) {
      error.code = response.errorCode;
    }
    throw error;
  }
  return response.result;
}

function createHostGitWorktreeOps(requestWorktreeResult) {
  const call = async (op, args) => assertWorktreeOk(await requestWorktreeResult(op, args), op);
  return {
    async isGitRepo(root) {
      return Boolean(await call('isGitRepo', { root }));
    },
    async addWorktree(branch, path, provenance) {
      await call('addWorktree', {
        branch,
        path,
        leaseId: provenance?.leaseId,
        runId: provenance?.runId,
      });
    },
    async removeWorktree(path) {
      await call('removeWorktree', { path });
    },
    async discardWorktree(path) {
      await call('discardWorktree', { path });
    },
    async worktreeChanged(path) {
      return Boolean(await call('worktreeChanged', { path }));
    },
    async diff(path) {
      const changedPaths = await call('diff', { path });
      return Array.isArray(changedPaths) ? changedPaths.filter((p) => typeof p === 'string') : [];
    },
    async diffText(path, changedPath) {
      const result = await call('diffText', { path, changedPath });
      return typeof result === 'string' ? result : '';
    },
    async commitAll(path, message) {
      await call('commitAll', { path, message });
    },
    async merge(branch) {
      const result = await call('merge', { branch });
      return {
        ok: result?.ok === true,
        conflicts: Array.isArray(result?.conflicts)
          ? result.conflicts.filter((p) => typeof p === 'string')
          : [],
      };
    },
    async createCheckpoint(path, input) {
      const result = await call('createCheckpoint', { path, ...input });
      return result && typeof result === 'object' ? result : null;
    },
    async listCheckpoints(path, leaseId) {
      const result = await call('listCheckpoints', { path, leaseId });
      return Array.isArray(result) ? result : [];
    },
  };
}

// A headless ExtensionUIContext: the four blocking primitives forward to the
// renderer; everything else is a no-op (a faithful copy of Pi's own
// `noOpUIContext`, which the SDK does not export). Injecting this — rather than
// leaving the default no-op in place — flips `ctx.hasUI` to true so extensions
// know their prompts are answerable.
function createForwardingUiContext() {
  return {
    select: async (title, options, opts) => {
      const r = await requestUiResponse('select', { title, options }, opts);
      return r.cancelled ? undefined : r.value;
    },
    confirm: async (title, message, opts) => {
      const r = await requestUiResponse('confirm', { title, message }, opts);
      return r.confirmed === true;
    },
    input: async (title, placeholder, opts) => {
      const r = await requestUiResponse('input', { title, placeholder }, opts);
      return r.cancelled ? undefined : r.value;
    },
    editor: async (title, prefill) => {
      const r = await requestUiResponse('editor', { title, prefill });
      return r.cancelled ? undefined : r.value;
    },
    notify: () => {},
    onTerminalInput: () => () => {},
    setStatus: () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: async () => undefined,
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => '',
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
    getEditorComponent: () => undefined,
    get theme() {
      return undefined;
    },
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'UI not available' }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
  };
}

function stringifyApprovalArgs(args) {
  try {
    const text = JSON.stringify(args ?? {}, null, 2);
    return text.length > 2000 ? `${text.slice(0, 2000)}\n[truncated]` : text;
  } catch {
    return '{}';
  }
}

async function confirmMcpToolCall({ server, toolName, args, tool }) {
  const computerUse = tool?.category === 'computer-use';
  const message = [
    `${server} -> ${toolName}`,
    '',
    computerUse
      ? 'This computer-use tool can read or control local desktop state.'
      : 'This MCP tool can modify data outside this chat.',
    '',
    'Input:',
    stringifyApprovalArgs(args),
  ].join('\n');
  const response = await requestUiResponse(
    'confirm',
    {
      title: 'Approve MCP tool call?',
      message,
    },
    {
      timeout: MCP_APPROVAL_TIMEOUT_MS,
    },
  );
  return response.confirmed === true;
}

/**
 * Build the inline Pi extension that enforces a permission mode at tool-call
 * time, or `null` when no runtime gate is needed. Plan is enforced by the static
 * read-only tool allowlist; Full is unrestricted. Auto blocks dangerous bash
 * synchronously; Ask pauses on the destructive-but-recoverable band and asks the
 * user through Pi's `ctx.ui.confirm` (the SDK awaits an async `tool_call` handler
 * before the tool runs). Lives here — not in the pure decision module — because
 * it needs the Pi SDK type guard + the extension UI context.
 */
function buildPermissionGate(mode) {
  if (mode === 'auto') {
    return (pi) => {
      pi.on('tool_call', (event) => {
        if (!isToolCallEventType('bash', event)) return undefined;
        const command = typeof event.input?.command === 'string' ? event.input.command : '';
        const verdict = evaluateAutoBashCommand(command);
        return verdict.block ? { block: true, reason: verdict.reason } : undefined;
      });
    };
  }
  if (mode === 'ask') {
    return (pi) => {
      pi.on('tool_call', async (event, ctx) => {
        if (!isToolCallEventType('bash', event)) return undefined;
        const command = typeof event.input?.command === 'string' ? event.input.command : '';
        const verdict = evaluateAskBashCommand(command);
        if (verdict.action === 'allow') return undefined;
        if (verdict.action === 'deny') return { block: true, reason: verdict.reason };
        // 'ask' → pause through Pi's extension UI and wait for the user's verdict.
        const message = verdict.reason ? `${verdict.reason}\n\n${command}` : command;
        const approved = await ctx.ui.confirm('Approve command?', message);
        return approved
          ? undefined
          : {
              block: true,
              reason: 'Rejected by operator — switch to Full mode to run without asking.',
            };
      });
    };
  }
  return null;
}

const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_TOOL_DETAIL_BYTES = 4096;
const MAX_BROWSER_TOOL_DETAIL_BYTES = 2 * 1024 * 1024;
const MAX_INLINE_IMAGE_BYTES = 768 * 1024;
const TRUNCATED_SUFFIX = '\n[truncated by Offisim Pi host output cap]';

// Fixed-flow guidance (Phase 4): a prompt-template "skill" appended to the root
// agent's system prompt when delegation is available. It shapes the
// manager-as-tools loop into research → plan → implement → review → revise and
// tells the agent when to stop iterating — without a new scheduler or graph
// engine. Bounded by the supervisor's deterministic caps (depth / total / token
// budget); this only guides the order.
const DELEGATION_FLOW_GUIDANCE = [
  '## Working with your team',
  'You can hand bounded subtasks to teammates with the `delegate` tool, then',
  'synthesize their results into your own answer — you keep the conversation with',
  'the user. For a non-trivial goal, structure delegation as a flow and iterate:',
  '1. Research — delegate fact-finding / investigation (access: read).',
  '2. Plan — decide the approach from what you learned.',
  'Honor the teammate titles shown in the roster: an Orchestrator decomposes,',
  'plans, reviews evidence, and decides integration; do not send it implementation',
  'work, and an Orchestrator must never delegate a task to itself. Executors are',
  'the primary implementers: give each one bounded work to change, verify, and',
  'report. Use a Reviewer for independent diff review and actionable rework.',
  '3. Implement — delegate the concrete work (access: write); run independent',
  '   tasks in parallel (one delegate call, mode "parallel", multiple tasks).',
  '4. Review — delegate a check of the result (access: review); revise if needed.',
  'Iterate only while it moves the goal forward. Stop when the goal is met or the',
  'result is good enough — do not delegate busywork.',
].join('\n');

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function emit(line) {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

function normalizePiErrorMessage(message) {
  if (/No API key found for the selected model/i.test(message)) {
    return 'The selected AI account has no usable credential for this model. Refresh AI Accounts in Settings, then retry.';
  }
  return message;
}

async function fail(error) {
  if (hostTerminating) return;
  hostTerminating = true;
  const code =
    typeof error === 'object' && error && typeof error.code === 'string'
      ? error.code
      : 'pi-agent-host';
  const rawMessage = error instanceof Error ? error.message : String(error ?? 'Unknown Pi error');
  const message = normalizePiErrorMessage(rawMessage);
  await shutdownActiveWork({ abort: true });
  emit(errorLine({ code, message }));
  process.exit(1);
}

function clampText(value, maxBytes = MAX_TEXT_BYTES) {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const suffixBytes = Buffer.byteLength(TRUNCATED_SUFFIX, 'utf8');
  const keepBytes = Math.max(0, maxBytes - suffixBytes);
  return Buffer.from(text, 'utf8').subarray(0, keepBytes).toString('utf8') + TRUNCATED_SUFFIX;
}

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function hasRecordKeys(value) {
  return (
    value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0
  );
}

function firstPresent(...values) {
  return values.find((value) => {
    if (value === undefined || value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  });
}

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function contentBlocksFrom(value) {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return null;
  if (Array.isArray(value.content)) return value.content;
  if (value.result !== undefined) return contentBlocksFrom(value.result);
  if (value.partialResult !== undefined) return contentBlocksFrom(value.partialResult);
  return null;
}

function isMcpImageBlock(value) {
  return (
    isRecord(value) &&
    value.type === 'image' &&
    typeof value.mimeType === 'string' &&
    value.mimeType.startsWith('image/')
  );
}

function containsMcpImageContent(value) {
  return contentBlocksFrom(value)?.some(isMcpImageBlock) === true;
}

function normalizeMcpContentBlock(value) {
  if (!isMcpImageBlock(value)) return value;
  const normalized = { ...value };
  if (typeof normalized.data === 'string') {
    const dataBytes = Buffer.byteLength(normalized.data, 'base64');
    if (dataBytes > MAX_INLINE_IMAGE_BYTES) {
      normalized.data = undefined;
      normalized.dataRef = `${normalized.mimeType}:${dataBytes}b`;
      normalized.dataBytes = dataBytes;
    }
  }
  return normalized;
}

function normalizeToolDetailPart(value) {
  if (Array.isArray(value)) return value.map(normalizeToolDetailPart);
  if (!isRecord(value)) return value;
  const normalized = { ...value };
  if (Array.isArray(normalized.content)) {
    normalized.content = normalized.content.map(normalizeMcpContentBlock);
  }
  if (normalized.result !== undefined) {
    normalized.result = normalizeToolDetailPart(normalized.result);
  }
  if (normalized.partialResult !== undefined) {
    normalized.partialResult = normalizeToolDetailPart(normalized.partialResult);
  }
  return normalized;
}

function toolDetailJson(parts) {
  const detail = {};
  if (parts.input !== undefined) detail.input = parts.input;
  if (parts.arguments !== undefined) detail.arguments = parts.arguments;
  if (parts.result !== undefined) detail.result = normalizeToolDetailPart(parts.result);
  if (parts.partialResult !== undefined)
    detail.partialResult = normalizeToolDetailPart(parts.partialResult);
  if (parts.details !== undefined) detail.details = parts.details;
  if (parts.isError !== undefined) detail.isError = parts.isError;
  const maxBytes = containsMcpImageContent(detail)
    ? MAX_BROWSER_TOOL_DETAIL_BYTES
    : MAX_TOOL_DETAIL_BYTES;
  return Object.keys(detail).length > 0 ? clampText(JSON.stringify(detail), maxBytes) : undefined;
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (part?.type === 'text') return part.text ?? '';
      if (part?.type === 'thinking') return '';
      if (part?.type === 'toolCall') return '';
      return '';
    })
    .join('');
}

function thinkingText(content) {
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (part?.type === 'thinking') return part.thinking ?? part.text ?? '';
      return '';
    })
    .join('');
}

function messageText(message) {
  if (!message || typeof message !== 'object') return '';
  return contentText(message.content);
}

function messageThinking(message) {
  if (!message || typeof message !== 'object') return '';
  return thinkingText(message.content);
}

function modelSummary(model) {
  return {
    provider: model.provider,
    id: model.id,
    name: model.name ?? model.id,
    api: model.api,
    reasoning: Boolean(model.reasoning),
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    input: Array.isArray(model.input) ? model.input : [],
  };
}

async function createPiRegistries(agentDir) {
  const authPath = agentDir ? join(agentDir, 'auth.json') : undefined;
  const modelsPath = agentDir ? join(agentDir, 'models.json') : undefined;
  if (authPath) mkdirSync(dirname(authPath), { recursive: true });
  const modelRuntime = await ModelRuntime.create({ authPath, modelsPath });
  const modelRegistry = new ModelRegistry(modelRuntime);
  await modelRegistry.refresh();
  const readCredentials = () => {
    if (!authPath || !existsSync(authPath)) return {};
    try {
      const parsed = JSON.parse(readFileSync(authPath, 'utf8'));
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  };
  // Pi 0.80 moved credential ownership behind ModelRuntime. Keep the narrow
  // provenance/status facade synchronous without re-exporting or copying SDK
  // internals; secret resolution itself still goes through ModelRegistry.
  const authStorage = {
    get: (provider) => readCredentials()[provider],
    getApiKey: async () => undefined,
    list: () => Object.keys(readCredentials()),
  };
  return { agentDir, authPath, modelsPath, authStorage, modelRegistry };
}

function modelsConfigSummary(modelsPath, modelRegistry) {
  const path = asNonEmptyString(modelsPath);
  const models = modelRegistry ? modelRegistry.getAll() : [];
  const providers = Array.from(
    new Set(
      models.map((model) => model.provider).filter((provider) => typeof provider === 'string'),
    ),
  ).sort();
  const registryError =
    modelRegistry && typeof modelRegistry.getError === 'function'
      ? modelRegistry.getError()
      : undefined;
  if (!path) {
    return {
      exists: false,
      providerCount: providers.length,
      modelCount: models.length,
      providers,
      ...(registryError ? { parseError: registryError } : {}),
    };
  }
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      providerCount: providers.length,
      modelCount: models.length,
      providers,
      ...(registryError ? { parseError: registryError } : {}),
    };
  }
  return {
    path,
    exists: true,
    providerCount: providers.length,
    modelCount: models.length,
    providers,
    ...(registryError ? { parseError: registryError } : {}),
  };
}

function readModelsJsonForWrite(modelsPath) {
  if (!existsSync(modelsPath)) return { providers: {} };
  const parsed = JSON.parse(
    stripJsonComments(readFileSync(modelsPath, 'utf8'), {
      trailingCommas: true,
    }),
  );
  if (!isRecord(parsed)) {
    throw new Error('models.json root must be an object');
  }
  if (parsed.providers === undefined) {
    parsed.providers = {};
  }
  if (!isRecord(parsed.providers)) {
    throw new Error('models.json providers must be an object');
  }
  return parsed;
}

function skipJsoncTrivia(source, index) {
  let cursor = index;
  while (cursor < source.length) {
    const char = source[cursor];
    if (/\s/u.test(char)) {
      cursor += 1;
      continue;
    }
    if (char === '/' && source[cursor + 1] === '/') {
      cursor += 2;
      while (cursor < source.length && source[cursor] !== '\n') cursor += 1;
      continue;
    }
    if (char === '/' && source[cursor + 1] === '*') {
      cursor += 2;
      while (cursor < source.length && !(source[cursor] === '*' && source[cursor + 1] === '/')) {
        cursor += 1;
      }
      cursor = Math.min(cursor + 2, source.length);
      continue;
    }
    break;
  }
  return cursor;
}

function parseJsonStringAt(source, index) {
  if (source[index] !== '"') throw new Error('Expected JSON string key in models.json');
  let cursor = index + 1;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (char === '"') {
      const end = cursor + 1;
      return { value: JSON.parse(source.slice(index, end)), end };
    }
    cursor += 1;
  }
  throw new Error('Unterminated JSON string in models.json');
}

function findJsoncMatching(source, openIndex, openChar, closeChar) {
  let depth = 0;
  let cursor = openIndex;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === '"') {
      cursor = parseJsonStringAt(source, cursor).end;
      continue;
    }
    if (char === '/' && (source[cursor + 1] === '/' || source[cursor + 1] === '*')) {
      cursor = skipJsoncTrivia(source, cursor);
      continue;
    }
    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return cursor;
    }
    cursor += 1;
  }
  throw new Error('Unbalanced models.json object');
}

function findJsoncValueEnd(source, valueStart) {
  const start = skipJsoncTrivia(source, valueStart);
  const char = source[start];
  if (char === '{') return findJsoncMatching(source, start, '{', '}') + 1;
  if (char === '[') return findJsoncMatching(source, start, '[', ']') + 1;
  if (char === '"') return parseJsonStringAt(source, start).end;
  let cursor = start;
  while (cursor < source.length && !/[,\]}]/u.test(source[cursor])) cursor += 1;
  return cursor;
}

function lineIndentAt(source, index) {
  const lineStart = source.lastIndexOf('\n', Math.max(0, index - 1)) + 1;
  return source.slice(lineStart, index).match(/^\s*/u)?.[0] ?? '';
}

function previousJsoncSignificantChar(source, index) {
  let cursor = index - 1;
  while (cursor >= 0) {
    if (/\s/u.test(source[cursor])) {
      cursor -= 1;
      continue;
    }
    if (source[cursor] === '/' && source[cursor - 1] === '/') {
      cursor -= 2;
      while (cursor >= 0 && source[cursor] !== '\n') cursor -= 1;
      continue;
    }
    if (source[cursor] === '/' && source[cursor - 1] === '*') {
      cursor -= 2;
      while (cursor >= 0 && !(source[cursor] === '/' && source[cursor + 1] === '*')) cursor -= 1;
      cursor -= 1;
      continue;
    }
    return source[cursor];
  }
  return undefined;
}

function findJsoncObjectProperty(source, objectStart, propertyName) {
  if (source[objectStart] !== '{') throw new Error('Expected object in models.json');
  const objectEnd = findJsoncMatching(source, objectStart, '{', '}');
  let cursor = skipJsoncTrivia(source, objectStart + 1);
  while (cursor < objectEnd) {
    if (source[cursor] === ',') {
      cursor = skipJsoncTrivia(source, cursor + 1);
      continue;
    }
    if (source[cursor] !== '"') break;
    const key = parseJsonStringAt(source, cursor);
    const colon = skipJsoncTrivia(source, key.end);
    if (source[colon] !== ':') throw new Error('Expected colon in models.json object');
    const valueStart = skipJsoncTrivia(source, colon + 1);
    const valueEnd = findJsoncValueEnd(source, valueStart);
    if (key.value === propertyName) return { valueStart, valueEnd };
    cursor = skipJsoncTrivia(source, valueEnd);
    if (source[cursor] === ',') cursor = skipJsoncTrivia(source, cursor + 1);
  }
  return null;
}

function formatJsoncValue(value, indent) {
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `${indent}${line}`))
    .join('\n');
}

function insertJsoncObjectProperty(source, objectStart, propertyName, value) {
  const objectEnd = findJsoncMatching(source, objectStart, '{', '}');
  const parentIndent = lineIndentAt(source, objectStart);
  const firstChild = skipJsoncTrivia(source, objectStart + 1);
  const childIndent =
    firstChild < objectEnd ? lineIndentAt(source, firstChild) : `${parentIndent}  `;
  const propertyText = `${JSON.stringify(propertyName)}: ${formatJsoncValue(value, childIndent)}`;
  const hasProperties = firstChild < objectEnd;
  const needsComma = hasProperties && previousJsoncSignificantChar(source, objectEnd) !== ',';
  const insertion = `${needsComma ? ',' : ''}\n${childIndent}${propertyText}\n${parentIndent}`;
  return `${source.slice(0, objectEnd)}${insertion}${source.slice(objectEnd)}`;
}

function upsertJsoncObjectProperty(source, objectStart, propertyName, value) {
  const property = findJsoncObjectProperty(source, objectStart, propertyName);
  if (!property) return insertJsoncObjectProperty(source, objectStart, propertyName, value);
  const indent = lineIndentAt(source, property.valueStart);
  return `${source.slice(0, property.valueStart)}${formatJsoncValue(value, indent)}${source.slice(
    property.valueEnd,
  )}`;
}

function writeModelsJsonProvider(modelsPath, providerId, provider) {
  if (!existsSync(modelsPath)) {
    writeFileSync(
      modelsPath,
      `${JSON.stringify({ providers: { [providerId]: provider } }, null, 2)}\n`,
      { mode: 0o600 },
    );
    chmodSync(modelsPath, 0o600);
    return;
  }
  const source = readFileSync(modelsPath, 'utf8');
  const rootStart = skipJsoncTrivia(source, 0);
  if (source[rootStart] !== '{') throw new Error('models.json root must be an object');
  const providersProperty = findJsoncObjectProperty(source, rootStart, 'providers');
  if (providersProperty && source[providersProperty.valueStart] !== '{') {
    throw new Error('models.json providers must be an object');
  }
  const next = providersProperty
    ? upsertJsoncObjectProperty(source, providersProperty.valueStart, providerId, provider)
    : insertJsoncObjectProperty(source, rootStart, 'providers', { [providerId]: provider });
  writeFileSync(modelsPath, next.endsWith('\n') ? next : `${next}\n`, { mode: 0o600 });
  chmodSync(modelsPath, 0o600);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined;
}

function setOptionalString(target, key, value) {
  const normalized = asNonEmptyString(value);
  if (normalized) {
    target[key] = normalized;
  } else {
    delete target[key];
  }
}

function setOptionalInteger(target, key, value) {
  const normalized = positiveInteger(value);
  if (normalized) {
    target[key] = normalized;
  } else {
    delete target[key];
  }
}

function normalizedProviderModelConfig(model, existingModel) {
  if (!isRecord(model)) return undefined;
  const id = asNonEmptyString(model.id);
  if (!id) return undefined;
  const next = {
    ...(isRecord(existingModel) ? existingModel : {}),
    id,
  };
  setOptionalString(next, 'name', model.name);
  setOptionalString(next, 'api', model.api);
  setOptionalInteger(next, 'contextWindow', model.contextWindow);
  setOptionalInteger(next, 'maxTokens', model.maxTokens);
  return next;
}

function normalizeProviderId(value) {
  const providerId = asNonEmptyString(value);
  if (!providerId) throw new Error('Provider id is required');
  if (!/^[A-Za-z0-9._-]+$/u.test(providerId)) {
    throw new Error('Provider id may only contain letters, numbers, dot, dash, and underscore');
  }
  return providerId;
}

function normalizeBaseUrl(value) {
  const baseUrl = asNonEmptyString(value);
  if (!baseUrl) throw new Error('Base URL is required');
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch (error) {
    throw new Error(`Base URL is invalid: ${error?.message ?? String(error)}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Base URL must start with http:// or https://');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Base URL must not contain credentials, query parameters, or fragments');
  }
  return baseUrl;
}

function normalizeApi(value) {
  const api = asNonEmptyString(value);
  if (!api) throw new Error('API format is required');
  if (!/^[A-Za-z0-9._/-]+$/u.test(api)) {
    throw new Error(
      'API format may only contain letters, numbers, dot, slash, dash, and underscore',
    );
  }
  return api;
}

function providerConfigsFromModelsJson(modelsPath, modelRegistry) {
  const path = asNonEmptyString(modelsPath);
  if (!path || !existsSync(path)) return [];
  let root;
  try {
    root = readModelsJsonForWrite(path);
  } catch {
    return [];
  }
  return Object.entries(root.providers)
    .filter(([, provider]) => isRecord(provider))
    .map(([providerId, provider]) => {
      const auth = modelRegistry.getProviderAuthStatus(providerId);
      const configuredName = asNonEmptyString(provider.name);
      return {
        provider: providerId,
        displayName: configuredName ?? modelRegistry.getProviderDisplayName(providerId),
        ...(configuredName ? { name: configuredName } : {}),
        ...(asNonEmptyString(provider.baseUrl)
          ? { baseUrl: asNonEmptyString(provider.baseUrl) }
          : {}),
        ...(asNonEmptyString(provider.api) ? { api: asNonEmptyString(provider.api) } : {}),
        hasApiKey: Boolean(asNonEmptyString(provider.apiKey)),
        authSource: auth?.source,
        models: Array.isArray(provider.models)
          ? provider.models.map((model) => normalizedProviderModelConfig(model)).filter(Boolean)
          : [],
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function providerTemplatesFromRegistry(modelRegistry, configuredProviders) {
  const templates = new Map();
  for (const model of modelRegistry.getAll()) {
    const provider = asNonEmptyString(model.provider);
    const id = asNonEmptyString(model.id);
    if (!provider || !id) continue;
    const current = templates.get(provider) ?? {
      provider,
      displayName: modelRegistry.getProviderDisplayName(provider),
      configured: configuredProviders.has(provider),
      models: [],
    };
    if (!current.baseUrl && asNonEmptyString(model.baseUrl)) current.baseUrl = model.baseUrl;
    if (!current.api && asNonEmptyString(model.api)) current.api = model.api;
    if (current.models.length < 3) {
      const projected = normalizedProviderModelConfig(model);
      if (projected) current.models.push(projected);
    }
    templates.set(provider, current);
  }
  return [...templates.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function providerConfigForWrite(payload, existingProvider, authStatus) {
  const config = isRecord(payload.config) ? payload.config : undefined;
  if (!config) throw new Error('saveProvider requires config');
  const providerId = normalizeProviderId(config.providerId);
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const api = normalizeApi(config.api);
  const apiKey = asNonEmptyString(config.apiKey);
  const keepExistingApiKey = config.keepExistingApiKey === true;
  const hasExistingKey = Boolean(asNonEmptyString(existingProvider?.apiKey));
  if (!apiKey && !(keepExistingApiKey && (hasExistingKey || authStatus?.configured))) {
    throw new Error('API key is required');
  }

  const existingModels = new Map(
    Array.isArray(existingProvider?.models)
      ? existingProvider.models
          .filter((model) => isRecord(model) && asNonEmptyString(model.id))
          .map((model) => [asNonEmptyString(model.id), model])
      : [],
  );
  const models = Array.isArray(config.models)
    ? config.models
        .map((model) => {
          const id = asNonEmptyString(model?.id);
          if (!id) return undefined;
          const modelApi = asNonEmptyString(model.api);
          return normalizedProviderModelConfig(
            { ...model, ...(modelApi ? { api: normalizeApi(modelApi) } : {}) },
            existingModels.get(id),
          );
        })
        .filter(Boolean)
    : [];
  if (!models.length) throw new Error('Add at least one model id');
  return {
    providerId,
    provider: {
      name: asNonEmptyString(config.displayName),
      baseUrl,
      api,
      ...(apiKey ? { apiKey } : {}),
      models,
    },
  };
}

async function piSaveProvider(payload) {
  const agentDir = asNonEmptyString(payload.agentDir);
  if (!agentDir) throw new Error('saveProvider requires agentDir');
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const modelsPath = join(agentDir, 'models.json');
  const root = readModelsJsonForWrite(modelsPath);
  const { modelRegistry } = await createPiRegistries(agentDir);
  const config = isRecord(payload.config) ? payload.config : {};
  const requestedProviderId = asNonEmptyString(config.providerId);
  const existingProvider =
    requestedProviderId && isRecord(root.providers[requestedProviderId])
      ? root.providers[requestedProviderId]
      : {};
  const authStatus = requestedProviderId
    ? modelRegistry.getProviderAuthStatus(requestedProviderId)
    : undefined;
  const { providerId, provider } = providerConfigForWrite(payload, existingProvider, authStatus);
  writeModelsJsonProvider(modelsPath, providerId, { ...existingProvider, ...provider });
  await piStatus(payload);
}

function selectedModel(modelRegistry, override) {
  const raw = asNonEmptyString(override);
  if (!raw) return undefined;
  const [provider, ...rest] = raw.includes('/') ? raw.split('/') : [];
  if (provider && rest.length > 0) {
    return modelRegistry.find(provider, rest.join('/'));
  }
  return modelRegistry.getAll().find((model) => model.id === raw);
}

function lastAssistantMessage(session) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return messages[index];
  }
  return undefined;
}

async function runtimeStatusProjection({ authStorage, modelRegistry, providerConfigs, checkedAt }) {
  const providerAccounts = [];
  for (const config of providerConfigs) {
    const auth = modelRegistry.getProviderAuthStatus(config.provider);
    if (!config.hasApiKey && !auth?.configured) continue;
    const model = modelRegistry.getAll().find((entry) => entry.provider === config.provider);
    if (!model) continue;
    try {
      const identity = await executionAccountIdentity(authStorage, modelRegistry, model);
      if (identity.billingMode !== 'api') continue;
      providerAccounts.push({
        providerId: config.provider,
        displayName: config.displayName,
        accountId: identity.accountId,
        configured: true,
        authMode: 'api',
        baseUrl: config.baseUrl,
        api: config.api,
      });
    } catch {
      // A configured-looking provider without a resolvable credential is not an
      // executable account. Product status must not invent or expose an identity.
    }
  }
  return projectApiAccountCatalog({
    providerAccounts,
    availableModels: modelRegistry.getAvailable(),
    checkedAt,
    now: new Date(checkedAt),
  });
}

async function piStatus(payload) {
  const { agentDir, authPath, modelsPath, authStorage, modelRegistry } = await createPiRegistries(
    asNonEmptyString(payload.agentDir),
  );
  const providers = Array.from(
    new Set(modelRegistry.getAll().map((model) => model.provider)),
  ).sort();
  const providerStatus = providers.map((provider) => ({
    provider,
    displayName: modelRegistry.getProviderDisplayName(provider),
    auth: modelRegistry.getProviderAuthStatus(provider),
  }));
  const providerConfigs = providerConfigsFromModelsJson(modelsPath, modelRegistry);
  const configuredProviders = new Set(providerConfigs.map((config) => config.provider));
  for (const account of providerStatus) {
    if (account.auth?.configured) configuredProviders.add(account.provider);
  }
  const providerStatusById = new Map(providerStatus.map((account) => [account.provider, account]));
  const configuredProviderStatus = [...configuredProviders]
    .map((provider) => {
      const account = providerStatusById.get(provider);
      if (account) return account;
      const config = providerConfigs.find((providerConfig) => providerConfig.provider === provider);
      return {
        provider,
        displayName: config?.displayName ?? modelRegistry.getProviderDisplayName(provider),
        auth: {
          configured: Boolean(config?.hasApiKey),
          source: config?.authSource ?? (config?.hasApiKey ? 'models_json_key' : undefined),
        },
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  const checkedAt = new Date().toISOString();
  const runtimeStatus = await runtimeStatusProjection({
    authStorage,
    modelRegistry,
    providerConfigs,
    checkedAt,
  });
  emit(
    resultLine({
      ok: true,
      runtimeStatus,
      authProviders: authStorage.list().sort(),
      providerStatus,
      configuredProviderStatus,
      providerConfigs,
      providerTemplates: providerTemplatesFromRegistry(modelRegistry, configuredProviders),
      availableModels: modelRegistry.getAvailable().map(modelSummary),
      allModelCount: modelRegistry.getAll().length,
      paths: {
        agentDir,
        authPath,
        modelsPath,
      },
      modelsConfig: modelsConfigSummary(modelsPath, modelRegistry),
      checkedAt,
    }),
  );
}

async function runPrompt(payload) {
  rootControlsOpen = false;
  activeRootSession = null;
  activeControlSession = null;
  pendingRootControls.length = 0;
  acceptedRootControls.steer.length = 0;
  acceptedRootControls.followUp.length = 0;
  observedRootControlIds.clear();
  rootControlLedger.clear();
  nativeRootQueueCounts = { steer: 0, followUp: 0 };
  activeRootRunId = asNonEmptyString(payload.rootRunId) ?? asNonEmptyString(payload.requestId);
  const executionGate = createRequestExecutionTargetGate(payload);
  const workspaceState = normalizeExecuteWorkspace(payload);
  const workspaceUnavailable = workspaceState.availability === 'unavailable';
  const cwd = asNonEmptyString(payload.cwd);
  if (cwd !== '.') {
    throw Object.assign(new Error('Pi work requests require the host-anchored cwd.'), {
      code: 'invalid-request',
    });
  }
  // Bound runs inherit Rust's descriptor-anchored Project inode. Unavailable
  // optional runs inherit Rust's neutral directory; they retain the same `.`
  // session identity while the host removes every workspace capability below.
  const workspaceRoot = workspaceUnavailable ? undefined : process.cwd();
  const text = asNonEmptyString(payload.text);
  if (!text) {
    throw Object.assign(new Error('Pi Agent requests must include text.'), {
      code: 'invalid-request',
    });
  }
  const promptImages = normalizePromptImages(payload.images);

  const agentDir = asNonEmptyString(payload.agentDir);
  const { authStorage, modelRegistry } = await createPiRegistries(agentDir);
  const sessionDir = asNonEmptyString(payload.sessionDir);
  const nativeSessionMode = asNonEmptyString(payload.nativeSessionMode);
  if (nativeSessionMode !== 'tracked' && nativeSessionMode !== 'fresh') {
    throw Object.assign(new Error('Pi work requires a valid nativeSessionMode.'), {
      code: 'invalid-request',
    });
  }
  const exactSessionFile = asNonEmptyString(payload.exactSessionFile);
  const exactSessionId = asNonEmptyString(payload.exactSessionId);
  if (Boolean(exactSessionFile) !== Boolean(exactSessionId)) {
    throw Object.assign(
      new Error('Pi work requires one complete exact native session reference.'),
      {
        code: 'native-session-invalid',
      },
    );
  }
  if (nativeSessionMode === 'fresh' && exactSessionFile) {
    throw Object.assign(new Error('A fresh Pi session cannot carry an exact session reference.'), {
      code: 'invalid-request',
    });
  }
  if (sessionDir) mkdirSync(sessionDir, { recursive: true });
  // Rust is the Conversation-session authority. It either supplies the one
  // durable exact file/id pair to continue (normal Turn or Resume) or supplies
  // no pair for the Conversation's first native session. Never scan the folder
  // for an untracked "recent" file: Project cwd changes would silently fork
  // memory, while unrelated files could be adopted without durable provenance.
  const sessionManager = exactSessionFile
    ? SessionManager.open(exactSessionFile, sessionDir, cwd)
    : SessionManager.create(cwd, sessionDir);
  hydrateRootControlLedger(sessionManager, activeRootRunId);
  const { model, runtimeModelRef } = requireRuntimeModel(payload, modelRegistry);

  // Per-conversation permission mode (plan / ask / auto / full). Plan restricts
  // the tool set to the read-only built-ins (no gate needed — bash/edit/write are
  // never exposed); Ask pauses for recoverable destructive commands; Auto keeps
  // the full tool set but blocks catastrophic commands; Full leaves the session
  // unrestricted.
  const permissionMode = normalizePermissionMode(payload.permissionMode);
  const baseTools = workspaceUnavailable ? [] : toolAllowlistForMode(permissionMode);
  // Per-conversation thinking level (reasoning effort). Forwarded as a native
  // `createAgentSession` option; Pi clamps it to the model's capabilities (a
  // non-reasoning model collapses every level to `off`). Unknown → undefined so
  // Pi uses its settings/default level.
  const thinkingLevel = normalizeThinkingLevel(payload.thinkingLevel);
  const gateFactory = workspaceUnavailable ? null : buildPermissionGate(permissionMode);
  // Per-employee persona, forwarded as the session's appended system prompt
  // (Pi's official `appendSystemPrompt` resource-loader option). Build one
  // DefaultResourceLoader whenever there's a permission gate OR a persona, and
  // merge both into it so Pi receives a single loader.
  const systemPromptAppend = asNonEmptyString(payload.systemPromptAppend);
  // Vault-authoritative employee skills use Pi's native discovery contract.
  // The renderer resolves the effective company + employee scope and Rust
  // forwards absolute SKILL.md paths; the loader parses and injects them.
  const skillPaths =
    !workspaceUnavailable && Array.isArray(payload.skillPaths)
      ? payload.skillPaths.filter((path) => typeof path === 'string' && path.trim())
      : [];
  // Delegation: when the renderer supplies a root run id + thread id + a non-empty
  // company roster, register the `delegate` tool so the root agent can hand bounded
  // subtasks to teammates. Children are built in-process by the supervisor (see
  // Docs/DELEGATION_ARCHITECTURE.md), bounded by deterministic caps (depth /
  // concurrency / total / token budget), and may recursively delegate up to
  // maxDepth. When delegation is on, the fixed-flow guidance is appended too.
  const rootRunId = asNonEmptyString(payload.rootRunId);
  const threadId = asNonEmptyString(payload.threadId);
  // The project owning this workspace, forwarded verbatim by the Tauri host. The
  // delegation supervisor stamps every child agentRun event with it so the
  // renderer scopes children to the same project. Optional (null on a run with
  // no bound project) — but it MUST be declared here: the supervisor args object
  // below references `projectId`, and a bare undeclared reference throws
  // "projectId is not defined", failing every rostered Office run at bootstrap.
  const projectId = asNonEmptyString(payload.projectId);
  const projectVerifyCommand = asNonEmptyString(payload.projectVerifyCommand);
  const projectVerifyMaxAttempts = Number.isInteger(payload.projectVerifyMaxAttempts)
    ? Math.max(1, Math.min(20, payload.projectVerifyMaxAttempts))
    : 3;
  const projectVerifyTokenBudget = Number.isFinite(payload.projectVerifyTokenBudget)
    ? Math.max(1, payload.projectVerifyTokenBudget)
    : undefined;
  const roster = !workspaceUnavailable && Array.isArray(payload.roster) ? payload.roster : [];
  const directDelegation =
    !workspaceUnavailable && isRecord(payload.directDelegation) ? payload.directDelegation : null;
  const delegationLimitOverrides = normalizeDelegationLimitOverrides(payload.delegationLimits);
  const delegationEnabled = Boolean(
    !workspaceUnavailable && rootRunId && threadId && roster.length > 0,
  );
  const delegationBudgetState = delegationEnabled
    ? delegationLimitOverrides === undefined
      ? createDelegationLimits()
      : createDelegationLimits(delegationLimitOverrides)
    : null;
  // Publish-artifact: register the `publish_artifact` tool whenever the run has a
  // root id + thread id (the scope fields the renderer needs to persist the
  // deliverable row). Independent of having a roster — a soloing agent can still
  // publish an artifact. Excluded from `plan` mode: planning is read-only, so the
  // agent cannot have written a file to publish (a publish there would be a
  // phantom row the renderer's workspace read rejects anyway).
  const publishArtifactEnabled =
    !workspaceUnavailable && Boolean(rootRunId && threadId) && permissionMode !== 'plan';
  // Mission bridge (MS-005): register `submit_for_evaluation` + `query_mission_state`
  // only when this run carries a mission context packet (the renderer's
  // MissionRunController injects `missionContextJson` for an attempt). A plain chat
  // never sets it, so existing behavior is unchanged. The bridge needs the run
  // scope (rootRunId + threadId) to stamp its events so the renderer can correlate
  // submissions to the current attempt. Unlike publish_artifact it is allowed in
  // every mode — a mission run may legitimately submit a read-only criterion.
  const missionContextJson = workspaceUnavailable
    ? undefined
    : asNonEmptyString(payload.missionContextJson);
  const missionEnabled = Boolean(
    !workspaceUnavailable && rootRunId && threadId && missionContextJson,
  );
  // MCP bridge (B3): the discovery meta-tools (mcp_search_tools /
  // mcp_describe_tool) are registered on EVERY run so an employee with no MCP
  // grants can still answer "what tools do I have?" — mcp_search_tools returns an
  // actionable "none granted yet, enable them in Settings" state instead of the
  // apology in screenshot 1. The execution path (mcp_call) is only exposed when a
  // grant-scoped catalog exists, so discovery never becomes an ungated call path:
  // the per-employee grant catalog stays the trust boundary. Plan mode keeps only
  // read-class MCP tools; write-class tools are filtered out of the catalog.
  const mcpTools = !workspaceUnavailable && Array.isArray(payload.mcpTools) ? payload.mcpTools : [];
  const scopedMcpTools =
    permissionMode === 'plan' ? mcpTools.filter((tool) => !isWriteMcpTool(tool)) : mcpTools;
  const mcpHasCatalog = scopedMcpTools.length > 0;
  // `tools` is an EXPLICIT allowlist on every run (never left undefined). Passing
  // undefined would let Pi auto-activate whatever tools any disk-loaded CLI/global
  // Pi extension registered; Offisim deliberately keeps a controlled tool surface
  // (built-ins + its own delegate/publish/mission/mcp extensions routed through the
  // harness/gateway path — AI Runtime Policy), the same surface the MCP path
  // already enforced. This enumeration is complete: they are the only tools any
  // Offisim-registered extension exposes (harness:pi-agent-host locks it).
  const tools = workspaceUnavailable
    ? [PROJECT_WORKSPACE_REQUIRED_TOOL]
    : [
        ...baseTools,
        ...(delegationEnabled ? ['delegate'] : []),
        ...(publishArtifactEnabled ? ['publish_artifact'] : []),
        ...(missionEnabled ? ['submit_for_evaluation', 'query_mission_state'] : []),
        'mcp_search_tools',
        'mcp_describe_tool',
        ...(mcpHasCatalog ? ['mcp_call'] : []),
      ];
  // A write-class MCP tool pauses for ctx.ui.confirm, which needs the forwarding
  // UI context bound — the same bind `ask` mode already does.
  const mcpNeedsUi = !workspaceUnavailable && mcpHasCatalog && scopedMcpTools.some(isWriteMcpTool);
  // When the conversation does not carry an explicit override, Pi chooses the
  // real root model during createAgentSession. The delegation supervisor reads
  // this live binding later, when delegate executes, so unbound employees inherit
  // the actual root model rather than independently resolving another default.
  let effectiveRootModel = model;
  // The MCP discovery bridge is registered on every run (so an ungranted employee
  // can still discover tools), so a resource loader + extension list is always
  // built now — no run reaches createAgentSession without one.
  let resourceLoader;
  let settingsManager;
  let directSupervisor = null;
  let lspDiagnosticsFactory = null;
  {
    settingsManager = SettingsManager.create(cwd, agentDir);
    const extensionFactories = [];
    if (gateFactory) extensionFactories.push(gateFactory);
    if (!workspaceUnavailable) {
      lspDiagnosticsFactory = createLspDiagnosticsExtensionFactory({
        cwd: workspaceRoot,
        emitDiagnostics: (diagnostics) => {
          if (!rootRunId || !threadId) return;
          emit(
            agentRunLine({
              threadId,
              rootRunId,
              runId: rootRunId,
              employeeId: asNonEmptyString(payload.employeeId),
              runType: 'workspace.diagnostics.updated',
              payload: diagnostics,
            }),
          );
        },
        ...(projectVerifyCommand && projectId
          ? {
              runFallbackVerification: () =>
                verifyChannel.requestVerifyResult({
                  command: projectVerifyCommand,
                  cwd: workspaceRoot,
                  projectId,
                }),
            }
          : {}),
      });
      extensionFactories.push(lspDiagnosticsFactory);
    }
    if (delegationEnabled) {
      // One shared limit budget for this whole user turn's delegation tree
      // (depth / concurrency / total children / per-child timeout).
      const gitOps = createHostGitWorktreeOps(worktreeChannel.requestWorktreeResult);
      const leaseManager = createWorkspaceLeaseManager({
        gitOps,
        now: () => new Date().toISOString(),
        newId: () => randomUUID(),
      });
      const checkpointManager = createWorkspaceCheckpointManager({
        gitOps,
        now: () => new Date().toISOString(),
      });
      const rootLease = await leaseManager.acquireRootLease(workspaceRoot);
      const confirmIntegration = async (plan) => {
        const mergeable = Array.isArray(plan?.mergeable) ? plan.mergeable : [];
        const reviewRows = await Promise.all(
          mergeable.map(async (lease) => {
            try {
              const diff = await leaseManager.collectDiff(lease);
              const changedPaths =
                Array.isArray(diff.changedPaths) && diff.changedPaths.length > 0
                  ? diff.changedPaths.join(', ')
                  : '(no changed paths reported)';
              return `- ${lease.runId}: ${lease.branch ?? '(no branch)'} at ${lease.cwd}\n  paths: ${changedPaths}`;
            } catch (error) {
              return `- ${lease.runId}: ${lease.branch ?? '(no branch)'} at ${lease.cwd}\n  paths: failed to collect diff (${error?.message ?? String(error)})`;
            }
          }),
        );
        const message = [
          `Merge ${mergeable.length} delegated write worktree(s) into the root workspace?`,
          '',
          ...reviewRows,
          '',
          'Approve only after reviewing the listed worktree diffs.',
        ].join('\n');
        const response = await requestUiResponse('confirm', {
          title: `Review delegated work ${mergeable[0]?.leaseId ?? ''}`,
          message,
        });
        return response.confirmed === true;
      };
      const supervisor = createChildSupervisor({
        emit,
        agentDir,
        authStorage,
        modelRegistry,
        cwd,
        projectId,
        verifyConfig: projectVerifyCommand
          ? {
              command: projectVerifyCommand,
              maxAttempts: projectVerifyMaxAttempts,
              tokenBudget: projectVerifyTokenBudget,
            }
          : undefined,
        requestVerifyResult: verifyChannel.requestVerifyResult,
        settingsManager,
        threadId,
        rootRunId,
        roster,
        get rootModel() {
          return effectiveRootModel;
        },
        rootThinkingLevel: thinkingLevel,
        permissionMode,
        resolveModel: (modelId) => selectedModel(modelRegistry, modelId),
        buildPermissionGate,
        bindChildUi: (session) =>
          session.bindExtensions({ uiContext: createForwardingUiContext(), mode: 'rpc' }),
        limits: delegationBudgetState,
        leaseManager,
        checkpointManager,
        rootLease,
        validateLeaseCwd: async (leaseClaim) =>
          assertWorktreeOk(
            await worktreeChannel.requestWorktreeResult('validateCwd', leaseClaim),
            'validateCwd',
          ),
        confirmIntegration,
        depth: 0,
        parentRunId: rootRunId,
        childControllers: activeChildControllers,
        ...(directDelegation
          ? {
              onControlSessionReady: (_runId, session) => {
                if (activeControlSession && activeControlSession !== session) {
                  throw new Error('The direct run already owns another steer target.');
                }
                activeControlSession = session;
                drainRootControls();
              },
              onControlSessionClosed: (_runId, session) => {
                if (activeControlSession === session) activeControlSession = null;
              },
              onControlMessage: consumeRootControlMessage,
            }
          : {}),
        createAgentSession: createWorkAgentSession,
        executionTargetGate: executionGate,
        expectedTarget: payload.expectedTarget,
        runtimeModelRef,
      });
      directSupervisor = supervisor;
      extensionFactories.push(createDelegationExtensionFactory(supervisor));
    }
    if (publishArtifactEnabled) {
      extensionFactories.push(
        createPublishArtifactExtensionFactory({
          emit,
          threadId,
          rootRunId,
          employeeId: asNonEmptyString(payload.employeeId),
          cwd,
        }),
      );
    }
    if (missionEnabled) {
      extensionFactories.push(
        createMissionBridgeExtensionFactory({
          emit,
          threadId,
          rootRunId,
          employeeId: asNonEmptyString(payload.employeeId),
          missionContextJson,
        }),
      );
    }
    if (workspaceUnavailable) {
      extensionFactories.push(
        createProjectWorkspaceRequiredExtensionFactory(workspaceState.reasonCode),
      );
    } else {
      // Bound work always gets MCP discovery, including the actionable empty
      // catalog state. Workspace-unavailable work must not register any MCP
      // bridge, even when a stale renderer packet carried grants.
      extensionFactories.push(
        createMcpBridgeExtensionFactory({
          mcpTools: scopedMcpTools,
          requestMcpResult: mcpChannel.requestMcpResult,
          confirmMcpToolCall,
          emit,
          threadId,
          rootRunId,
          employeeId: asNonEmptyString(payload.employeeId),
        }),
      );
    }
    // Append the employee persona and, when delegation is on, the fixed-flow
    // guidance — both are generic appended system prompts (Pi's official option).
    const appendSystemPrompt = [];
    if (systemPromptAppend) appendSystemPrompt.push(systemPromptAppend);
    if (delegationEnabled) appendSystemPrompt.push(DELEGATION_FLOW_GUIDANCE);
    if (workspaceUnavailable) {
      appendSystemPrompt.push(workspaceUnavailableSystemPrompt(workspaceState.reasonCode));
    }
    resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      ...(extensionFactories.length > 0 ? { extensionFactories } : {}),
      ...(appendSystemPrompt.length > 0 ? { appendSystemPrompt } : {}),
      ...(skillPaths.length > 0 ? { additionalSkillPaths: skillPaths } : {}),
      ...(workspaceUnavailable
        ? {
            noExtensions: true,
            noSkills: true,
            noPromptTemplates: true,
            noThemes: true,
            noContextFiles: true,
          }
        : {}),
    });
    await resourceLoader.reload();
  }

  if (directDelegation) {
    if (!directSupervisor) throw new Error('Direct delegation requires a valid company roster.');
    const employeeId = asNonEmptyString(directDelegation.employeeId);
    const objective = asNonEmptyString(directDelegation.objective);
    if (!employeeId || !objective)
      throw new Error('Direct delegation requires employeeId and objective.');
    rootControlsOpen = true;
    try {
      emit(startedLine({}));
      const directResult = await directSupervisor.runSingleWithMetadata({
        employeeId,
        objective,
        access:
          directDelegation.access === 'read' || directDelegation.access === 'review'
            ? directDelegation.access
            : 'write',
        workKind: asNonEmptyString(directDelegation.workKind) ?? undefined,
        resumeLease: isRecord(directDelegation.resumeLease)
          ? directDelegation.resumeLease
          : undefined,
      });
      const summary = directResult.text;
      if (directResult.completed && (!directResult.model || !directResult.provenance)) {
        throw Object.assign(
          new Error('Direct delegation completed without a prepared child execution identity.'),
          { code: 'provenance-missing' },
        );
      }
      emit(messageEndLine({ text: summary, stopReason: 'end_turn' }));
      await taskBashRegistry.cleanup();
      emit(
        resultLine({
          ok: true,
          text: summary,
          ...(directResult.model ? { model: modelSummary(directResult.model) } : {}),
          ...(directResult.provenance ? { provenance: directResult.provenance } : {}),
          ...(delegationBudgetState ? { budgetUsage: delegationBudgetState.usage() } : {}),
        }),
      );
      return;
    } finally {
      await closeRootControls();
    }
  }

  const { session, modelFallbackMessage } = await createWorkAgentSession({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    sessionManager,
    settingsManager,
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(workspaceUnavailable ? { noTools: 'builtin' } : {}),
    ...(tools ? { tools } : {}),
    ...(resourceLoader ? { resourceLoader } : {}),
  });
  activeRootSession = session;
  activeControlSession = session;
  rootControlsOpen = true;
  drainRootControls();
  effectiveRootModel = session.model ?? model;
  if (
    exactSessionFile &&
    (session.sessionFile !== exactSessionFile || session.sessionId !== exactSessionId)
  ) {
    session.dispose();
    activeRootSession = null;
    activeControlSession = null;
    throw Object.assign(
      new Error('The exact native Pi session changed before this Turn could start.'),
      { code: 'native-session-invalid' },
    );
  }
  let preparedExecution;
  try {
    preparedExecution = await executionGate.prepare({
      authStorage,
      modelRegistry,
      session,
      modelFallbackMessage,
      expectedTarget: payload.expectedTarget,
      runtimeModelRef,
      runId: asNonEmptyString(payload.rootRunId) ?? session.sessionId,
    });
  } catch (error) {
    session.dispose();
    activeRootSession = null;
    throw error;
  }

  // Bind a forwarding UI context so a mid-run `ctx.ui.confirm` routes through our
  // stdin channel. Needed by Ask mode (the bash gate) AND by the MCP bridge when
  // any scoped tool is write-class (its gate confirms before running). Other
  // modes leave Pi's default no-op context in place.
  if (permissionMode === 'ask' || mcpNeedsUi) {
    await session.bindExtensions({ uiContext: createForwardingUiContext(), mode: 'rpc' });
  }

  let latestText = '';
  let activeReasoningText = '';
  let latestReasoningText = '';
  let emittedReasoning = false;
  // Only messages from this Turn are collected. Provider-native accounting is
  // resolved after the prompt so SDK placeholder zeroes never become product truth.
  const runAssistantMessages = [];
  const toolInputsById = new Map();
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'queue_update') {
      nativeRootQueueCounts = {
        steer: event.steering.length,
        followUp: event.followUp.length,
      };
      emitRootQueueState();
      return;
    }
    if (event.type === 'compaction_start') {
      emit(
        lifecycleLine({ event: 'compaction', payload: { state: 'started', reason: event.reason } }),
      );
      return;
    }
    if (event.type === 'compaction_end') {
      emit(
        lifecycleLine({
          event: 'compaction',
          payload: {
            state: 'finished',
            reason: event.reason,
            aborted: event.aborted,
            willRetry: event.willRetry,
            errorMessage: event.errorMessage,
          },
        }),
      );
      return;
    }
    if (event.type === 'auto_retry_start') {
      emit(
        lifecycleLine({
          event: 'retry',
          payload: {
            state: 'started',
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            delayMs: event.delayMs,
            errorMessage: event.errorMessage,
          },
        }),
      );
      return;
    }
    if (event.type === 'auto_retry_end') {
      emit(
        lifecycleLine({
          event: 'retry',
          payload: {
            state: 'finished',
            success: event.success,
            attempt: event.attempt,
            finalError: event.finalError,
          },
        }),
      );
      return;
    }
    if (event.type === 'agent_settled') {
      const context = session.getContextUsage();
      if (context)
        emit(
          lifecycleLine({
            event: 'context',
            payload: {
              tokens: context.tokens,
              contextWindow: context.contextWindow,
              percent: context.percent,
            },
          }),
        );
      return;
    }
    if (event.type === 'agent_start') {
      emit(
        startedLine({
          sessionId: session.sessionId,
          sessionFile: session.sessionFile,
          model: session.model ? modelSummary(session.model) : undefined,
          modelFallbackMessage,
        }),
      );
      return;
    }
    if (event.type === 'message_update') {
      const streamEvent = event.assistantMessageEvent;
      if (streamEvent?.type === 'text_delta' && streamEvent.delta) {
        emit(messageDeltaLine({ channel: 'content', delta: clampText(streamEvent.delta) }));
      }
      if (streamEvent?.type === 'thinking_delta' && streamEvent.delta) {
        activeReasoningText += streamEvent.delta;
        emittedReasoning = true;
        emit(messageDeltaLine({ channel: 'reasoning', delta: clampText(streamEvent.delta) }));
      }
      return;
    }
    if (event.type === 'message_end') {
      if (event.message?.role === 'custom') {
        consumeRootControlMessage(event.message);
        return;
      }
      if (event.message?.role === 'assistant') {
        const reasoningText = clampText(messageThinking(event.message) || activeReasoningText);
        if (reasoningText && !activeReasoningText.trim()) {
          emittedReasoning = true;
          emit(messageDeltaLine({ channel: 'reasoning', delta: reasoningText }));
        }
        latestReasoningText = reasoningText;
        activeReasoningText = '';
        latestText = clampText(messageText(event.message));
        runAssistantMessages.push(event.message);
        // The delegation budget is an execution guard, not product accounting;
        // adapter token counters remain sufficient for this bounded-loop check.
        const u = event.message.usage;
        if (u) {
          delegationBudgetState?.recordTokens({ ...u, turns: 1 });
        }
        emit(
          messageEndLine({
            text: latestText,
            stopReason: event.message.stopReason,
            errorMessage: event.message.errorMessage,
          }),
        );
      }
      return;
    }
    if (event.type === 'tool_call') {
      assertWorkspaceToolAllowed(workspaceUnavailable, event.toolName);
      if (hasRecordKeys(event.input) || isNonEmptyArray(event.input)) {
        toolInputsById.set(event.toolCallId, event.input);
      }
      return;
    }
    if (event.type === 'tool_execution_start') {
      assertWorkspaceToolAllowed(workspaceUnavailable, event.toolName);
      const input = firstPresent(
        event.input,
        event.args,
        event.arguments,
        toolInputsById.get(event.toolCallId),
      );
      if (input !== undefined) toolInputsById.set(event.toolCallId, input);
      emit(
        toolLine({
          status: 'started',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          detail: toolDetailJson({ input, arguments: input }),
        }),
      );
      return;
    }
    if (event.type === 'tool_execution_update') {
      assertWorkspaceToolAllowed(workspaceUnavailable, event.toolName);
      const input = firstPresent(
        event.input,
        event.args,
        event.arguments,
        toolInputsById.get(event.toolCallId),
      );
      emit(
        toolLine({
          status: 'running',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          detail: toolDetailJson({
            input,
            arguments: input,
            partialResult: event.partialResult,
          }),
        }),
      );
      return;
    }
    if (event.type === 'tool_execution_end') {
      assertWorkspaceToolAllowed(workspaceUnavailable, event.toolName);
      const input = firstPresent(
        event.input,
        event.args,
        event.arguments,
        toolInputsById.get(event.toolCallId),
      );
      emit(
        toolLine({
          status: event.isError ? 'failed' : 'completed',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          detail: toolDetailJson({
            input,
            arguments: input,
            result: event.result,
            details: event.details,
            isError: event.isError,
          }),
        }),
      );
      toolInputsById.delete(event.toolCallId);
    }
  });

  try {
    executionGate.assertPrepared(preparedExecution, session);
    await session.prompt(text, promptImages.length > 0 ? { images: promptImages } : undefined);
    const finalAssistant = lastAssistantMessage(session);
    const assistantError = asNonEmptyString(finalAssistant?.errorMessage);
    if (finalAssistant?.stopReason === 'error' || assistantError) {
      const message = normalizePiErrorMessage(
        assistantError ?? 'The selected AI model returned an error without details.',
      );
      throw Object.assign(new Error(message), { code: 'upstream' });
    }
    const fallbackReasoning = clampText(messageThinking(finalAssistant));
    const finalReasoning = clampText(latestReasoningText || fallbackReasoning);
    if (fallbackReasoning && !emittedReasoning) {
      emit(messageDeltaLine({ channel: 'reasoning', delta: fallbackReasoning }));
    }
    // Fall back to the streamed messageEnd text when the SDK returns an empty
    // final string — `??` would keep the empty string (only null/undefined are
    // nullish), surfacing a blank result line.
    const finalText = clampText(session.getLastAssistantText() || latestText);
    // The result line is the Rust gateway's terminal. Every host-tracked Bash
    // call must be settled before Rust accepts that line.
    await taskBashRegistry.cleanup();
    const rootUsage = await resolveApiRunUsage({
      messages: runAssistantMessages,
      provenance: preparedExecution.identity,
      model: session.model ?? model,
      modelRegistry,
    }).catch(() => undefined);
    emit(
      resultLine({
        ok: true,
        text: finalText,
        reasoning: finalReasoning || undefined,
        sessionId: session.sessionId,
        sessionFile: session.sessionFile,
        model: session.model ? modelSummary(session.model) : undefined,
        provenance: preparedExecution.identity,
        ...(rootUsage ? { usage: rootUsage } : {}),
        ...(delegationBudgetState ? { budgetUsage: delegationBudgetState.usage() } : {}),
      }),
    );
  } finally {
    await closeRootControls();
    unsubscribe();
    await lspDiagnosticsFactory?.dispose?.();
    session.dispose();
    if (activeRootSession === session) activeRootSession = null;
  }
}

// ── Prompt Enhance (PR-06) ───────────────────────────────────────────────────
//
// A DEDICATED one-shot path, fully isolated from `runPrompt`. Enhance turns a
// user-authored message into a clearer version under a versioned profile system
// prompt. It is NOT a work run: it must NEVER register a tool, NEVER bind a
// project workspace, and NEVER persist anything. The Rust `agent_runtime_enhance`
// command resolves a NEUTRAL cwd (no project) and forwards `mode:'enhance'` here;
// this function shares only the auth/model plumbing (the real Pi model call) with
// the execute path, nothing else.
//
// Isolation, enforced three ways so a regression can't silently re-arm tools:
//   1. `noTools: 'all'`  — the SDK starts with NO tools enabled.
//   2. `tools: []`       — the explicit allowlist enables nothing on top.
//   3. resourceLoader carries ONLY the supplied `systemPrompt` and
//      ZERO `extensionFactories` — no permission gate, no delegation, no publish,
//      no mission bridge, no `ctx.ui` binding. There is no second stdin channel.
async function runEnhance(payload) {
  const executionGate = createRequestExecutionTargetGate(payload);
  const text = asNonEmptyString(payload.text);
  if (!text) {
    throw Object.assign(new Error('Prompt enhance requests must include text.'), {
      code: 'invalid-request',
    });
  }
  const systemPrompt = asNonEmptyString(payload.systemPrompt);
  if (!systemPrompt) {
    throw Object.assign(
      new Error('Prompt enhance requests must include a profile system prompt.'),
      {
        code: 'invalid-request',
      },
    );
  }
  // A neutral cwd (Rust passes a non-project dir). Never bind a workspace.
  const cwd = asNonEmptyString(payload.cwd) ?? process.cwd();
  const agentDir = asNonEmptyString(payload.agentDir);
  const { authStorage, modelRegistry } = await createPiRegistries(agentDir);
  const sourceProvenance = isRecord(payload.sourceProvenance)
    ? payload.sourceProvenance
    : undefined;
  const { model, runtimeModelRef } = requireRuntimeModel(payload, modelRegistry);
  if (sourceProvenance && sourceProvenance.modelId !== payload.expectedTarget?.modelId) {
    throw Object.assign(new Error('Isolated text job model does not match source provenance.'), {
      code: 'provenance-mismatch',
    });
  }
  const thinkingLevel = normalizeThinkingLevel(payload.thinkingLevel);

  // No SessionManager persistence: a fresh, ephemeral session per enhance with no
  // session directory, so nothing is written to disk and no transcript survives.
  const sessionManager = SessionManager.inMemory(cwd);
  const settingsManager = SettingsManager.create(cwd, agentDir);
  // The supplied profile is the entire system prompt. No project/global resources
  // are discoverable on this isolated path.
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    systemPrompt,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();

  const { session, modelFallbackMessage } = await createAgentSession({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    sessionManager,
    resourceLoader,
    // Belt-and-suspenders tool suppression — see the isolation note above.
    noTools: 'all',
    tools: [],
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
  });
  let preparedExecution;
  try {
    preparedExecution = await executionGate.prepare({
      authStorage,
      modelRegistry,
      session,
      modelFallbackMessage,
      expectedTarget: payload.expectedTarget,
      runtimeModelRef,
      runId: payload.requestId,
    });
    if (sourceProvenance) {
      assertSameExecutionAccount(sourceProvenance, preparedExecution.identity);
    }
  } catch (error) {
    session.dispose();
    throw error;
  }

  let latestText = '';
  const runAssistantMessages = [];
  const unsubscribe = session.subscribe((event) => {
    // Stream content deltas so the renderer can show a live, cancelable preview.
    if (event.type === 'message_update') {
      const streamEvent = event.assistantMessageEvent;
      if (streamEvent?.type === 'text_delta' && streamEvent.delta) {
        emit(messageDeltaLine({ channel: 'content', delta: clampText(streamEvent.delta) }));
      }
      return;
    }
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      latestText = clampText(messageText(event.message));
      runAssistantMessages.push(event.message);
      return;
    }
    // A tool event here would mean isolation broke. There is no tool registered,
    // so this branch is unreachable; if it ever fires, surface it loudly rather
    // than silently letting a tool run on the enhance path.
    if (
      event.type === 'tool_execution_start' ||
      event.type === 'tool_execution_update' ||
      event.type === 'tool_execution_end'
    ) {
      throw Object.assign(new Error('Prompt enhance must not execute tools — isolation breach.'), {
        code: 'enhance-isolation',
      });
    }
  });

  try {
    executionGate.assertPrepared(preparedExecution, session);
    await session.prompt(text);
    const enhanced = clampText(session.getLastAssistantText() || latestText);
    const usage = await resolveApiRunUsage({
      messages: runAssistantMessages,
      provenance: preparedExecution.identity,
      model: session.model ?? model,
      modelRegistry,
    }).catch(() => undefined);
    emit(
      resultLine({
        ok: true,
        // The enhanced text rides the existing `result` line's `text` field, so no
        // new wire kind and no protocol bump. The renderer distinguishes an enhance
        // result by which Tauri command it invoked (`agent_runtime_enhance`), not by
        // an in-band marker, so no discriminator field is added here.
        text: enhanced,
        sessionId: session.sessionId,
        model: session.model ? modelSummary(session.model) : undefined,
        provenance: preparedExecution.identity,
        ...(usage ? { usage } : {}),
      }),
    );
  } finally {
    unsubscribe();
    session.dispose();
  }
}

// ── Collaboration capability profile (PR-03) ─────────────────────────────────
//
// Daily company chat: an AI employee replies to a Collaboration thread (direct,
// a mentioned member, or a roundtable speaker). Like `runEnhance` it is HOST-
// ENFORCED isolated — but unlike enhance it STREAMS (the renderer needs live
// messageDelta to upsert the visible reply). It is NOT a work run: it must NEVER
// register a tool, NEVER bind a project workspace, NEVER persist a transcript.
//
// Isolation, enforced three ways so a regression can't silently re-arm tools (the
// same belt-and-suspenders as enhance):
//   1. `noTools: 'all'`  — the SDK starts with NO tools enabled.
//   2. `tools: []`       — the explicit allowlist enables nothing on top.
//   3. resourceLoader carries ONLY `appendSystemPrompt` (the persona + collab
//      context packet) and ZERO `extensionFactories` — no permission gate, no
//      delegation, no publish, no mission bridge, no `ctx.ui` binding.
//
// The collaborationThreadId + employeeId correlation scope is NOT a project
// workspace. companyId is validated at the Tauri boundary and is not forwarded
// because this ephemeral host does not persist a session. The persona and
// participant roster ride in `systemPromptAppend` as identity CONTEXT only —
// never a delegate roster (no `roster` is read here, and no delegate tool is
// ever registered).
async function runCollaboration(payload) {
  const executionGate = createRequestExecutionTargetGate(payload);
  const text = asNonEmptyString(payload.text);
  if (!text) {
    throw Object.assign(new Error('Collaboration requests must include text.'), {
      code: 'invalid-request',
    });
  }
  // A neutral cwd (Rust passes a non-project dir). Never bind a workspace.
  const cwd = asNonEmptyString(payload.cwd) ?? process.cwd();
  const agentDir = asNonEmptyString(payload.agentDir);
  const { authStorage, modelRegistry } = await createPiRegistries(agentDir);
  const { model, runtimeModelRef } = requireRuntimeModel(payload, modelRegistry);
  const thinkingLevel = normalizeThinkingLevel(payload.thinkingLevel);
  const collaborationProfile = normalizeCollaborationProfile(payload.collaborationProfile);
  const collaborationRead = collaborationProfile === 'collaboration_read';

  // No SessionManager persistence: a fresh, ephemeral session with no session
  // directory, so nothing is written to disk and no transcript survives. The
  // renderer owns the persisted collaboration message / turn rows.
  const sessionManager = SessionManager.inMemory(cwd);
  const settingsManager = SettingsManager.create(cwd, agentDir);
  // The persona + collaboration context packet is the ONLY appended prompt; NO
  // extension factories. `systemPromptAppend` is built renderer-side and carries
  // the speaking employee's persona, the thread's reply policy, the participant
  // identities, the recent message window, and the explicit "daily chat, no tools,
  // no project work" instruction (the spec's Context packet).
  const systemPromptAppend = asNonEmptyString(payload.systemPromptAppend);
  const appendSystemPrompt = systemPromptAppend ? [systemPromptAppend] : [];
  const rawMcpTools = Array.isArray(payload.mcpTools) ? payload.mcpTools : [];
  const mcpTools = collaborationRead ? rawMcpTools.filter((tool) => !isWriteMcpTool(tool)) : [];
  const mcpHasCatalog = mcpTools.length > 0;
  const extensionFactories = [];
  // collaboration_read always gets MCP discovery (search+describe); mcp_call is
  // added below only with a read-scoped catalog. Daily chat keeps no MCP surface.
  if (collaborationRead) {
    extensionFactories.push(
      createMcpBridgeExtensionFactory({
        mcpTools,
        requestMcpResult: mcpChannel.requestMcpResult,
        emit,
        threadId: asNonEmptyString(payload.collaborationThreadId),
        rootRunId: asNonEmptyString(payload.requestId),
        employeeId: asNonEmptyString(payload.employeeId),
      }),
    );
  }
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    ...(extensionFactories.length > 0 ? { extensionFactories } : {}),
    ...(appendSystemPrompt.length > 0 ? { appendSystemPrompt } : {}),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const collaborationTools = collaborationToolAllowlist(collaborationProfile);
  if (collaborationRead) {
    collaborationTools.push('mcp_search_tools', 'mcp_describe_tool');
    if (mcpHasCatalog) collaborationTools.push('mcp_call');
  }

  const { session, modelFallbackMessage } = await createAgentSession({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    sessionManager,
    resourceLoader,
    // Belt-and-suspenders tool suppression — see the isolation note above. The
    // tool list is the collaboration profile's allowlist; `strict` (the default)
    // is the current zero-tools daily chat. `collaboration_read` (E2) relaxes
    // noTools + the isolation throw to permit the read-only allowlist; in E1 the
    // renderer never sets it, so this stays behavior-identical to `tools: []`.
    ...(collaborationRead ? {} : { noTools: 'all' }),
    tools: collaborationTools,
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
  });
  if (collaborationRead && rawMcpTools.some(isWriteMcpTool)) {
    await session.bindExtensions({ uiContext: createForwardingUiContext(), mode: 'rpc' });
  }
  let preparedExecution;
  try {
    preparedExecution = await executionGate.prepare({
      authStorage,
      modelRegistry,
      session,
      modelFallbackMessage,
      expectedTarget: payload.expectedTarget,
      runtimeModelRef,
      runId: payload.requestId,
    });
  } catch (error) {
    session.dispose();
    throw error;
  }

  let latestText = '';
  let activeReasoningText = '';
  let latestReasoningText = '';
  let emittedReasoning = false;
  const runAssistantMessages = [];
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'agent_start') {
      emit(
        startedLine({
          sessionId: session.sessionId,
          sessionFile: session.sessionFile,
          model: session.model ? modelSummary(session.model) : undefined,
          modelFallbackMessage,
        }),
      );
      return;
    }
    if (event.type === 'message_update') {
      const streamEvent = event.assistantMessageEvent;
      if (streamEvent?.type === 'text_delta' && streamEvent.delta) {
        emit(messageDeltaLine({ channel: 'content', delta: clampText(streamEvent.delta) }));
      }
      if (streamEvent?.type === 'thinking_delta' && streamEvent.delta) {
        activeReasoningText += streamEvent.delta;
        emittedReasoning = true;
        emit(messageDeltaLine({ channel: 'reasoning', delta: clampText(streamEvent.delta) }));
      }
      return;
    }
    if (event.type === 'message_end') {
      if (event.message?.role === 'assistant') {
        const reasoningText = clampText(messageThinking(event.message) || activeReasoningText);
        if (reasoningText && !activeReasoningText.trim()) {
          emittedReasoning = true;
          emit(messageDeltaLine({ channel: 'reasoning', delta: reasoningText }));
        }
        latestReasoningText = reasoningText;
        activeReasoningText = '';
        latestText = clampText(messageText(event.message));
        runAssistantMessages.push(event.message);
        emit(
          messageEndLine({
            text: latestText,
            stopReason: event.message.stopReason,
            errorMessage: event.message.errorMessage,
          }),
        );
      }
      return;
    }
    // Strict remains zero-tools. collaboration_read allows only read/search and
    // read-only MCP meta tools; any forbidden tool event is an isolation breach.
    if (
      event.type === 'tool_execution_start' ||
      event.type === 'tool_execution_update' ||
      event.type === 'tool_execution_end'
    ) {
      const toolName = typeof event.toolName === 'string' ? event.toolName : '';
      const forbidden = COLLABORATION_FORBIDDEN_TOOLS.includes(toolName);
      if (!collaborationRead || forbidden) {
        throw Object.assign(
          new Error(`Collaboration must not execute tool "${toolName}" — isolation breach.`),
          { code: 'collaboration-isolation' },
        );
      }
    }
  });

  try {
    executionGate.assertPrepared(preparedExecution, session);
    await session.prompt(text);
    const fallbackReasoning = clampText(messageThinking(lastAssistantMessage(session)));
    const finalReasoning = clampText(latestReasoningText || fallbackReasoning);
    if (fallbackReasoning && !emittedReasoning) {
      emit(messageDeltaLine({ channel: 'reasoning', delta: fallbackReasoning }));
    }
    const finalText = clampText(session.getLastAssistantText() || latestText);
    const rootUsage = await resolveApiRunUsage({
      messages: runAssistantMessages,
      provenance: preparedExecution.identity,
      model: session.model ?? model,
      modelRegistry,
    }).catch(() => undefined);
    emit(
      resultLine({
        ok: true,
        // The reply rides the existing `result` line — no new wire kind, no
        // protocol bump. The renderer knows it is a collaboration result by which
        // Tauri command it invoked (`agent_runtime_collaborate`).
        text: finalText,
        reasoning: finalReasoning || undefined,
        sessionId: session.sessionId,
        model: session.model ? modelSummary(session.model) : undefined,
        provenance: preparedExecution.identity,
        ...(rootUsage ? { usage: rootUsage } : {}),
      }),
    );
  } finally {
    unsubscribe();
    session.dispose();
  }
}

// The host is line-delimited on stdin: the FIRST line is the execute/status
// payload, and (in Ask mode) every later line is a `uiResponse` answering a
// `uiRequest` the host emitted mid-run. stdin is read as a stream so the agent
// loop and response delivery run concurrently — the gate's awaited prompt
// resolves when its matching response line lands.
function main() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  let sawPayload = false;
  let statusInFlight = false;
  // The run settled (status emitted or prompt resolved): readline keeps stdin
  // open as an extension UI response channel, so exit explicitly rather than
  // waiting for EOF.
  const finishHost = async () => {
    if (hostTerminating) return;
    hostTerminating = true;
    await shutdownActiveWork({ abort: false });
    rl.close();
    process.exit(0);
  };

  const stopForSignal = (signal) => {
    if (hostTerminating) return;
    hostTerminating = true;
    void shutdownActiveWork({ abort: true }).finally(() => {
      rl.close();
      process.exit(signal === 'SIGTERM' ? 143 : 129);
    });
  };
  process.once('SIGTERM', () => stopForSignal('SIGTERM'));
  process.once('SIGHUP', () => stopForSignal('SIGHUP'));

  rl.on('line', (raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (!sawPayload) {
      sawPayload = true;
      let payload;
      try {
        payload = JSON.parse(trimmed);
      } catch (error) {
        fail(error);
        return;
      }
      // Protocol handshake first: lets the Rust host detect a stale bundled host
      // before it processes any event line.
      emit(readyLine());
      if (payload.mode === 'status') {
        statusInFlight = true;
        void piStatus(payload).then(finishHost).catch(fail);
        return;
      }
      if (payload.mode === 'saveProvider') {
        statusInFlight = true;
        void piSaveProvider(payload).then(finishHost).catch(fail);
        return;
      }
      try {
        payload = decodePiRequestPayload(payload);
      } catch (error) {
        fail(error);
        return;
      }
      if (payload.mode === 'enhance') {
        // Dedicated one-shot enhance path: no tools, no workspace, no persistence,
        // no extension-UI stdin channel. Single completion → finish.
        runEnhance(payload).then(finishHost, fail);
        return;
      }
      if (payload.mode === 'collaborate') {
        // Collaboration capability profile (PR-03): STREAMING (messageDelta) but
        // host-enforced zero tools / no workspace / no persistence — daily company
        // chat, never a work run. Single completion → finish.
        runCollaboration(payload).then(finishHost, fail);
        return;
      }
      runPrompt(payload).then(finishHost, fail);
      return;
    }
    // Subsequent lines answer a uiRequest ({ id, confirmed?|value?|cancelled? })
    // or an intercepted mcpCall ({ id, ok, content?|isError?|error? }). The `ui-`
    // / `mcp-` id namespaces keep the two dispatch maps from colliding, so routing
    // the same parsed line through both resolvers is safe (each is a no-op unless
    // the id is in its own pending map).
    try {
      const msg = JSON.parse(trimmed);
      activeExecutionTargetGate?.resolveAck(msg);
      resolveUiResponse(msg);
      resolveRuntimeControl(msg);
      mcpChannel.resolveMcpResult(msg);
      worktreeChannel.resolveWorktreeResult(msg);
      verifyChannel.resolveVerifyResult(msg);
    } catch {
      // Ignore malformed response lines rather than crashing the run.
    }
  });

  // Parent closed stdin (process teardown / abort) — release any parked prompts
  // and fail any parked MCP calls so the loop unwinds.
  rl.on('close', () => {
    if (statusInFlight) return;
    rejectAllUiRequests();
    mcpChannel.rejectAllMcpCalls();
    worktreeChannel.rejectAllWorktreeCalls();
    verifyChannel.rejectAllVerifyCalls();
    if (!hostTerminating) {
      hostTerminating = true;
      void shutdownActiveWork({ abort: true }).finally(() => process.exit(1));
    }
  });
}

main();
