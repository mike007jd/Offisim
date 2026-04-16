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

export interface RuntimeSkillCapability {
  kind?: string;
  key?: string;
  label?: string;
}

export interface RuntimeSkillConfig {
  skillName: string;
  summary: string;
  enabled?: boolean;
  instructionMode?: string;
  instructionExcerpt?: string;
  instructions?: string;
  capabilityIndex?: {
    summary?: string;
    requiredCapabilities?: string[];
    capabilities?: RuntimeSkillCapability[];
  };
  allowedTools?: string[];
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
  runtimeSkill?: RuntimeSkillConfig;
  toolPermissionPolicy?: EmployeeToolPermissionPolicy;
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

function pickRuntimeSkill(value: unknown): RuntimeSkillConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const skillName = pickString(raw.skillName);
  const summary = pickString(raw.summary);
  if (skillName === undefined || summary === undefined) return undefined;

  const result: RuntimeSkillConfig = { skillName, summary };
  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : undefined;
  if (enabled !== undefined) result.enabled = enabled;
  const instructionMode = pickString(raw.instructionMode);
  if (instructionMode !== undefined) result.instructionMode = instructionMode;
  const instructionExcerpt = pickString(raw.instructionExcerpt);
  if (instructionExcerpt !== undefined) result.instructionExcerpt = instructionExcerpt;
  const instructions = pickString(raw.instructions);
  if (instructions !== undefined) result.instructions = instructions;

  if (raw.capabilityIndex && typeof raw.capabilityIndex === 'object') {
    const ci = raw.capabilityIndex as Record<string, unknown>;
    const capabilityIndex: RuntimeSkillConfig['capabilityIndex'] = {};
    const ciSummary = pickString(ci.summary);
    if (ciSummary !== undefined) capabilityIndex.summary = ciSummary;
    if (Array.isArray(ci.requiredCapabilities)) {
      capabilityIndex.requiredCapabilities = ci.requiredCapabilities.filter(
        (cap): cap is string => typeof cap === 'string',
      );
    }
    if (Array.isArray(ci.capabilities)) {
      capabilityIndex.capabilities = ci.capabilities.flatMap((cap) => {
        if (!cap || typeof cap !== 'object') return [];
        const c = cap as Record<string, unknown>;
        const entry: RuntimeSkillCapability = {};
        const kind = pickString(c.kind);
        if (kind !== undefined) entry.kind = kind;
        const key = pickString(c.key);
        if (key !== undefined) entry.key = key;
        const label = pickString(c.label);
        if (label !== undefined) entry.label = label;
        return [entry];
      });
    }
    result.capabilityIndex = capabilityIndex;
  }

  if (Array.isArray(raw.allowedTools)) {
    result.allowedTools = raw.allowedTools.filter(
      (tool): tool is string => typeof tool === 'string',
    );
  }

  return result;
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
  const runtimeSkill = pickRuntimeSkill(obj.runtimeSkill);
  if (runtimeSkill !== undefined) config.runtimeSkill = runtimeSkill;
  const toolPermissionPolicy = pickToolPermissionPolicy(obj.toolPermissionPolicy);
  if (toolPermissionPolicy !== undefined) config.toolPermissionPolicy = toolPermissionPolicy;
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
