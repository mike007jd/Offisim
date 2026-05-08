import type {
  EmployeeRuntimeBinding,
  LlmProvider,
  MainHarnessPolicyConfig,
  ModelProfile,
  RuntimeExecutionMode,
  RuntimePolicyConfig,
  RuntimeToolPermissionsPolicy,
} from '@offisim/shared-types';
import { useMemo, useState } from 'react';
import { createDefaultRuntimePolicy } from '../../../lib/provider-config';

const DEFAULT_POLICY = createDefaultRuntimePolicy('anthropic', '');

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseConfidence(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

export interface RuntimePolicySnapshot {
  executionMode: RuntimeExecutionMode;
  summarizationEnabled: boolean;
  summarizationTriggerTokens: string;
  summarizationKeepRecentMessages: string;
  memoryEnabled: boolean;
  memoryInjectionEnabled: boolean;
  memoryMaxFacts: string;
  memoryConfidenceThreshold: string;
  toolSearchEnabled: boolean;
  gitAutoCommit: boolean;
  toolPermissions: RuntimeToolPermissionsPolicy;
  employeeRuntimeDefault: EmployeeRuntimeBinding | undefined;
  mainHarnessPolicy: MainHarnessPolicyConfig | undefined;
  runtimeModelDefault: ModelProfile;
  runtimeModelOverrides: Record<string, ModelProfile> | undefined;
}

export function useSettingsRuntimePolicy() {
  const [executionMode, setExecutionMode] = useState<RuntimeExecutionMode>(
    DEFAULT_POLICY.executionMode,
  );
  const [summarizationEnabled, setSummarizationEnabled] = useState(true);
  const [summarizationTriggerTokens, setSummarizationTriggerTokens] = useState(
    String(DEFAULT_POLICY.summarization.triggerTokens),
  );
  const [summarizationKeepRecentMessages, setSummarizationKeepRecentMessages] = useState(
    String(DEFAULT_POLICY.summarization.keepRecentMessages),
  );
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [memoryInjectionEnabled, setMemoryInjectionEnabled] = useState(true);
  const [memoryMaxFacts, setMemoryMaxFacts] = useState(String(DEFAULT_POLICY.memory.maxFacts));
  const [memoryConfidenceThreshold, setMemoryConfidenceThreshold] = useState(
    String(DEFAULT_POLICY.memory.factConfidenceThreshold),
  );
  const [toolSearchEnabled, setToolSearchEnabled] = useState(true);
  const [gitAutoCommit, setGitAutoCommit] = useState(true);
  const [toolPermissions, setToolPermissions] = useState<RuntimeToolPermissionsPolicy>(
    DEFAULT_POLICY.toolPermissions,
  );
  const [employeeRuntimeDefault, setEmployeeRuntimeDefault] = useState<
    EmployeeRuntimeBinding | undefined
  >(DEFAULT_POLICY.employeeRuntimeDefault);
  const [mainHarnessPolicy, setMainHarnessPolicy] = useState<MainHarnessPolicyConfig | undefined>(
    DEFAULT_POLICY.mainHarnessPolicy,
  );
  const [runtimeModelDefault, setRuntimeModelDefault] = useState<ModelProfile>(
    DEFAULT_POLICY.modelPolicy.default,
  );
  const [runtimeModelOverrides, setRuntimeModelOverrides] = useState<
    Record<string, ModelProfile> | undefined
  >(undefined);

  function applyFromSaved(policy: RuntimePolicyConfig): void {
    setExecutionMode(policy.executionMode);
    setSummarizationEnabled(policy.summarization.enabled);
    setSummarizationTriggerTokens(String(policy.summarization.triggerTokens));
    setSummarizationKeepRecentMessages(String(policy.summarization.keepRecentMessages));
    setMemoryEnabled(policy.memory.enabled);
    setMemoryInjectionEnabled(policy.memory.injectionEnabled);
    setMemoryMaxFacts(String(policy.memory.maxFacts));
    setMemoryConfidenceThreshold(String(policy.memory.factConfidenceThreshold));
    setToolSearchEnabled(policy.toolSearch.enabled);
    setGitAutoCommit(policy.gitAutoCommit ?? true);
    setToolPermissions(policy.toolPermissions);
    setEmployeeRuntimeDefault(policy.employeeRuntimeDefault);
    setMainHarnessPolicy(policy.mainHarnessPolicy);
    setRuntimeModelDefault(policy.modelPolicy.default);
    setRuntimeModelOverrides(policy.modelPolicy.overrides);
  }

  function applyDefaults(providerDefaults?: { provider?: LlmProvider; model?: string }): void {
    setExecutionMode(DEFAULT_POLICY.executionMode);
    setSummarizationEnabled(DEFAULT_POLICY.summarization.enabled);
    setSummarizationTriggerTokens(String(DEFAULT_POLICY.summarization.triggerTokens));
    setSummarizationKeepRecentMessages(String(DEFAULT_POLICY.summarization.keepRecentMessages));
    setMemoryEnabled(DEFAULT_POLICY.memory.enabled);
    setMemoryInjectionEnabled(DEFAULT_POLICY.memory.injectionEnabled);
    setMemoryMaxFacts(String(DEFAULT_POLICY.memory.maxFacts));
    setMemoryConfidenceThreshold(String(DEFAULT_POLICY.memory.factConfidenceThreshold));
    setToolSearchEnabled(DEFAULT_POLICY.toolSearch.enabled);
    setGitAutoCommit(DEFAULT_POLICY.gitAutoCommit ?? true);
    setToolPermissions(DEFAULT_POLICY.toolPermissions);
    setEmployeeRuntimeDefault(DEFAULT_POLICY.employeeRuntimeDefault);
    setMainHarnessPolicy(DEFAULT_POLICY.mainHarnessPolicy);
    setRuntimeModelDefault({
      ...DEFAULT_POLICY.modelPolicy.default,
      provider: providerDefaults?.provider ?? DEFAULT_POLICY.modelPolicy.default.provider,
      model: providerDefaults?.model ?? DEFAULT_POLICY.modelPolicy.default.model,
    });
    setRuntimeModelOverrides(DEFAULT_POLICY.modelPolicy.overrides);
  }

  function buildRuntimePolicy(provider: LlmProvider, model: string): RuntimePolicyConfig {
    return {
      executionMode,
      modelPolicy: {
        default: {
          ...runtimeModelDefault,
          provider,
          model,
          profileName: runtimeModelDefault.profileName || 'runtime-default',
        },
        ...(runtimeModelOverrides ? { overrides: runtimeModelOverrides } : {}),
      },
      summarization: {
        enabled: summarizationEnabled,
        triggerTokens: parsePositiveInt(
          summarizationTriggerTokens,
          DEFAULT_POLICY.summarization.triggerTokens,
        ),
        keepRecentMessages: parseNonNegativeInt(
          summarizationKeepRecentMessages,
          DEFAULT_POLICY.summarization.keepRecentMessages,
        ),
      },
      memory: {
        enabled: memoryEnabled,
        injectionEnabled: memoryInjectionEnabled,
        maxFacts: parsePositiveInt(memoryMaxFacts, DEFAULT_POLICY.memory.maxFacts),
        factConfidenceThreshold: parseConfidence(
          memoryConfidenceThreshold,
          DEFAULT_POLICY.memory.factConfidenceThreshold,
        ),
      },
      toolSearch: {
        enabled: toolSearchEnabled,
      },
      toolPermissions,
      ...(employeeRuntimeDefault ? { employeeRuntimeDefault } : {}),
      ...(mainHarnessPolicy ? { mainHarnessPolicy } : {}),
      gitAutoCommit,
    };
  }

  const snapshot = useMemo<RuntimePolicySnapshot>(
    () => ({
      executionMode,
      summarizationEnabled,
      summarizationTriggerTokens,
      summarizationKeepRecentMessages,
      memoryEnabled,
      memoryInjectionEnabled,
      memoryMaxFacts,
      memoryConfidenceThreshold,
      toolSearchEnabled,
      gitAutoCommit,
      toolPermissions,
      employeeRuntimeDefault,
      mainHarnessPolicy,
      runtimeModelDefault,
      runtimeModelOverrides,
    }),
    [
      executionMode,
      summarizationEnabled,
      summarizationTriggerTokens,
      summarizationKeepRecentMessages,
      memoryEnabled,
      memoryInjectionEnabled,
      memoryMaxFacts,
      memoryConfidenceThreshold,
      toolSearchEnabled,
      gitAutoCommit,
      toolPermissions,
      employeeRuntimeDefault,
      mainHarnessPolicy,
      runtimeModelDefault,
      runtimeModelOverrides,
    ],
  );

  return {
    executionMode,
    summarizationEnabled,
    summarizationTriggerTokens,
    summarizationKeepRecentMessages,
    memoryEnabled,
    memoryInjectionEnabled,
    memoryMaxFacts,
    memoryConfidenceThreshold,
    toolSearchEnabled,
    gitAutoCommit,
    toolPermissions,
    employeeRuntimeDefault,
    mainHarnessPolicy,
    runtimeModelDefault,
    runtimeModelOverrides,
    setExecutionMode,
    setSummarizationEnabled,
    setSummarizationTriggerTokens,
    setSummarizationKeepRecentMessages,
    setMemoryEnabled,
    setMemoryInjectionEnabled,
    setMemoryMaxFacts,
    setMemoryConfidenceThreshold,
    setToolSearchEnabled,
    setGitAutoCommit,
    setToolPermissions,
    setEmployeeRuntimeDefault,
    setMainHarnessPolicy,
    setRuntimeModelDefault,
    setRuntimeModelOverrides,
    applyFromSaved,
    applyDefaults,
    buildRuntimePolicy,
    snapshot,
  };
}

export { DEFAULT_POLICY };
