import type { RuntimeEngineCapabilityManifest } from '@offisim/shared-types';
import { DEFAULT_NATIVE_STREAM_IDLE_TIMEOUT_MS } from './native-stream-progress-watchdog.js';
import { PI_HOST_PROTOCOL_VERSION } from './recovery/reconcile-interrupted-runs.js';

const PI_SDK_VERSION = '0.80.9';

export type NativeEngineRuntimeConfig = {
  readonly protocolVersion: number;
  readonly requestPrefix: string;
  readonly streamIdleTimeoutMs: number;
  readonly supportsOffisimDelegation: boolean;
  readonly capabilities: RuntimeEngineCapabilityManifest;
} & (
  | { readonly engineId: 'api'; readonly billingMode: 'api'; readonly runtimeVersion: string }
  | {
      readonly engineId: 'codex' | 'claude';
      readonly billingMode: 'subscription';
    }
);

export const API_ENGINE_RUNTIME: NativeEngineRuntimeConfig = {
  engineId: 'api',
  billingMode: 'api',
  runtimeVersion: PI_SDK_VERSION,
  protocolVersion: PI_HOST_PROTOCOL_VERSION,
  requestPrefix: 'pi-agent',
  streamIdleTimeoutMs: DEFAULT_NATIVE_STREAM_IDLE_TIMEOUT_MS,
  supportsOffisimDelegation: true,
  capabilities: {
    stop: true,
    steer: true,
    resume: true,
    attachmentInput: { textFiles: true, images: 'model-dependent' },
    permissionModes: ['plan', 'ask', 'auto', 'full'],
    interactions: { approval: true, userInput: true },
    processEvents: { reasoning: true, toolCalls: true, fileChanges: true },
    interactionRoutes: {
      browser: [
        {
          id: 'offisim-browser',
          source: 'offisim-local',
          label: 'Offisim Browser',
          availability: 'available',
        },
      ],
      computer: [
        {
          id: 'offisim-computer',
          source: 'offisim-local',
          label: 'Offisim local driver',
          availability: 'runtime-determined',
        },
      ],
    },
  },
};

export const CODEX_ENGINE_RUNTIME: NativeEngineRuntimeConfig = {
  engineId: 'codex',
  billingMode: 'subscription',
  protocolVersion: 2,
  requestPrefix: 'codex-agent',
  streamIdleTimeoutMs: DEFAULT_NATIVE_STREAM_IDLE_TIMEOUT_MS,
  supportsOffisimDelegation: false,
  capabilities: {
    stop: true,
    steer: false,
    resume: true,
    attachmentInput: { textFiles: true, images: 'supported' },
    permissionModes: ['plan', 'ask', 'auto', 'full'],
    interactions: { approval: true, userInput: true },
    processEvents: { reasoning: true, toolCalls: true, fileChanges: true },
    interactionRoutes: {
      browser: [
        {
          id: 'offisim-browser',
          source: 'offisim-local',
          label: 'Offisim Browser',
          availability: 'available',
        },
      ],
      computer: [
        {
          id: 'codex-native-computer',
          source: 'engine-native',
          label: 'Codex Computer Use',
          availability: 'unsupported',
          reason:
            'The current Codex app-server contract does not expose a negotiated Computer Use route.',
        },
        {
          id: 'offisim-computer',
          source: 'offisim-local',
          label: 'Offisim local driver',
          availability: 'runtime-determined',
        },
      ],
    },
  },
};

export const CLAUDE_ENGINE_RUNTIME: NativeEngineRuntimeConfig = {
  engineId: 'claude',
  billingMode: 'subscription',
  protocolVersion: 1,
  requestPrefix: 'claude-agent',
  streamIdleTimeoutMs: DEFAULT_NATIVE_STREAM_IDLE_TIMEOUT_MS,
  supportsOffisimDelegation: false,
  capabilities: {
    stop: true,
    steer: false,
    resume: true,
    attachmentInput: { textFiles: true, images: 'unsupported' },
    permissionModes: ['plan', 'auto', 'full'],
    interactions: { approval: false, userInput: false },
    processEvents: { reasoning: true, toolCalls: true, fileChanges: true },
    interactionRoutes: {
      browser: [
        {
          id: 'offisim-browser',
          source: 'offisim-local',
          label: 'Offisim Browser',
          availability: 'available',
        },
      ],
      computer: [
        {
          id: 'claude-native-computer',
          source: 'engine-native',
          label: 'Claude Computer Use',
          availability: 'unsupported',
          reason:
            'Claude Computer Use requires an interactive CLI session; this adapter uses non-interactive mode.',
        },
        {
          id: 'offisim-computer',
          source: 'offisim-local',
          label: 'Offisim local driver',
          availability: 'runtime-determined',
        },
      ],
    },
  },
};
