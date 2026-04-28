import type { EmployeeRuntimeBinding, EngineId } from './models.js';
import type { CommunicationFrequency, DecisionStyle, RiskPreference } from './persona.js';
import type { PrefabBinding } from './prefab.js';

export interface EmployeeAppearance {
  skinColor: number;
  hairColor: number;
  hairStyle: string;
  clothingColor: number;
  clothingAccent: number;
  bodyType: string;
  gender: 'neutral' | 'masculine' | 'feminine';
}

export interface EmployeePersona {
  expertise?: string;
  style?: string;
  customInstructions?: string;
  avatarSeed?: string;
  appearance?: EmployeeAppearance;
  communicationFrequency?: CommunicationFrequency;
  riskPreference?: RiskPreference;
  decisionStyle?: DecisionStyle;
}

export type EmployeeToolApprovalMode = 'auto' | 'ask_first_time' | 'always_ask';

export interface EmployeeToolPermissionOverride {
  pattern: string;
  mode: EmployeeToolApprovalMode;
}

export interface EmployeeToolPermissionPolicy {
  defaultMode: EmployeeToolApprovalMode;
  overrides: EmployeeToolPermissionOverride[];
}

export interface EmployeeConfig {
  modelPreference?: string;
  temperature?: number;
  maxTokens?: number;
  toolPermissionPolicy?: EmployeeToolPermissionPolicy;
  runtimeBinding?: EmployeeRuntimeBinding;
}

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function pickNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function pickAppearance(value: unknown): EmployeeAppearance | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<EmployeeAppearance> & Record<string, unknown>;
  if (
    typeof candidate.skinColor !== 'number' ||
    typeof candidate.hairColor !== 'number' ||
    typeof candidate.hairStyle !== 'string' ||
    typeof candidate.clothingColor !== 'number' ||
    typeof candidate.clothingAccent !== 'number' ||
    typeof candidate.bodyType !== 'string' ||
    (candidate.gender !== 'neutral' &&
      candidate.gender !== 'masculine' &&
      candidate.gender !== 'feminine')
  ) {
    return undefined;
  }
  return {
    skinColor: candidate.skinColor,
    hairColor: candidate.hairColor,
    hairStyle: candidate.hairStyle,
    clothingColor: candidate.clothingColor,
    clothingAccent: candidate.clothingAccent,
    bodyType: candidate.bodyType,
    gender: candidate.gender,
  };
}

function pickCommunicationFrequency(value: unknown): CommunicationFrequency | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

function pickRiskPreference(value: unknown): RiskPreference | undefined {
  return value === 'conservative' || value === 'balanced' || value === 'aggressive'
    ? value
    : undefined;
}

function pickDecisionStyle(value: unknown): DecisionStyle | undefined {
  return value === 'analytical' ||
    value === 'intuitive' ||
    value === 'collaborative' ||
    value === 'directive'
    ? value
    : undefined;
}

function pickToolApprovalMode(value: unknown): EmployeeToolApprovalMode | undefined {
  return value === 'auto' || value === 'ask_first_time' || value === 'always_ask'
    ? value
    : undefined;
}

function pickToolPermissionPolicy(value: unknown): EmployeeToolPermissionPolicy | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as { defaultMode?: unknown; overrides?: unknown };
  const defaultMode = pickToolApprovalMode(raw.defaultMode);
  if (!defaultMode) return undefined;
  const overrides: EmployeeToolPermissionOverride[] = Array.isArray(raw.overrides)
    ? raw.overrides.flatMap((override) => {
        if (!override || typeof override !== 'object') return [];
        const o = override as { pattern?: unknown; mode?: unknown };
        const pattern = typeof o.pattern === 'string' ? o.pattern.trim() : '';
        const mode = pickToolApprovalMode(o.mode);
        if (!pattern || !mode) return [];
        return [{ pattern, mode }];
      })
    : [];
  return { defaultMode, overrides };
}

function pickEngineId(value: unknown): EngineId | undefined {
  return value === 'codex-engine' || value === 'claude-engine' ? value : undefined;
}

function pickEmployeeRuntimeBinding(value: unknown): EmployeeRuntimeBinding | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as { mode?: unknown; engineId?: unknown };
  if (raw.mode === 'provider') {
    return { mode: 'provider' };
  }
  if (raw.mode === 'engine') {
    const engineId = pickEngineId(raw.engineId);
    return engineId ? { mode: 'engine', engineId } : undefined;
  }
  return undefined;
}

/**
 * Parse an employee.persona_json string into a typed EmployeePersona.
 * All fields are optional; invalid JSON or non-object payloads return `{}`.
 */
export function parseEmployeePersona(raw: string | null): EmployeePersona {
  const obj = parseJsonObject(raw);
  if (!obj) return {};

  const persona: EmployeePersona = {};
  const expertise = pickString(obj.expertise);
  if (expertise !== undefined) persona.expertise = expertise;
  const style = pickString(obj.style);
  if (style !== undefined) persona.style = style;
  const customInstructions = pickString(obj.customInstructions);
  if (customInstructions !== undefined) persona.customInstructions = customInstructions;
  const avatarSeed = pickString(obj.avatarSeed);
  if (avatarSeed !== undefined) persona.avatarSeed = avatarSeed;
  const appearance = pickAppearance(obj.appearance);
  if (appearance !== undefined) persona.appearance = appearance;
  const communicationFrequency = pickCommunicationFrequency(obj.communicationFrequency);
  if (communicationFrequency !== undefined) persona.communicationFrequency = communicationFrequency;
  const riskPreference = pickRiskPreference(obj.riskPreference);
  if (riskPreference !== undefined) persona.riskPreference = riskPreference;
  const decisionStyle = pickDecisionStyle(obj.decisionStyle);
  if (decisionStyle !== undefined) persona.decisionStyle = decisionStyle;
  return persona;
}

/**
 * Parse an employee.config_json string into a typed EmployeeConfig.
 * All fields are optional; invalid JSON or non-object payloads return `{}`.
 */
export function parseEmployeeConfig(raw: string | null): EmployeeConfig {
  const obj = parseJsonObject(raw);
  if (!obj) return {};

  const config: EmployeeConfig = {};
  const modelPreference = pickString(obj.modelPreference);
  if (modelPreference !== undefined) config.modelPreference = modelPreference;
  const temperature = pickNumber(obj.temperature);
  if (temperature !== undefined) config.temperature = temperature;
  const maxTokens = pickNumber(obj.maxTokens);
  if (maxTokens !== undefined) config.maxTokens = maxTokens;
  const toolPermissionPolicy = pickToolPermissionPolicy(obj.toolPermissionPolicy);
  if (toolPermissionPolicy !== undefined) config.toolPermissionPolicy = toolPermissionPolicy;
  const runtimeBinding = pickEmployeeRuntimeBinding(obj.runtimeBinding);
  if (runtimeBinding !== undefined) config.runtimeBinding = runtimeBinding;
  return config;
}

/**
 * Parse a prefab_instances.bindings_json string into a validated PrefabBinding[].
 * Items missing `slotName` or `resourceRef` are filtered out.
 * Returns `[]` on null/invalid input.
 */
export function parsePrefabBindings(raw: string | null): PrefabBinding[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as { slotName?: unknown; resourceRef?: unknown; label?: unknown };
    if (typeof entry.slotName !== 'string' || entry.slotName.length === 0) return [];
    if (typeof entry.resourceRef !== 'string' || entry.resourceRef.length === 0) return [];
    const binding: PrefabBinding = {
      slotName: entry.slotName,
      resourceRef: entry.resourceRef,
      ...(typeof entry.label === 'string' ? { label: entry.label } : {}),
    };
    return [binding];
  });
}
