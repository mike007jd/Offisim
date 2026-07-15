import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import stripJsonComments from 'strip-json-comments';
import { RUN_FAILURE_KINDS, classifyRunFailure } from './pi-agent-host-wire.mjs';

function readJson(path) {
  return JSON.parse(stripJsonComments(readFileSync(path, 'utf8'), { trailingCommas: true }));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractNamedFunction(source, name) {
  const functionStart = source.indexOf(`function ${name}(`);
  assert(functionStart >= 0, `could not find function ${name}`);
  const start =
    source.slice(Math.max(0, functionStart - 6), functionStart) === 'async '
      ? functionStart - 6
      : functionStart;
  const parametersOpen = source.indexOf('(', start);
  let parameterDepth = 0;
  let parametersClose = -1;
  for (let index = parametersOpen; index < source.length; index += 1) {
    if (source[index] === '(') parameterDepth += 1;
    if (source[index] === ')') {
      parameterDepth -= 1;
      if (parameterDepth === 0) {
        parametersClose = index;
        break;
      }
    }
  }
  assert(parametersClose >= 0, `could not find parameters for function ${name}`);
  const open = source.indexOf('{', parametersClose);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`could not extract function ${name}`);
}

function extractObjectLiteral(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, `could not find object marker ${marker}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`could not extract object marker ${marker}`);
}

function parseHostResult(stdout, label) {
  for (const line of stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.kind === 'result') return event;
  }
  throw new Error(`${label} did not emit a result line`);
}

function runHost(scriptPath, payload, label) {
  const result = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  assert(result.status === 0, `${label} failed: ${result.stderr || result.stdout}`);
  return parseHostResult(result.stdout, label);
}

function ensureBundledHost(scriptPath) {
  if (existsSync(scriptPath)) return;

  console.log(`[harness:pi-agent-host] rebuilding missing bundle ${scriptPath}`);
  const result = spawnSync(process.execPath, ['scripts/build-pi-agent-host.mjs'], {
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(`Failed to start Pi Agent host bundle build: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Pi Agent host bundle build failed (exit ${result.status ?? 'unknown'}${result.signal ? `, signal ${result.signal}` : ''})`,
    );
  }
  if (!existsSync(scriptPath)) {
    throw new Error(`Pi Agent host bundle build succeeded but did not create ${scriptPath}`);
  }
}

const HOST_SCRIPT = 'scripts/tauri-pi-agent-host.entry.mjs';
const BUNDLED_HOST_SCRIPT = 'apps/desktop/src-tauri/resources/pi-agent-host.mjs';
ensureBundledHost(BUNDLED_HOST_SCRIPT);
const rootPackage = readJson('package.json');
const desktopPackage = readJson('apps/desktop/package.json');
const tauriConfig = readJson('apps/desktop/src-tauri/tauri.conf.json');
const rustHostSource = globSync('apps/desktop/src-tauri/src/pi_agent_host/*.rs')
  .sort()
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');
const nodeHostSource = readFileSync(HOST_SCRIPT, 'utf8');
const bundledNodeHostSource = readFileSync(BUNDLED_HOST_SCRIPT, 'utf8');
const piCodingAgentEntryUrl = import.meta.resolve('@earendil-works/pi-coding-agent');
const piCodingAgentDist = dirname(fileURLToPath(piCodingAgentEntryUrl));
const piDependencyRequire = createRequire(piCodingAgentEntryUrl);
// pi-agent-core intentionally has no CommonJS package-root export, but it does
// export package.json. Resolve that supported subpath from coding-agent's own
// dependency graph so the gate works with nested or hoisted installs on Node 22/24.
const piAgentCoreDist = join(
  dirname(piDependencyRequire.resolve('@earendil-works/pi-agent-core/package.json')),
  'dist',
);
const piAgentSessionSource = readFileSync(join(piCodingAgentDist, 'core/agent-session.js'), 'utf8');
const piAgentLoopSource = readFileSync(join(piAgentCoreDist, 'agent-loop.js'), 'utf8');
const piAgentSource = readFileSync(join(piAgentCoreDist, 'agent.js'), 'utf8');
const enhanceHostSource = extractNamedFunction(nodeHostSource, 'runEnhance');
const collaborationHostSource = extractNamedFunction(nodeHostSource, 'runCollaboration');
const mcpBridgeSource = readFileSync('scripts/pi-mcp-bridge-extension.mjs', 'utf8');
const childSupervisorSource = readFileSync('scripts/pi-child-supervisor.mjs', 'utf8');
const delegationExtensionSource = readFileSync('scripts/pi-delegation-extension.mjs', 'utf8');
const wireSource = readFileSync('scripts/pi-agent-host-wire.mjs', 'utf8');
const executePayloadSource = rustHostSource.slice(
  rustHostSource.indexOf('fn sidecar_payload'),
  rustHostSource.indexOf('/// Build the Prompt Enhance sidecar payload'),
);
const collaboratePayloadSource = rustHostSource.slice(
  rustHostSource.indexOf('fn collaborate_payload'),
  rustHostSource.indexOf('/// Write the execute/status payload'),
);
const desktopRuntimeScopeSource = readFileSync(
  'apps/desktop/renderer/src/data/employee-persona.ts',
  'utf8',
);
const desktopAgentRuntimeSource = readFileSync(
  'apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts',
  'utf8',
);
const conversationRunControllerSource = readFileSync(
  'apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.ts',
  'utf8',
);
const composerAttachmentSource = readFileSync(
  'apps/desktop/renderer/src/assistant/composer/composer-attachment-store.ts',
  'utf8',
);
const officeThreadSource = readFileSync(
  'apps/desktop/renderer/src/assistant/OfficeThread.tsx',
  'utf8',
);
const appSource = readFileSync('apps/desktop/renderer/src/App.tsx', 'utf8');

{
  const calls = [];
  const SessionManager = {
    continueRecent: (...args) => {
      calls.push(['continue', ...args]);
      return 'continued';
    },
    create: (...args) => {
      calls.push(['fresh', ...args]);
      return 'fresh';
    },
    open: (...args) => {
      calls.push(['open', ...args]);
      return 'opened';
    },
  };
  const asNonEmptyString = new Function(
    `${extractNamedFunction(nodeHostSource, 'asNonEmptyString')}; return asNonEmptyString;`,
  )();
  const createRootSessionManager = new Function(
    'SessionManager',
    'asNonEmptyString',
    'resolve',
    'dirname',
    'existsSync',
    `${extractNamedFunction(nodeHostSource, 'createRootSessionManager')}; return createRootSessionManager;`,
  )(SessionManager, asNonEmptyString, resolve, dirname, existsSync);
  const sessionDir = mkdtempSync(join(tmpdir(), 'offisim-pi-resume-'));
  const sessionFile = join(sessionDir, 'recorded.jsonl');
  const outsideFile = join(tmpdir(), 'offisim-outside-session.jsonl');
  writeFileSync(sessionFile, '{"type":"session"}\n');
  writeFileSync(outsideFile, '{"type":"session"}\n');
  try {
    assert(
      createRootSessionManager({}, '/workspace', sessionDir) === 'continued',
      'ordinary turns must continue the thread recent session',
    );
    assert(
      createRootSessionManager({ resumeMode: 'fresh' }, '/workspace', sessionDir) === 'fresh',
      'objective-only recovery must create a fresh Pi session',
    );
    assert(
      createRootSessionManager(
        { resumeMode: 'open', resumeSessionFile: sessionFile },
        '/workspace',
        sessionDir,
      ) === 'opened',
      'durable recovery must open the exact recorded Pi session',
    );
    const openCall = calls.find((call) => call[0] === 'open');
    assert(
      openCall?.[1] === resolve(sessionFile) && openCall?.[2] === resolve(sessionDir),
      'exact recovery must bind SessionManager.open to the recorded file and thread directory',
    );
    let rejectedOutside = false;
    try {
      createRootSessionManager(
        { resumeMode: 'open', resumeSessionFile: outsideFile },
        '/workspace',
        sessionDir,
      );
    } catch (error) {
      rejectedOutside = error?.code === 'invalid-session';
    }
    assert(rejectedOutside, 'recovery must reject a session file outside the thread directory');
  } finally {
    rmSync(sessionDir, { recursive: true, force: true });
    rmSync(outsideFile, { force: true });
  }
}

{
  // Exercise the production FIFO channel source directly. Four concurrent Pi UI
  // primitives must surface one at a time, and closing stdin must cancel both the
  // visible request and requests that have not been emitted yet.
  const createUiRequestChannel = new Function(
    'uiRequestLine',
    `${extractNamedFunction(nodeHostSource, 'createUiRequestChannel')}; return createUiRequestChannel;`,
  )((fields) => ({ kind: 'uiRequest', ...fields }));
  const emitted = [];
  const hostCancellations = [];
  const uiTimeline = [];
  const timers = new Map();
  let timerSeq = 0;
  const clearedTimers = new Set();
  const setTestTimeout = (callback) => {
    timerSeq += 1;
    const id = {
      value: timerSeq,
      unref() {},
    };
    timers.set(id, callback);
    return id;
  };
  const clearTestTimeout = (id) => {
    clearedTimers.add(id);
    timers.delete(id);
  };
  const trackedSignal = () => {
    let abortHandler;
    let removed = 0;
    return {
      signal: {
        aborted: false,
        addEventListener(type, handler) {
          assert(type === 'abort', 'UI request may only subscribe to abort');
          abortHandler = handler;
        },
        removeEventListener(type, handler) {
          assert(type === 'abort', 'UI request may only remove abort');
          if (abortHandler === handler) abortHandler = undefined;
          removed += 1;
        },
      },
      abort() {
        this.signal.aborted = true;
        abortHandler?.();
      },
      removedCount() {
        return removed;
      },
    };
  };
  const channel = createUiRequestChannel(
    (line) => {
      emitted.push(line);
      uiTimeline.push(`ui:${line.method}`);
    },
    {
      setTimeout: setTestTimeout,
      clearTimeout: clearTestTimeout,
      onHostCancelled: (event) => {
        hostCancellations.push(event);
        uiTimeline.push(`cancel:${event.reason}`);
      },
    },
  );
  const alreadyAborted = trackedSignal();
  alreadyAborted.abort();
  const abortedBeforeAdmission = await channel.requestUiResponse(
    'confirm',
    { title: 'Already cancelled' },
    { signal: alreadyAborted.signal },
  );
  assert(
    abortedBeforeAdmission.cancelled === true && emitted.length === 0,
    'an already-aborted UI request must cancel without entering the visible FIFO',
  );
  assert(
    hostCancellations[0]?.reason === 'aborted',
    'an already-aborted UI request must surface host cancellation lifecycle',
  );
  const firstSignal = trackedSignal();
  const first = channel.requestUiResponse(
    'confirm',
    { title: 'Confirm first' },
    { signal: firstSignal.signal, timeout: 10_000 },
  );
  const secondSignal = trackedSignal();
  const second = channel.requestUiResponse(
    'select',
    {
      title: 'Select second',
      options: ['A', 'B'],
    },
    { signal: secondSignal.signal },
  );
  const third = channel.requestUiResponse('input', { title: 'Input third' });
  const fourth = channel.requestUiResponse('editor', { title: 'Edit fourth', prefill: 'draft' });

  assert(
    emitted.map((line) => line.method).join(',') === 'confirm',
    'concurrent Pi UI requests must emit only the FIFO head',
  );
  channel.resolveUiResponse({ id: emitted[0].id, confirmed: true });
  assert((await first).confirmed === true, 'the FIFO head must receive its matching response');
  assert(firstSignal.removedCount() === 1, 'settled requests must remove their abort listener');
  assert(
    clearedTimers.size === 1 && timers.size === 0,
    'settled requests must clear their timeout',
  );
  assert(
    emitted.map((line) => line.method).join(',') === 'confirm,select',
    'settling the FIFO head must reveal exactly one next request',
  );
  secondSignal.abort();
  assert((await second).cancelled === true, 'an aborted FIFO head must cancel');
  assert(
    uiTimeline.indexOf('cancel:aborted', 1) < uiTimeline.indexOf('ui:input'),
    'host cancellation lifecycle must precede the next visible UI request',
  );

  const timed = channel.requestUiResponse(
    'input',
    { title: 'Expires while queued' },
    { timeout: 10_000 },
  );
  const timeoutCallback = [...timers.values()][0];
  assert(timeoutCallback, 'timed UI requests must schedule their host timeout');
  timeoutCallback();
  assert((await timed).cancelled === true, 'a timed-out queued request must cancel');
  assert(
    hostCancellations.some((event) => event.reason === 'timeout'),
    'a UI timeout must surface host cancellation lifecycle',
  );

  channel.rejectAllUiRequests();
  const cancelled = await Promise.all([third, fourth]);
  assert(
    cancelled.every((response) => response.cancelled === true),
    'stdin EOF must cancel the visible and undisplayed Pi UI requests',
  );
  assert(
    hostCancellations.filter((event) => event.reason === 'closed').length === 2,
    'stdin EOF must surface cancellation lifecycle for every unresolved UI request',
  );
  assert(
    emitted.map((line) => line.method).join(',') === 'confirm,select,input',
    'closing the channel must not emit or re-park queued requests',
  );
  const afterClose = await channel.requestUiResponse('confirm', { title: 'Too late' });
  assert(
    afterClose.cancelled === true && emitted.length === 3,
    'requests created after stdin closes must cancel immediately without emission',
  );
}
{
  const asNonEmptyString = new Function(
    `${extractNamedFunction(nodeHostSource, 'asNonEmptyString')}; return asNonEmptyString;`,
  )();
  const normalizePromptImages = new Function(
    'asNonEmptyString',
    `${extractNamedFunction(nodeHostSource, 'normalizePromptImages')}; return normalizePromptImages;`,
  )(asNonEmptyString);
  const controlPayloadFingerprint = new Function(
    'createHash',
    'normalizePromptImages',
    `${extractNamedFunction(nodeHostSource, 'controlPayloadFingerprint')}; return controlPayloadFingerprint;`,
  )(createHash, normalizePromptImages);
  const rootControlMessage = new Function(
    'normalizePromptImages',
    'ROOT_CONTROL_CUSTOM_TYPE',
    'controlPayloadFingerprint',
    `${extractNamedFunction(nodeHostSource, 'rootControlMessage')}; return rootControlMessage;`,
  )(normalizePromptImages, 'offisim.control', controlPayloadFingerprint);
  const rootControlFromCustomMessage = new Function(
    'ROOT_CONTROL_CUSTOM_TYPE',
    'asNonEmptyString',
    'controlPayloadFingerprint',
    `${extractNamedFunction(nodeHostSource, 'rootControlFromCustomMessage')}; return rootControlFromCustomMessage;`,
  )('offisim.control', asNonEmptyString, controlPayloadFingerprint);
  const rootRunId = 'root-run-durable-control';
  const deliverRootControl = new Function(
    'rootControlMessage',
    'activeRootRunId',
    `${extractNamedFunction(nodeHostSource, 'deliverRootControl')}; return deliverRootControl;`,
  )(rootControlMessage, rootRunId);
  const control = {
    action: 'steer',
    controlId: 'stable-control-id',
    text: 'Adjust the active turn.',
    images: [{ data: 'aW1hZ2U=', mimeType: 'image/png' }],
  };
  let streamingMessage = null;
  let streamingOptions = null;
  let streamingAccepted = false;
  const streamingSession = {
    async sendCustomMessage(message, options) {
      streamingMessage = message;
      streamingOptions = options;
    },
  };
  await deliverRootControl(streamingSession, control, () => {
    streamingAccepted = true;
  });
  assert(
    streamingAccepted &&
      streamingMessage?.customType === 'offisim.control' &&
      streamingMessage.details?.rootRunId === rootRunId &&
      streamingMessage.details?.controlId === control.controlId &&
      streamingMessage.details?.action === 'steer' &&
      streamingMessage.details?.payloadFingerprint === controlPayloadFingerprint(control) &&
      streamingMessage.content.some((part) => part.type === 'image') &&
      streamingOptions?.deliverAs === 'steer' &&
      streamingOptions?.triggerTurn === true,
    'streaming controls must use one Pi custom message carrying content, images, action, root scope, and a durable payload fingerprint',
  );

  let releaseIdle;
  let acceptedBeforeIdleResolved = false;
  let idleOptions = null;
  const idleSession = {
    sendCustomMessage(_message, options) {
      idleOptions = options;
      return new Promise((resolve) => {
        releaseIdle = resolve;
      });
    },
  };
  const idleDelivery = deliverRootControl(
    idleSession,
    {
      action: 'followUp',
      controlId: 'idle-tail-control',
      text: 'Run this next.',
      images: [{ data: 'aW1hZ2U=', mimeType: 'image/png' }],
    },
    () => {
      acceptedBeforeIdleResolved = true;
    },
  );
  await Promise.resolve();
  assert(
    acceptedBeforeIdleResolved === true &&
      idleOptions?.deliverAs === 'followUp' &&
      idleOptions?.triggerTurn === true,
    'an idle-tail control must ACK then trigger a Pi follow-up turn instead of parking forever',
  );
  releaseIdle();
  await idleDelivery;

  const acceptedRootControls = { steer: [control], followUp: [] };
  const consumedLedger = new Map([
    [
      control.controlId,
      {
        control,
        state: 'accepted',
        rootRunId,
        payloadFingerprint: controlPayloadFingerprint(control),
      },
    ],
  ]);
  let queueProjectionCount = 0;
  const consumeRootControlMessage = new Function(
    'rootControlFromCustomMessage',
    'activeRootRunId',
    'rootControlLedger',
    'queueMicrotask',
    'acceptedRootControls',
    'emitControlState',
    'emitRootQueueState',
    `${extractNamedFunction(nodeHostSource, 'consumeRootControlMessage')}; return consumeRootControlMessage;`,
  )(
    rootControlFromCustomMessage,
    rootRunId,
    consumedLedger,
    queueMicrotask,
    acceptedRootControls,
    (acceptedControl, state) => {
      consumedLedger.set(acceptedControl.controlId, {
        ...consumedLedger.get(acceptedControl.controlId),
        control: acceptedControl,
        state,
      });
    },
    () => {
      queueProjectionCount += 1;
    },
  );
  consumeRootControlMessage({ role: 'custom', ...streamingMessage });
  await Promise.resolve();
  assert(
    consumedLedger.get(control.controlId)?.state === 'consumed' &&
      acceptedRootControls.steer.length === 0 &&
      queueProjectionCount === 1,
    'the matching Pi custom message_end must consume exactly its accepted control and update queue projection',
  );

  const { SessionManager: PiSessionManager } = await import('@earendil-works/pi-coding-agent');
  const persistenceRoot = mkdtempSync(join(tmpdir(), 'offisim-pi-control-ledger-'));
  const workspace = join(persistenceRoot, 'workspace');
  const sessionFile = join(persistenceRoot, 'control-session.jsonl');
  mkdirSync(workspace, { recursive: true });
  writeFileSync(
    sessionFile,
    `${JSON.stringify({
      type: 'session',
      version: 3,
      id: 'control-session',
      timestamp: new Date().toISOString(),
      cwd: workspace,
    })}\n${JSON.stringify({
      type: 'message',
      id: 'assistant-before-control',
      parentId: null,
      timestamp: new Date().toISOString(),
      message: { role: 'assistant', content: [], timestamp: Date.now() },
    })}\n`,
  );
  try {
    const manager = PiSessionManager.open(sessionFile, persistenceRoot, workspace);
    manager.appendCustomMessageEntry(
      streamingMessage.customType,
      streamingMessage.content,
      streamingMessage.display,
      streamingMessage.details,
    );
    const persistedControlEntry = readFileSync(sessionFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .find((entry) => entry.type === 'custom_message');
    assert(
      persistedControlEntry?.customType === 'offisim.control' &&
        persistedControlEntry.details?.payloadFingerprint === controlPayloadFingerprint(control) &&
        persistedControlEntry.content?.[0]?.text === control.text,
      'Pi JSONL must persist control metadata and the actual instruction in the same custom_message entry',
    );

    const restartedManager = PiSessionManager.open(sessionFile, persistenceRoot, workspace);
    const reopenedControl = restartedManager
      .buildSessionContext()
      .messages.find(
        (message) =>
          message.role === 'custom' &&
          message.customType === 'offisim.control' &&
          message.details?.controlId === control.controlId,
      );
    assert(
      reopenedControl?.content?.[0]?.text === control.text,
      'an exact-open session must restore the durable control into Pi model context even if the previous host crashed before the next provider call',
    );
    const rootControlLedger = new Map();
    const hydrateRootControlLedger = new Function(
      'rootControlLedger',
      'rootControlFromCustomMessage',
      `${extractNamedFunction(nodeHostSource, 'hydrateRootControlLedger')}; return hydrateRootControlLedger;`,
    )(rootControlLedger, rootControlFromCustomMessage);
    hydrateRootControlLedger(restartedManager, rootRunId);
    assert(
      rootControlLedger.get(control.controlId)?.state === 'consumed',
      'an exact-open host restart must hydrate consumed controls from the active Pi session branch',
    );

    const emitted = [];
    const pendingRootControls = [];
    const controls = new Function(
      'emit',
      'lifecycleLine',
      'rootControlLedger',
      'pendingRootControls',
      'rootControlsOpen',
      'drainRootControls',
      'asNonEmptyString',
      'uiRequestChannel',
      'activeRootSession',
      'activeChildControllers',
      'controlPayloadFingerprint',
      'activeRootRunId',
      `${extractNamedFunction(nodeHostSource, 'publishControlState')}
       ${extractNamedFunction(nodeHostSource, 'emitControlState')}
       ${extractNamedFunction(nodeHostSource, 'resolveRuntimeControl')}
       return { resolveRuntimeControl };`,
    )(
      (line) => emitted.push(line),
      ({ event, payload }) => ({ kind: 'lifecycle', event, payload }),
      rootControlLedger,
      pendingRootControls,
      true,
      () => undefined,
      asNonEmptyString,
      { resurfaceActiveRequest: () => false },
      null,
      new Map(),
      controlPayloadFingerprint,
      rootRunId,
    );
    controls.resolveRuntimeControl({ type: 'control', ...control });
    assert(
      pendingRootControls.length === 0 && emitted.at(-1)?.payload?.state === 'consumed',
      'a control retried after host restart must replay consumed without entering Pi again',
    );
    controls.resolveRuntimeControl({ type: 'control', ...control, text: 'Different instruction' });
    assert(
      pendingRootControls.length === 0 &&
        emitted.at(-1)?.payload?.state === 'rejected' &&
        rootControlLedger.get(control.controlId)?.state === 'consumed',
      'a conflicting payload after host restart must reject without corrupting the durable consumed record',
    );
  } finally {
    rmSync(persistenceRoot, { recursive: true, force: true });
  }
}
{
  // Pin the crash-window proof to the actually installed Pi 0.80.7 code. Agent
  // core admits a drained custom message into state before listeners, the
  // coding-agent listener synchronously appends its JSONL entry, and only then
  // may the loop build the next provider request. Offisim's queued microtask ACK
  // therefore cannot outrun either in-memory admission or durable recovery.
  const pendingStart = piAgentLoopSource.indexOf('// Process pending messages');
  const pendingEnd = piAgentLoopSource.indexOf('// Check for tool calls', pendingStart);
  const pendingDelivery = piAgentLoopSource.slice(pendingStart, pendingEnd);
  const messageEndIndex = pendingDelivery.indexOf('await emit({ type: "message_end", message });');
  const contextPushIndex = pendingDelivery.indexOf('currentContext.messages.push(message);');
  const providerCallIndex = pendingDelivery.indexOf('streamAssistantResponse(');
  const processEventsStart = piAgentSource.indexOf('async processEvents(event)');
  const stateAdmissionIndex = piAgentSource.indexOf(
    'this._state.messages.push(event.message);',
    processEventsStart,
  );
  const listenerIndex = piAgentSource.indexOf(
    'for (const listener of this.listeners)',
    processEventsStart,
  );
  const sessionHandlerStart = piAgentSessionSource.indexOf('_handleAgentEvent = async (event) =>');
  const hostSubscriberIndex = piAgentSessionSource.indexOf(
    'this._emit(event.type === "agent_end"',
    sessionHandlerStart,
  );
  const jsonlAppendIndex = piAgentSessionSource.indexOf(
    'this.sessionManager.appendCustomMessageEntry(',
    hostSubscriberIndex,
  );
  const subscriberToAppend = piAgentSessionSource.slice(hostSubscriberIndex, jsonlAppendIndex);
  assert(
    pendingStart >= 0 &&
      pendingEnd >= 0 &&
      messageEndIndex >= 0 &&
      contextPushIndex >= 0 &&
      providerCallIndex >= 0 &&
      messageEndIndex < contextPushIndex &&
      contextPushIndex < providerCallIndex &&
      processEventsStart >= 0 &&
      stateAdmissionIndex >= 0 &&
      listenerIndex >= 0 &&
      stateAdmissionIndex < listenerIndex &&
      sessionHandlerStart >= 0 &&
      hostSubscriberIndex >= 0 &&
      jsonlAppendIndex >= 0 &&
      hostSubscriberIndex < jsonlAppendIndex &&
      !subscriberToAppend.includes('await ') &&
      /queueMicrotask\(\(\) => \{[\s\S]*emitControlState\(current\.control, 'consumed'\)/.test(
        nodeHostSource,
      ),
    'Pi control consumption must admit state and synchronously persist JSONL before Offisim emits the terminal consumed ACK or Pi starts the next provider call',
  );
}
{
  const emitted = [];
  const rootControlLedger = new Map();
  const pendingRootControls = [];
  const asNonEmptyString = new Function(
    `${extractNamedFunction(nodeHostSource, 'asNonEmptyString')}; return asNonEmptyString;`,
  )();
  const controls = new Function(
    'emit',
    'lifecycleLine',
    'rootControlLedger',
    'pendingRootControls',
    'rootControlsOpen',
    'drainRootControls',
    'asNonEmptyString',
    'uiRequestChannel',
    'activeRootSession',
    'activeChildControllers',
    'controlPayloadFingerprint',
    'activeRootRunId',
    `${extractNamedFunction(nodeHostSource, 'publishControlState')}
     ${extractNamedFunction(nodeHostSource, 'emitControlState')}
     ${extractNamedFunction(nodeHostSource, 'resolveRuntimeControl')}
     return { resolveRuntimeControl, emitControlState };`,
  )(
    (line) => emitted.push(line),
    ({ event, payload }) => ({ kind: 'lifecycle', event, payload }),
    rootControlLedger,
    pendingRootControls,
    true,
    () => undefined,
    asNonEmptyString,
    { resurfaceActiveRequest: () => false },
    null,
    new Map(),
    (control) => JSON.stringify(control),
    'new-root-run',
  );
  const control = {
    type: 'control',
    action: 'steer',
    controlId: 'stable-control-id',
    text: 'Use the audited date.',
  };
  controls.resolveRuntimeControl(control);
  assert(
    pendingRootControls.length === 1 &&
      rootControlLedger.get(control.controlId)?.state === 'pending',
    'the first control id must enter the host queue exactly once',
  );
  controls.emitControlState(control, 'accepted');
  controls.emitControlState(control, 'consumed');
  controls.resolveRuntimeControl(control);
  assert(
    pendingRootControls.length === 1 && emitted.at(-1)?.payload?.state === 'consumed',
    'a consumed control replay must re-emit its terminal state without enqueueing again',
  );
  controls.resolveRuntimeControl({ ...control, text: 'Different instruction' });
  assert(
    pendingRootControls.length === 1 &&
      emitted.at(-1)?.payload?.state === 'rejected' &&
      rootControlLedger.get(control.controlId)?.state === 'consumed',
    'a reused control id with different content must reject without corrupting the ledger',
  );
}
{
  const createUiRequestChannel = new Function(
    'uiRequestLine',
    `${extractNamedFunction(nodeHostSource, 'createUiRequestChannel')}; return createUiRequestChannel;`,
  )((fields) => ({ kind: 'uiRequest', ...fields }));
  const emitted = [];
  const channel = createUiRequestChannel((line) => emitted.push(line));
  const response = channel.requestUiResponse('input', { title: 'Still waiting' });
  assert(channel.resurfaceActiveRequest() === true, 'a live UI request must be resurfaced');
  assert(
    emitted.length === 2 && emitted[0].id === emitted[1].id,
    'reattach must re-emit the same parked UI request id',
  );
  channel.resolveUiResponse({ id: emitted[0].id, value: 'continue' });
  assert((await response).value === 'continue', 'the resurfaced request must retain its resolver');
}
assert(
  /function createUiRequestChannel\(emitRequest, options = \{\}\)/.test(bundledNodeHostSource) &&
    bundledNodeHostSource.includes('const queuedRequests = [];') &&
    bundledNodeHostSource.includes('request.signal.removeEventListener?.'),
  'the bundled Pi host must carry the single-active FIFO UI channel and listener cleanup',
);
assert(
  /async function runPrompt\(payload\) \{[\s\S]*rootControlsOpen = false;[\s\S]*const \{ session, modelFallbackMessage \} = await createAgentSession\([\s\S]*activeRootSession = session;\s*rootControlsOpen = true;/.test(
    nodeHostSource,
  ),
  'root control admission must open only after a real root Pi session exists',
);
assert(
  /let Some\(writer\) = writer else \{\s*return Err\(format!\([\s\S]*no longer accepting UI answers/.test(
    rustHostSource,
  ),
  'Rust UI responses must fail when the run has no live stdin writer',
);

assert(
  rootPackage.scripts['build:pi-agent-host'] === 'node scripts/build-pi-agent-host.mjs',
  'root package must build the Pi Agent host',
);
assert(
  rootPackage.dependencies['@earendil-works/pi-coding-agent'] === '0.80.7',
  'Pi Agent must stay exactly pinned to the 0.80.7 SDK verified on 2026-07-15',
);
assert(!('provider:check' in rootPackage.scripts), 'provider:check must not be a validation gate');
assert(
  rootPackage.scripts.validate.includes('pnpm harness:pi-agent-host'),
  'validate must include the Pi Agent host harness',
);
assert(
  rootPackage.scripts['check:pi-wire-contract'] === 'node scripts/check-pi-wire-contract.mjs',
  'root package must run the Pi Agent wire-contract gate',
);
assert(
  rootPackage.scripts.validate.includes('pnpm check:pi-wire-contract'),
  'validate must include the Pi Agent wire-contract gate',
);
assert(
  desktopPackage.scripts['build:frontend'].includes('build:pi-agent-host'),
  'desktop build must bundle the Pi Agent host',
);
assert(
  !desktopPackage.scripts['build:frontend'].includes('build:claude-agent-host') &&
    !desktopPackage.scripts['build:frontend'].includes('build:codex-agent-host'),
  'desktop build must not bundle Claude/Codex sidecars',
);
assert(
  tauriConfig.bundle.resources.includes('resources/pi-agent-host.mjs'),
  'release bundle must include the Pi Agent host',
);
assert(
  !tauriConfig.bundle.resources.some((resource) => /claude|codex/u.test(resource)),
  'release bundle must not include Claude/Codex sidecar resources',
);
assert(
  /pub struct PiAgentExecuteRequest[\s\S]*mcp_tools: Option<serde_json::Value>/.test(
    rustHostSource,
  ),
  'execute request must deserialize mcpTools so Office runs can receive employee MCP grants',
);
assert(
  /pub struct PiAgentExecuteRequest[\s\S]*images: Option<serde_json::Value>/.test(rustHostSource) &&
    /"images": req\.images/.test(executePayloadSource),
  'native image payloads must cross the Rust execute request and opaque sidecar payload',
);
assert(
  /function normalizePromptImages\(value\)/.test(nodeHostSource) &&
    nodeHostSource.includes('png|jpe?g|gif|webp') &&
    /session\.prompt\(text, promptImages\.length > 0 \? \{ images: promptImages \}/.test(
      nodeHostSource,
    ) &&
    /images: input\.images \? \[\.\.\.input\.images\] : null/.test(desktopAgentRuntimeSource) &&
    /file\.arrayBuffer\(\)/.test(composerAttachmentSource) &&
    /readFile\(file\.path\)/.test(officeThreadSource),
  'Office attachments must deliver actual native image bytes to Pi instead of path-only metadata',
);
assert(
  /resume_mode: Option<String>/.test(rustHostSource) &&
    /resume_session_file: Option<String>/.test(rustHostSource) &&
    /"resumeMode"\.into\(\)/.test(executePayloadSource) &&
    /SessionManager\.open\(resolvedSessionFile, resolvedSessionDir, cwd\)/.test(nodeHostSource) &&
    /SessionManager\.create\(cwd, sessionDir\)/.test(nodeHostSource) &&
    /resumeInterrupted\(scopeCompanyId, runId\)/.test(
      readFileSync(
        'apps/desktop/renderer/src/runtime/recovery/useInterruptedRunRecovery.ts',
        'utf8',
      ),
    ),
  'durable Resume must stay controller-owned and select exact-open versus fresh Pi sessions explicitly',
);
assert(
  /event\.altKey \? 'followUp' : 'steer'/.test(officeThreadSource) &&
    /event\.shiftKey/.test(officeThreadSource) &&
    /nativeEvent\.isComposing/.test(officeThreadSource) &&
    /submitOnEnter=\{!isRunning\}/.test(officeThreadSource),
  'running composer keyboard semantics must match Pi: Enter steer, Option-Enter follow-up, Shift-Enter newline, IME untouched',
);
assert(
  !appSource.includes('detachCompany') && !appSource.includes('disposeDesktopAgentRuntime'),
  'company navigation must not detach a live controller before its terminal ChatMessage is durable',
);
assert(
  /fn sidecar_payload\([\s\S]*agent_dir: Option<&Path>[\s\S]*"mode": "execute"[\s\S]*"mcpTools": req\.mcp_tools/.test(
    executePayloadSource,
  ),
  'execute sidecar payload must be AppHandle-free and forward mcpTools to the Node Pi host',
);
assert(
  /"projectId": req\.project_id/.test(executePayloadSource),
  'execute sidecar payload must forward projectId so delegation child runs inherit the project scope (a dropped projectId crashed the Node host with "projectId is not defined")',
);
assert(
  /"employeeId": req\.employee_id/.test(executePayloadSource),
  'execute sidecar payload must forward employeeId so publish-artifact and mission-bridge events keep employee attribution',
);
assert(
  /delegation_limits: Option<serde_json::Value>/.test(rustHostSource) &&
    /if let Some\(delegation_limits\)[\s\S]*\.insert\("delegationLimits"\.into\(\), delegation_limits\.clone\(\)\)/.test(
      executePayloadSource,
    ) &&
    /delegationLimits: input\.delegationLimits/.test(desktopAgentRuntimeSource),
  'optional delegationLimits must cross renderer → opaque Rust → Node without appearing on absent plain-chat requests',
);
assert(
  /"skillPaths": req\.skill_paths/.test(executePayloadSource) &&
    /additionalSkillPaths: skillPaths/.test(nodeHostSource) &&
    /additionalSkillPaths: skillPaths/.test(childSupervisorSource) &&
    /additionalSkillPaths: skillPaths/.test(bundledNodeHostSource) &&
    /repos\.skills\.listByCompany\(companyId\)/.test(desktopRuntimeScopeSource) &&
    /skillPaths: skillPathsForEmployee\(e\.employee_id\)/.test(desktopRuntimeScopeSource),
  'vault-authoritative company + employee skills must cross the renderer/Rust wire and reach Pi native resource loaders for root and child sessions',
);
assert(
  !/"companyId": req\.company_id/.test(executePayloadSource),
  'execute sidecar payload must not emit companyId because the Node execute host has no companyId consumer',
);
assert(
  /fn collaborate_payload\([\s\S]*agent_dir: Option<&Path>/.test(collaboratePayloadSource) &&
    !/"companyId": req\.company_id|"capabilityProfile": req\.capability_profile/.test(
      collaboratePayloadSource,
    ),
  'collaboration payload must be AppHandle-free and omit companyId/capabilityProfile fields that the Node host does not consume',
);
assert(
  /payload = decodePiRequestPayload\(payload\)/.test(nodeHostSource) &&
    /export function decodePiRequestPayload/.test(wireSource),
  'the production Node entrypoint must pass execute/enhance/collaborate payloads through the shared request decoder',
);
for (const [label, source] of [
  ['enhance', enhanceHostSource],
  ['collaboration', collaborationHostSource],
]) {
  assert(
    /SessionManager\.inMemory\(cwd\)/.test(source) && !/SessionManager\.create\(cwd\)/.test(source),
    `${label} must use an in-memory Pi session so its transcript never reaches session JSONL`,
  );
  for (const flag of [
    'noExtensions',
    'noSkills',
    'noPromptTemplates',
    'noThemes',
    'noContextFiles',
  ]) {
    assert(
      new RegExp(`${flag}:\\s*true`).test(source),
      `${label} must disable Pi auto-discovery via ${flag}`,
    );
  }
}
assert(
  /extensionFactories\.length > 0 \? \{ extensionFactories \} : \{\}/.test(collaborationHostSource),
  'collaboration_read must retain its explicit inline MCP extension factory while discovery stays disabled',
);
assert(
  /ProjectTrustStore/.test(nodeHostSource) &&
    /hasTrustRequiringProjectResources/.test(nodeHostSource) &&
    /function resolveHeadlessProjectTrust/.test(nodeHostSource) &&
    /SettingsManager\.create\(cwd, agentDir, \{ projectTrusted \}\)/.test(nodeHostSource) &&
    /createSettingsManager:\s*\(childCwd\)/.test(nodeHostSource) &&
    /const childSettingsManager = ctx\.createSettingsManager/.test(childSupervisorSource),
  'root and delegated worktrees must honor Pi project trust before loading project settings, skills, prompts, or extensions',
);

{
  // Pi loads inline factories independently from discovered extensions. Exercise
  // that SDK behavior so the isolation flags cannot silently remove the explicit
  // collaboration_read MCP bridge while blocking arbitrary disk extensions.
  const {
    DefaultResourceLoader: PiDefaultResourceLoader,
    ProjectTrustStore: PiProjectTrustStore,
    SessionManager: PiSessionManager,
    SettingsManager: PiSettingsManager,
    hasTrustRequiringProjectResources: piHasTrustRequiringProjectResources,
  } = await import('@earendil-works/pi-coding-agent');
  const isolationRoot = mkdtempSync(join(tmpdir(), 'offisim-pi-isolation-'));
  const isolationCwd = join(isolationRoot, 'workspace');
  const isolationAgentDir = join(isolationRoot, 'agent');
  const projectMarker = join(isolationRoot, 'project-extension-loaded');
  const userMarker = join(isolationRoot, 'user-extension-loaded');
  try {
    mkdirSync(join(isolationCwd, '.pi', 'extensions'), { recursive: true });
    mkdirSync(join(isolationAgentDir, 'extensions'), { recursive: true });
    writeFileSync(
      join(isolationCwd, '.pi', 'extensions', 'project-auto.js'),
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(projectMarker)}, 'loaded');\nexport default function () {}\n`,
    );
    writeFileSync(
      join(isolationAgentDir, 'extensions', 'user-auto.js'),
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(userMarker)}, 'loaded');\nexport default function () {}\n`,
    );
    let inlineFactoryLoaded = false;
    const loader = new PiDefaultResourceLoader({
      cwd: isolationCwd,
      agentDir: isolationAgentDir,
      settingsManager: PiSettingsManager.create(isolationCwd, isolationAgentDir),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        () => {
          inlineFactoryLoaded = true;
        },
      ],
    });
    await loader.reload();
    const inMemorySession = PiSessionManager.inMemory(isolationCwd);
    assert(
      inMemorySession.isPersisted() === false,
      'Pi SessionManager.inMemory must remain non-persisted for isolated sidecar calls',
    );

    const resolveTrust = new Function(
      'hasTrustRequiringProjectResources',
      'ProjectTrustStore',
      'SettingsManager',
      `${extractNamedFunction(nodeHostSource, 'resolveHeadlessProjectTrust')}; return resolveHeadlessProjectTrust;`,
    )(piHasTrustRequiringProjectResources, PiProjectTrustStore, PiSettingsManager);
    assert(
      resolveTrust(isolationCwd, isolationAgentDir) === false,
      'headless project resources must fail closed when Pi has no saved trust decision',
    );
    new PiProjectTrustStore(isolationAgentDir).set(isolationCwd, true);
    assert(
      resolveTrust(isolationCwd, isolationAgentDir) === true,
      'headless project resources must honor Pi saved trust decisions',
    );
    const resourceFreeCwd = join(isolationRoot, 'resource-free');
    mkdirSync(resourceFreeCwd, { recursive: true });
    assert(
      resolveTrust(resourceFreeCwd, isolationAgentDir) === true,
      'resource-free projects must not require a trust prompt',
    );
    assert(
      inlineFactoryLoaded &&
        loader.getExtensions().extensions.length === 1 &&
        loader.getExtensions().extensions[0]?.path.startsWith('<inline:'),
      'noExtensions must preserve the explicit inline collaboration_read factory',
    );
    assert(
      !existsSync(projectMarker) && !existsSync(userMarker),
      'noExtensions must prevent project and user extension modules from executing',
    );
    assert(
      loader.getSkills().skills.length === 0 &&
        loader.getPrompts().prompts.length === 0 &&
        loader.getThemes().themes.length === 0 &&
        loader.getAgentsFiles().agentsFiles.length === 0,
      'isolated resource loading must expose no discovered skills, prompts, themes, or context files',
    );
  } finally {
    rmSync(isolationRoot, { recursive: true, force: true });
  }
}
assert(
  /const projectId = asNonEmptyString\(payload\.projectId\)/.test(nodeHostSource),
  'execute host must declare projectId from the run payload before delegating (a bare projectId reference throws "projectId is not defined")',
);
assert(
  /function normalizeDelegationLimitOverrides\(value\)/.test(nodeHostSource) &&
    /Number\.isSafeInteger\(requested\)/.test(nodeHostSource) &&
    /Math\.min\(requested, DELEGATION_DEFAULTS\[key\]\)/.test(nodeHostSource) &&
    /delegationLimitOverrides === undefined[\s\S]*createDelegationLimits\(\)[\s\S]*createDelegationLimits\(delegationLimitOverrides\)/.test(
      nodeHostSource,
    ) &&
    /Number\.isSafeInteger\(requested\)/.test(bundledNodeHostSource) &&
    /Math\.min\(requested, DELEGATION_DEFAULTS\w*\[key\]\)/.test(bundledNodeHostSource),
  'source and bundled Pi hosts must accept only positive integer delegation caps, clamp them to host defaults, and preserve the default constructor for absent/invalid packets',
);

const delegationDefaults = Function(
  `return (${extractObjectLiteral(childSupervisorSource, 'export const DELEGATION_DEFAULTS')});`,
)();
const normalizeDelegationLimits = Function(
  'DELEGATION_DEFAULTS',
  'DELEGATION_LIMIT_KEYS',
  `${extractNamedFunction(nodeHostSource, 'normalizeDelegationLimitOverrides')}; return normalizeDelegationLimitOverrides;`,
)(delegationDefaults, [
  'maxDepth',
  'maxParallelPerDelegation',
  'maxTotalChildren',
  'maxTotalTokens',
]);
const buildDelegationLimits = Function(
  'DELEGATION_DEFAULTS',
  `${extractNamedFunction(childSupervisorSource, 'createDelegationLimits')}; return createDelegationLimits;`,
)(delegationDefaults);

assert(
  normalizeDelegationLimits(undefined) === undefined,
  'absent delegationLimits must preserve the host default path',
);
const validDelegationOverrides = normalizeDelegationLimits({
  maxDepth: 1,
  maxParallelPerDelegation: 99,
  maxTotalChildren: 8,
  maxTotalTokens: 90_000,
});
assert(
  validDelegationOverrides?.maxDepth === 1 &&
    validDelegationOverrides.maxParallelPerDelegation ===
      delegationDefaults.maxParallelPerDelegation &&
    validDelegationOverrides.maxTotalChildren === 8 &&
    validDelegationOverrides.maxTotalTokens === 90_000,
  'valid delegation limits must tighten values below defaults and clamp values above defaults',
);
const effectiveDelegationLimits = buildDelegationLimits(validDelegationOverrides);
assert(
  effectiveDelegationLimits.maxDepth === 1 &&
    effectiveDelegationLimits.maxParallelPerDelegation ===
      delegationDefaults.maxParallelPerDelegation &&
    effectiveDelegationLimits.maxTotalChildren === 8 &&
    effectiveDelegationLimits.maxTotalTokens === 90_000,
  'normalized overrides must reach createDelegationLimits unchanged',
);

const sharedConcurrency = buildDelegationLimits({
  maxParallelPerDelegation: 2,
  maxTotalChildren: 8,
  maxTotalTokens: 100,
});
assert(await sharedConcurrency.acquireConcurrency('branch-a'), 'first branch gets a global lease');
assert(await sharedConcurrency.acquireConcurrency('branch-b'), 'second branch gets a global lease');
let thirdBranchStarted = false;
const thirdBranch = sharedConcurrency.acquireConcurrency('branch-c').then((acquired) => {
  thirdBranchStarted = acquired;
  return acquired;
});
await Promise.resolve();
assert(!thirdBranchStarted, 'a third recursive branch queues behind the shared tree cap');
sharedConcurrency.releaseConcurrency('branch-a');
assert(await thirdBranch, 'releasing any branch admits the next global waiter');
assert(sharedConcurrency.concurrencyInUse() === 2, 'global active-agent count never exceeds two');
assert(
  sharedConcurrency.suspendConcurrency('branch-b'),
  'a delegating parent suspends its lease while descendants run',
);
assert(
  await sharedConcurrency.acquireConcurrency('grandchild'),
  'a grandchild uses the parent slot',
);
sharedConcurrency.releaseConcurrency('grandchild');
assert(
  await sharedConcurrency.resumeConcurrency('branch-b'),
  'the parent reacquires before resuming',
);
sharedConcurrency.recordTokens({ input: 10, output: 0, turns: 1 });
sharedConcurrency.recordTokens({ input: 1_000, output: 0, turns: 1 });
assert(sharedConcurrency.usage().input === 1_010, 'root and child usage share one budget ledger');
assert(sharedConcurrency.budgetExceeded(), 'combined tree usage exhausts maxTotalTokens');
sharedConcurrency.releaseConcurrency('branch-b');
sharedConcurrency.releaseConcurrency('branch-c');
for (const invalidPacket of [
  null,
  [],
  { maxDepth: 0 },
  { maxDepth: -1 },
  { maxDepth: 1.5 },
  { maxDepth: '1' },
  { maxDepth: 1, maxTotalTokens: 0 },
  { maxDepth: 1, childTimeoutMs: 1 },
]) {
  assert(
    normalizeDelegationLimits(invalidPacket) === undefined,
    `invalid delegation-limit packet must be ignored as a whole: ${JSON.stringify(invalidPacket)}`,
  );
}
assert(
  /const projectId = asNonEmptyString\w*\(payload\.projectId\)/.test(bundledNodeHostSource),
  'bundled Pi Agent host must also declare projectId from the run payload — rebuild with pnpm build:pi-agent-host',
);
assert(
  /const baseTools = toolAllowlistForMode\(permissionMode\)/.test(nodeHostSource) &&
    /const scopedMcpTools =[\s\S]*permissionMode === 'plan'[\s\S]*mcpTools\.filter\(\(tool\) => !isWriteMcpTool\(tool\)\)[\s\S]*: mcpTools/.test(
      nodeHostSource,
    ) &&
    /const mcpHasCatalog = scopedMcpTools\.length > 0/.test(nodeHostSource) &&
    /const tools = \[[\s\S]*\.\.\.\(baseTools \?\? \['read', 'write', 'edit', 'bash'\]\)[\s\S]*'mcp_search_tools',[\s\S]*'mcp_describe_tool',[\s\S]*\.\.\.\(mcpHasCatalog \? \['mcp_call'\] : \[\]\)/.test(
      nodeHostSource,
    ),
  'execute host must always expose MCP discovery (mcp_search_tools/mcp_describe_tool) in the explicit tool allowlist, gate mcp_call on a non-empty grant catalog, and filter write MCP in plan mode',
);
assert(
  /permissionMode,\s*resolveModel/.test(nodeHostSource) &&
    /bindChildUi:\s*\(session\)[\s\S]*session\.bindExtensions/.test(nodeHostSource) &&
    /const permissionMode = normalizePermissionMode\(ctx\.permissionMode\)/.test(
      childSupervisorSource,
    ) &&
    /ctx\.buildPermissionGate\(permissionMode\)/.test(childSupervisorSource) &&
    /if \(ctx\.bindChildUi\)/.test(childSupervisorSource) &&
    /await session\.bindExtensions\(\{ uiContext: createForwardingUiContext\(\), mode: 'rpc' \}\)/.test(
      nodeHostSource,
    ),
  'root and delegated sessions must inherit permission mode while keeping all extension UI primitives bound to the existing renderer channel',
);
assert(
  /No MCP tools are granted to you yet/.test(mcpBridgeSource) &&
    /No MCP tools are granted to you yet/.test(bundledNodeHostSource),
  'source and bundled MCP bridge must return an actionable "no tools granted" setup state for an empty catalog (screenshot-1 apology fix) — rebuild the bundle with pnpm build:pi-agent-host',
);
assert(
  /const scopedGrants = grants\.filter/.test(desktopRuntimeScopeSource) &&
    /requestSurface:\s*[\s\S]*server\.requestSurface[\s\S]*: 'settings'/.test(
      desktopRuntimeScopeSource,
    ) &&
    /if \(!server\) \{[\s\S]*continue;[\s\S]*\}/.test(desktopRuntimeScopeSource) &&
    /catch \{[\s\S]*return \[\];[\s\S]*\}/.test(desktopRuntimeScopeSource),
  'desktop buildMcpScope must connect registered MCP servers with their approved surface and expose only ready tools',
);
assert(
  /PI_HOST_PROTOCOL_VERSION = 8/.test(wireSource) &&
    /PI_HOST_PROTOCOL_VERSION: u32 = 8/.test(rustHostSource) &&
    /'worktreeCall'/.test(wireSource) &&
    /WorktreeCall/.test(rustHostSource) &&
    /'verifyCall'/.test(wireSource) &&
    /VerifyCall/.test(rustHostSource) &&
    /'lifecycle'/.test(wireSource) &&
    /Lifecycle/.test(rustHostSource),
  'the Pi host wire must keep protocol 8 current and decode worktree, verify, and lifecycle events on both Node and Rust sides',
);
assert(
  /ROOT_CONTROL_CUSTOM_TYPE = 'offisim\.control'/.test(nodeHostSource) &&
    /session\.sendCustomMessage\(message,[\s\S]*deliverAs: control\.action,[\s\S]*triggerTurn: true/.test(
      nodeHostSource,
    ) &&
    /hydrateRootControlLedger\(sessionManager, activeRootRunId\)/.test(nodeHostSource) &&
    /consumeRootControlMessage\(event\.message\)/.test(nodeHostSource) &&
    /rootControlsOpen = false;[\s\S]*rootControlQueueCount\(\) === 0[\s\S]*session\.pendingMessageCount === 0/.test(
      nodeHostSource,
    ) &&
    /emitControlState\(acceptedControl, 'accepted'\)/.test(nodeHostSource) &&
    /emitControlState\(control, 'rejected'/.test(nodeHostSource) &&
    /rootControlLedger\.get\(controlId\)/.test(nodeHostSource) &&
    /message\.action === 'reattach'[\s\S]*resurfaceActiveRequest/.test(nodeHostSource) &&
    /"steer" \| "followUp"/.test(rustHostSource) &&
    /"reattach" => serde_json::json!/.test(rustHostSource) &&
    /"controlId": control_id/.test(rustHostSource) &&
    /controlId: message\.id/.test(desktopAgentRuntimeSource) &&
    /pendingControlAcks/.test(desktopAgentRuntimeSource) &&
    /action: 'reattach'/.test(desktopAgentRuntimeSource) &&
    /action: message\.behavior/.test(desktopAgentRuntimeSource) &&
    /turn\.consumed = true/.test(conversationRunControllerSource),
  'running turns must durably acknowledge, consume, hydrate, retry, and close Pi-native steer/follow-up controls without losing or duplicating late input',
);
assert(
  /private async abortUnsafeReattachHost\([\s\S]*await this\.invokeRuntimeCommand\('agent_runtime_abort', \{ requestId \}\);[\s\S]*await this\.waitForTerminalStream\(requestId, 'bounded-reattach'\);[\s\S]*terminalSnapshot\?\.terminal\?\.status !== 'aborted'[\s\S]*throw new ReattachSafetyError/.test(
    desktopAgentRuntimeSource,
  ) &&
    /catch \(err\) \{[\s\S]*if \(!snapshot\.running\) \{[\s\S]*throw new ReattachSafetyError\(err\);[\s\S]*await this\.abortUnsafeReattachHost\(requestId, err\);[\s\S]*settleReattached\(/.test(
      desktopAgentRuntimeSource,
    ) &&
    /error instanceof ReattachSafetyError\) throw error\.originalError/.test(
      desktopAgentRuntimeSource,
    ),
  'running replay loss must confirm host termination before synthetic failure, while terminal replay transport errors retain the authoritative stream and reject hydration',
);
assert(
  /try \{[\s\S]*observer = await claim\([\s\S]*catch \(claimError\) \{[\s\S]*if \(snapshot\.running\) \{[\s\S]*await this\.abortUnsafeReattachHost\(requestId, claimError\);[\s\S]*throw claimError;[\s\S]*if \(!observer\) \{/.test(
    desktopAgentRuntimeSource,
  ),
  'a running host must be confirmed terminal when durable controller ownership cannot be rebuilt before stream attachment',
);
assert(
  /if \(!observer\) \{[\s\S]*snapshot\.running && this\.inFlightByThread\.get\(row\.thread_id\) !== requestId[\s\S]*await this\.abortUnsafeReattachHost\([\s\S]*continue;/.test(
    desktopAgentRuntimeSource,
  ),
  'a declined duplicate row must confirm termination only for an unowned live host and preserve an idempotently re-scanned request that already has controller ownership',
);
assert(
  /const durableReplayCursor = normalizeStreamCursor\(observer\.afterCursor\)[\s\S]*const terminalTailCursor =[\s\S]*snapshot\.terminal\?\.status === 'aborted'[\s\S]*Math\.max\(0, normalizeStreamCursor\(snapshot\.cursor\) - 1\)[\s\S]*normalizeStreamCursor\(snapshot\.cursor\) - normalizeStreamCursor\(snapshot\.buffered\)[\s\S]*afterCursor: snapshot\.running[\s\S]*durableReplayCursor >= retainedReplayFloor[\s\S]*Math\.min\(durableReplayCursor, terminalTailCursor\)[\s\S]*terminalTailCursor/.test(
    desktopAgentRuntimeSource,
  ),
  'running reattach must enforce the durable checkpoint while terminal reattach uses retained history or falls back to the authoritative final Result/Error event',
);
assert(
  /Promise\.resolve\(completion\)[\s\S]*\.then\(\(\) => this\.settleRun\(row\.thread_id, terminalStatus\)\)[\s\S]*reattached run settlement retained stream/.test(
    desktopAgentRuntimeSource,
  ) &&
    /async settleRun\([\s\S]*this\.reconcileRoot\([\s\S]*agent_runtime_release_stream/.test(
      desktopAgentRuntimeSource,
    ) &&
    !/if \(snapshot\.terminal\?\.status === 'aborted'\)[\s\S]{0,300}agent_runtime_release_stream/.test(
      desktopAgentRuntimeSource,
    ),
  'terminal and initial-aborted streams must release only after controller settlement commits; failed settlement keeps the retry source',
);
{
  const admit = conversationRunControllerSource.indexOf(
    'await run.runtime.admitRun(this.runtimeInput(run))',
  );
  const userMessage = conversationRunControllerSource.indexOf(
    'await this.persistRunMessage(run, run.userMessage)',
    admit,
  );
  const execute = conversationRunControllerSource.indexOf('await this.executeAttempt(run)', admit);
  assert(
    admit >= 0 && userMessage > admit && execute > userMessage,
    'a durable root admission must precede the visible user message and host execution',
  );
}
assert(
  /await this\.persistAgentRun\(startedEvent\)[\s\S]*this\.runIdentityByThread\.set/.test(
    desktopAgentRuntimeSource,
  ) &&
    /const rows = await repo\.findByStatus\(this\.companyId, \['running'\]\);/.test(
      desktopAgentRuntimeSource,
    ) &&
    /throw new ReattachDiscoveryError\(error\)/.test(desktopAgentRuntimeSource) &&
    /throw new TerminalReattachClaimError\(claimError\)/.test(desktopAgentRuntimeSource),
  'run discovery/admission must fail closed instead of hiding read or terminal-ownership failures',
);
assert(
  /event\.type === 'queue_update'/.test(nodeHostSource) &&
    /event\.type === 'compaction_start'/.test(nodeHostSource) &&
    /event\.type === 'auto_retry_start'/.test(nodeHostSource) &&
    /session\.getContextUsage\(\)/.test(nodeHostSource) &&
    /PiAgentHostEvent::Lifecycle/.test(rustHostSource) &&
    /AGENT_LIFECYCLE_EVENT/.test(desktopAgentRuntimeSource),
  'Pi-owned queue, compaction, retry, and context facts must be projected as lifecycle status without recreating their policies',
);
assert(
  /data\.state === 'accepted' \|\| data\.state === 'consumed'/.test(desktopAgentRuntimeSource) &&
    /if \(!turn\.consumed\) \{[\s\S]*persistQueuedTurnState\(run, turn, 'accepted'\)/.test(
      conversationRunControllerSource,
    ) &&
    /data\.state === 'accepted' && !turn\.consumed/.test(conversationRunControllerSource),
  'a crash-recovered consumed replay must settle the renderer ACK and remain monotonic instead of regressing to accepted',
);
assert(
  /createWorktreeCallChannel/.test(nodeHostSource) &&
    /createWorkspaceLeaseManager/.test(nodeHostSource) &&
    /leaseManager/.test(nodeHostSource) &&
    /now:\s*\(\)\s*=>/.test(nodeHostSource) &&
    /newId:\s*\(\)\s*=>/.test(nodeHostSource) &&
    /confirmIntegration/.test(nodeHostSource),
  'execute host must run the workspace lease manager host-side and gate integration review',
);
assert(
  /handle_worktree_call/.test(rustHostSource) &&
    /run_git_validated/.test(rustHostSource) &&
    /write_worktree_result/.test(rustHostSource),
  'Rust Pi host must intercept worktreeCall and answer with worktreeResult through stdin',
);
{
  // The Task Board recognizes the in-chat review approval card ONLY by its title
  // string; if either side drifts, the board silently bypasses the live approval
  // and double-drives the lease pipeline. Lock the literal on both sides.
  const leaseActionsSource = readFileSync(
    'apps/desktop/renderer/src/surfaces/office/board/workspace-lease-actions.ts',
    'utf8',
  );
  const leaseDecisionCoordinatorSource = readFileSync(
    'apps/desktop/renderer/src/surfaces/office/board/workspace-lease-decision-coordinator.ts',
    'utf8',
  );
  const permissionApprovalSource = readFileSync(
    'apps/desktop/renderer/src/assistant/parts/PermissionApprovalBar.tsx',
    'utf8',
  );
  const boardStageSource = readFileSync(
    'apps/desktop/renderer/src/surfaces/office/board/BoardStage.tsx',
    'utf8',
  );
  const workspacePanelSource = readFileSync(
    'apps/desktop/renderer/src/surfaces/office/WorkspacePanel.tsx',
    'utf8',
  );
  assert(
    /approval\.method === 'confirm'/.test(permissionApprovalSource) &&
      /approval\.method === 'select'/.test(permissionApprovalSource) &&
      /approval\.method === 'input'/.test(permissionApprovalSource) &&
      /approval\.method === 'editor'/.test(permissionApprovalSource) &&
      /<Input/.test(permissionApprovalSource) &&
      /<ChatComposerInput/.test(permissionApprovalSource),
    'Pi confirm, select, input, and editor requests must all have real in-chat controls',
  );
  assert(
    nodeHostSource.includes('`Review delegated work ${mergeable[0]?.leaseId'),
    'execute host must title the integration approval "Review delegated work <leaseId>" — the Task Board matches this exact title',
  );
  assert(
    leaseActionsSource.split('`Review delegated work ${row.leaseId}`').length === 3,
    'workspace-lease-actions must match the approval card by the exact "Review delegated work <leaseId>" title in both review and request-changes paths',
  );
  assert(
    /workspaceLeaseIdFromApprovalTitle/.test(permissionApprovalSource) &&
      /reviewWorkspaceLease\(\s*leaseReview,\s*companyId/.test(permissionApprovalSource) &&
      /openBoard\('board'\)/.test(permissionApprovalSource) &&
      /highlightBoardRun\(leaseReview\.rootRunId\)/.test(permissionApprovalSource) &&
      /isLeaseReview\s*\? leaseReview !== null/.test(permissionApprovalSource) &&
      /stale && !isLeaseReview/.test(permissionApprovalSource) &&
      /isLeaseReview && leaseDecisionComplete/.test(permissionApprovalSource) &&
      /pendingLeaseAction !== null/.test(permissionApprovalSource) &&
      /const outcome = await reviewWorkspaceLease/.test(permissionApprovalSource) &&
      /queryKey: \['workspace-lease-reviews'\]/.test(permissionApprovalSource),
    'the pending-review permission notice must use the Board lease decision channel, stay actionable after restart, open the matching Board drawer, and refresh every active Board scope',
  );
  assert(
    /leaseDecisionById\.run/.test(leaseActionsSource) &&
      /interface InFlightDecision<Outcome>[\s\S]*action: WorkspaceLeaseDecisionAction;[\s\S]*promise: Promise<Outcome>/.test(
        leaseDecisionCoordinatorSource,
      ) &&
      /if \(active\) return active\.promise/.test(leaseDecisionCoordinatorSource) &&
      /persisted === 'merged' \|\| persisted === 'discarded'/.test(leaseActionsSource),
    'workspace lease decisions must record the in-flight action, return its actual outcome to conflicting entries, and short-circuit terminal leases',
  );
  assert(
    /toastLeaseOutcomes\(succeeded\.map\(\(result\) => result\.outcome\)\)/.test(
      boardStageSource,
    ) &&
      /hasPendingDecision\(selectedLeases\)/.test(boardStageSource) &&
      /pendingLeaseAction !== null/.test(workspacePanelSource),
    'Board, compact approval, and workspace review entries must disable on shared pending state and report persisted outcomes rather than requested actions',
  );
  assert(
    /highlightedRow\.projectId === projectId \? 'project' : 'company'/.test(boardStageSource),
    'a pending-review jump must select the Board scope containing the highlighted request before opening its drawer',
  );
}
assert(
  /finalAssistant\?\.stopReason === 'error'/.test(nodeHostSource) &&
    /normalizePiErrorMessage/.test(nodeHostSource) &&
    /code:\s*'upstream'/.test(nodeHostSource),
  'execute host must surface Pi model error stops as upstream failures instead of empty completed replies',
);
assert(
  /get rootModel\(\)[\s\S]*return effectiveRootModel/.test(nodeHostSource) &&
    /effectiveRootModel = session\.model \?\? model/.test(nodeHostSource) &&
    /rootThinkingLevel:\s*thinkingLevel/.test(nodeHostSource) &&
    /function resolveEmployeeBinding\(employee\)/.test(childSupervisorSource) &&
    /ctx\.resolveModel\(requestedModel\)/.test(childSupervisorSource) &&
    /thinkingLevel = requestedThinking \?\? ctx\.rootThinkingLevel/.test(childSupervisorSource) &&
    /\.\.\.\(thinkingLevel \? \{ thinkingLevel \} : \{\}\)/.test(childSupervisorSource),
  'delegated children must inherit the parent run model unless an employee model override is provided',
);
assert(
  /selectedModel\(modelRegistry, requested\)/.test(nodeHostSource) &&
    /delete rest\.model/.test(nodeHostSource) &&
    /delete rest\.thinkingLevel/.test(nodeHostSource),
  'execute host must strip stale employee model/thinking bindings before the roster reaches delegation',
);
assert(
  /function resolveEmployeeBinding\(employee\)/.test(bundledNodeHostSource) &&
    /rootThinkingLevel:\s*thinkingLevel/.test(bundledNodeHostSource) &&
    /thinkingLevel:\s*thinkingLevel2/.test(bundledNodeHostSource) &&
    /selectedModel\(modelRegistry\w*, requested\)/.test(bundledNodeHostSource),
  'bundled Pi Agent host must carry employee model/thinking binding and stale-binding filtering',
);
assert(
  /"roster": req\.roster/.test(executePayloadSource) &&
    /const model = e\.model\?\.trim\(\)/.test(desktopRuntimeScopeSource) &&
    /model && thinkingLevel \? \{ thinkingLevel \} : \{\}/.test(desktopRuntimeScopeSource),
  'employee model/thinking fields must cross renderer roster projection and opaque Rust roster forwarding',
);
assert(
  /finalAssistant\?\.stopReason === 'error'/.test(childSupervisorSource) &&
    /Child completed without assistant output/.test(childSupervisorSource),
  'delegated children must fail provider errors and empty outputs instead of reporting completed no-output work',
);
assert(
  /an Orchestrator must never delegate a task to itself/.test(nodeHostSource) &&
    /Executors are/.test(nodeHostSource) &&
    /Use a Reviewer for independent diff review/.test(nodeHostSource) &&
    /entry\.displayTitle/.test(delegationExtensionSource),
  'delegation guidance must expose and enforce Orchestrator / Executor / Reviewer responsibilities',
);
assert(
  /providerStatusById/.test(nodeHostSource) &&
    /configuredProviderStatus/.test(nodeHostSource) &&
    /providerStatusById/.test(bundledNodeHostSource) &&
    /configuredProviderStatus/.test(bundledNodeHostSource),
  'source and bundled Pi Agent hosts must expose configured provider fallback for malformed registry entries',
);
// Typed failure kinds (I1): the supervisor may only emit run.failed through the
// blocked()/failed() helpers, which validate the typed failureKind at the emit
// boundary (assertRunFailureKind throws on a missing/unknown kind) — no failure
// path can forget it, and nothing downstream keyword-parses the summary. Lock
// the mechanism (exactly two helper-owned emits, each validated), not per-site
// payload shapes.
const supervisorRunFailedEmits =
  childSupervisorSource.match(/emit\w*\(["']run\.failed["'],\s*\{[^}]*/g) ?? [];
assert(
  supervisorRunFailedEmits.length === 2 &&
    supervisorRunFailedEmits.every((payload) => payload.includes('failureKind')) &&
    /function failed\(emit\w*, failureKind[\s\S]{0,200}?assertRunFailureKind\(failureKind\)/.test(
      childSupervisorSource,
    ) &&
    /function blocked\(emit\w*, reason, failureKind[\s\S]{0,200}?assertRunFailureKind\(failureKind\)/.test(
      childSupervisorSource,
    ),
  'child supervisor must route every run.failed through the validated blocked()/failed() helpers',
);
// The emit-boundary validator and the emitter-side classifier are behaviorally
// checked here (the wire module is dependency-free, safe to import).
assert(
  RUN_FAILURE_KINDS.length === 6 &&
    ['token', 'budget', 'permission', 'context', 'runtime', 'tool'].every((kind) =>
      RUN_FAILURE_KINDS.includes(kind),
    ),
  'RUN_FAILURE_KINDS must mirror the six-kind RunFailureKind union',
);
for (const [message, expected] of [
  ['maximum context length exceeded: 131072 tokens', 'context'],
  ['prompt is too long for the model window', 'context'],
  ['rate limit reached (429), retry later', 'token'],
  ['insufficient token quota for this request', 'token'],
  ['permission denied by provider policy', 'permission'],
  ['401 unauthorized', 'permission'],
  ['provider disconnected mid-stream', 'runtime'],
  ['', 'runtime'],
]) {
  assert(
    classifyRunFailure(message) === expected,
    `classifyRunFailure(${JSON.stringify(message)}) must be '${expected}', got '${classifyRunFailure(message)}'`,
  );
}
// The bundler may suffix-rename identifiers (emit2, …); match loosely.
const bundledRunFailedEmits =
  bundledNodeHostSource.match(/emit\w*\(["']run\.failed["'],\s*\{[^}]*/g) ?? [];
assert(
  bundledRunFailedEmits.length === 2 &&
    bundledRunFailedEmits.every((payload) => payload.includes('failureKind')),
  'bundled Pi Agent host must route run.failed through the typed-failureKind helpers — rebuild with pnpm build:pi-agent-host',
);

const tempAgentDir = mkdtempSync(join(tmpdir(), 'offisim-pi-agent-host-'));
writeFileSync(
  join(tempAgentDir, 'models.json'),
  `{
    // Pi models.json accepts JSONC comments and trailing commas.
    "providers": {
      "local-test": {
        "name": "Local Test",
        "baseUrl": "http://127.0.0.1:11434/v1",
        "api": "openai-completions",
        "apiKey": "test",
        "headers": { "x-keep": "provider" },
        "compat": { "mode": "fixture" },
        "authHeader": true,
        "models": [
          {
            "id": "fixture-model",
            "name": "Fixture Model",
            "api": "openai-completions",
            "contextWindow": 2048,
            "maxTokens": 512,
            "headers": { "x-keep": "model" },
            "compat": { "modelMode": "fixture" },
          },
        ],
        "modelOverrides": {
          "builtin-model": { "name": "Fixture override" },
        },
      },
    },
  }`,
);

let result;
try {
  result = runHost(HOST_SCRIPT, { mode: 'status', agentDir: tempAgentDir }, 'Pi Agent status host');
  assert(result.response?.ok === true, 'Pi Agent status response must be ok');
  assert(
    Array.isArray(result.response.availableModels),
    'Pi Agent status response must include availableModels from Pi ModelRegistry',
  );
  assert(
    result.response.paths?.modelsPath,
    'Pi Agent status response must expose Pi models.json path',
  );
  assert(
    result.response.modelsConfig?.exists === true &&
      result.response.modelsConfig.providers.includes('local-test') &&
      result.response.modelsConfig.modelCount === result.response.allModelCount &&
      !result.response.modelsConfig.parseError,
    'Pi Agent status response must expose the Pi ModelRegistry-loaded models.json summary',
  );
  assert(
    result.response.configuredProviderStatus?.some((account) => account.provider === 'local-test'),
    'Pi Agent status response must expose configuredProviderStatus for the editable provider list',
  );
  assert(
    result.response.providerStatus.length > result.response.configuredProviderStatus.length,
    'configuredProviderStatus must not be the full built-in provider catalog',
  );
  const editableLocalProvider = result.response.providerConfigs?.find(
    (provider) => provider.provider === 'local-test',
  );
  assert(
    editableLocalProvider?.displayName === 'Local Test' &&
      editableLocalProvider.baseUrl === 'http://127.0.0.1:11434/v1' &&
      editableLocalProvider.api === 'openai-completions' &&
      editableLocalProvider.hasApiKey === true &&
      editableLocalProvider.models?.[0]?.contextWindow === 2048 &&
      editableLocalProvider.models?.[0]?.maxTokens === 512,
    'Pi Agent status response must expose editable models.json provider config without raw keys',
  );
  assert(
    !JSON.stringify(editableLocalProvider).includes('apiKey'),
    'Pi Agent status editable provider config must not echo raw API keys',
  );
  const openAiTemplate = result.response.providerTemplates?.find(
    (template) => template.provider === 'openai',
  );
  assert(
    openAiTemplate?.models?.length > 0 &&
      typeof openAiTemplate.baseUrl === 'string' &&
      openAiTemplate.configured === false,
    'Pi Agent status response must expose add-provider templates from the Pi registry',
  );
  const invalidAgentDir = mkdtempSync(join(tmpdir(), 'offisim-pi-agent-invalid-'));
  try {
    writeFileSync(
      join(invalidAgentDir, 'models.json'),
      `{
        "providers": {
          "broken-local": {
            "name": "Broken Local",
            "baseUrl": "http://127.0.0.1:11434/v1",
            "api": "openai-completions",
            "apiKey": "test",
            "authHeader": "invalid-for-pi-schema",
            "models": [{ "id": "broken-model" }]
          }
        }
      }`,
    );
    for (const scriptPath of [HOST_SCRIPT, BUNDLED_HOST_SCRIPT]) {
      const invalidResult = runHost(
        scriptPath,
        { mode: 'status', agentDir: invalidAgentDir },
        `Pi Agent invalid-schema status host (${scriptPath})`,
      );
      assert(
        invalidResult.response.modelsConfig?.parseError &&
          invalidResult.response.providerConfigs?.some(
            (provider) => provider.provider === 'broken-local',
          ) &&
          invalidResult.response.configuredProviderStatus?.some(
            (provider) => provider.provider === 'broken-local',
          ),
        'Pi Agent status must keep models.json providers editable even when Pi ModelRegistry reports a schema error',
      );
    }
  } finally {
    rmSync(invalidAgentDir, { recursive: true, force: true });
  }
  assert(
    !/function stripJsoncComments/.test(nodeHostSource) &&
      !/function parseJsonc/.test(nodeHostSource),
    'Pi Agent host must not duplicate Pi ModelRegistry JSONC parsing',
  );

  runHost(
    HOST_SCRIPT,
    {
      mode: 'saveProvider',
      agentDir: tempAgentDir,
      config: {
        providerId: 'local-test',
        displayName: 'Local Test Edited',
        baseUrl: 'http://127.0.0.1:11434/v2',
        api: 'openai-completions',
        apiKey: '',
        keepExistingApiKey: true,
        models: [
          {
            id: 'fixture-model',
            name: 'Fixture Model Edited',
            api: 'openai-responses',
            contextWindow: 4096,
            maxTokens: 1024,
          },
        ],
      },
    },
    'Pi Agent saveProvider keep-key edit',
  );
  let modelsRoot = readJson(join(tempAgentDir, 'models.json'));
  let localProvider = modelsRoot.providers['local-test'];
  assert(
    localProvider.name === 'Local Test Edited' &&
      localProvider.baseUrl === 'http://127.0.0.1:11434/v2' &&
      localProvider.apiKey === 'test' &&
      localProvider.headers['x-keep'] === 'provider' &&
      localProvider.compat.mode === 'fixture' &&
      localProvider.authHeader === true &&
      localProvider.modelOverrides['builtin-model'].name === 'Fixture override',
    'Pi Agent saveProvider must preserve provider-level unknown fields and keep an existing API key when blank',
  );
  assert(
    localProvider.models[0].name === 'Fixture Model Edited' &&
      localProvider.models[0].api === 'openai-responses' &&
      localProvider.models[0].contextWindow === 4096 &&
      localProvider.models[0].maxTokens === 1024 &&
      localProvider.models[0].headers['x-keep'] === 'model' &&
      localProvider.models[0].compat.modelMode === 'fixture',
    'Pi Agent saveProvider must update editable model fields while preserving model-level unknown fields',
  );

  runHost(
    HOST_SCRIPT,
    {
      mode: 'saveProvider',
      agentDir: tempAgentDir,
      config: {
        providerId: 'local-test',
        displayName: 'Local Test Edited',
        baseUrl: 'http://127.0.0.1:11434/v2',
        api: 'openai-completions',
        apiKey: 'replacement-key',
        keepExistingApiKey: true,
        models: [{ id: 'fixture-model', name: 'Fixture Model Edited' }],
      },
    },
    'Pi Agent saveProvider key replacement',
  );
  modelsRoot = readJson(join(tempAgentDir, 'models.json'));
  localProvider = modelsRoot.providers['local-test'];
  assert(
    localProvider.apiKey === 'replacement-key',
    'Pi Agent saveProvider must replace an existing API key when a new key is entered',
  );
  assert(
    localProvider.models[0].name === 'Fixture Model Edited' &&
      !('api' in localProvider.models[0]) &&
      !('contextWindow' in localProvider.models[0]) &&
      !('maxTokens' in localProvider.models[0]) &&
      localProvider.models[0].headers['x-keep'] === 'model' &&
      localProvider.models[0].compat.modelMode === 'fixture',
    'Pi Agent saveProvider must allow editable model fields to be cleared while preserving unknown model fields',
  );

  const saveResult = runHost(
    HOST_SCRIPT,
    {
      mode: 'saveProvider',
      agentDir: tempAgentDir,
      config: {
        providerId: 'custom-jsonc',
        displayName: 'Custom JSONC',
        baseUrl: 'https://api.example.com/v1',
        api: 'openai-completions',
        apiKey: 'test',
        keepExistingApiKey: false,
        models: [{ id: 'custom-model', name: 'Custom Model' }],
      },
    },
    'Pi Agent saveProvider host',
  );
  assert(saveResult.response?.ok === true, 'Pi Agent saveProvider response must be ok');
  assert(
    saveResult.response.modelsConfig?.providers.includes('custom-jsonc') &&
      saveResult.response.availableModels.some(
        (model) => model.provider === 'custom-jsonc' && model.id === 'custom-model',
      ),
    'Pi Agent saveProvider must preserve JSONC-readable models.json and expose the saved provider',
  );
  assert(
    readFileSync(join(tempAgentDir, 'models.json'), 'utf8').includes(
      '// Pi models.json accepts JSONC comments and trailing commas.',
    ),
    'Pi Agent saveProvider must preserve existing JSONC comments while editing a provider',
  );
} finally {
  rmSync(tempAgentDir, { recursive: true, force: true });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      host: 'pi-agent',
      availableModels: result.response.availableModels.length,
      allModelCount: result.response.allModelCount,
      modelsConfig: result.response.modelsConfig,
    },
    null,
    2,
  ),
);
