import type { RuntimeSkillConfig } from '@offisim/shared-types';
import { parseEmployeeConfig } from '@offisim/shared-types';
import type { CitationEntry } from '../services/library-service.js';
import { LibraryService } from '../services/library-service.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { sanitizeForPrompt } from '../utils/sanitize-prompt.js';
import { buildEmployeePrompt } from './employee-builder.js';
import { formatMemoriesSection } from './employee-memory-tools.js';
import { SKILL_TOOL_NAME } from './employee-node-constants.js';
import type { PreflightResult } from './employee-preflight.js';

export function parseRuntimeSkillConfig(configJson: string | null): RuntimeSkillConfig | null {
  const config = parseEmployeeConfig(configJson);
  if (!config.runtimeSkill || config.runtimeSkill.enabled === false) return null;
  return config.runtimeSkill;
}

export function normalizeSkillText(value: string): string {
  return value.trim().toLowerCase();
}

export function taskHasSkillMismatch(
  requiredSkills: string[],
  runtimeSkill: RuntimeSkillConfig | null,
): boolean {
  if (requiredSkills.length === 0) return false;
  if (!runtimeSkill) return true;
  const haystack = [
    runtimeSkill.skillName,
    runtimeSkill.summary,
    ...(runtimeSkill.capabilityIndex?.requiredCapabilities ?? []),
    ...(runtimeSkill.capabilityIndex?.capabilities ?? []).map(
      (cap) => cap.label ?? cap.key ?? cap.kind ?? '',
    ),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(normalizeSkillText)
    .join(' ');

  return !requiredSkills.some((skill) => haystack.includes(normalizeSkillText(skill)));
}

export function formatSkillCatalogSection(skill: RuntimeSkillConfig): string {
  const summary = sanitizeForPrompt(skill.capabilityIndex?.summary ?? skill.summary, 600);
  const excerpt = skill.instructionExcerpt
    ? sanitizeForPrompt(skill.instructionExcerpt, 800)
    : null;
  const requiredCapabilities = skill.capabilityIndex?.requiredCapabilities ?? [];
  const capabilities = skill.capabilityIndex?.capabilities ?? [];
  const lines = [
    '',
    '## Installed skill package',
    `Name: ${sanitizeForPrompt(skill.skillName, 120)}`,
    `Summary: ${summary}`,
  ];

  if (requiredCapabilities.length > 0) {
    lines.push(`Required capabilities: ${requiredCapabilities.join(', ')}`);
  }
  if (capabilities.length > 0) {
    lines.push(
      `Capability index: ${capabilities
        .map((cap) => sanitizeForPrompt(cap.label ?? cap.key ?? cap.kind ?? 'capability', 80))
        .join(', ')}`,
    );
  }
  if (excerpt) {
    lines.push(`Instruction preview: ${excerpt}`);
  }
  lines.push(
    `If you need the full skill instructions before acting, call \`${SKILL_TOOL_NAME}\` once and use the returned guidance.`,
  );
  return `\n${lines.join('\n')}`;
}

export function formatSkillInstructionsSection(skill: RuntimeSkillConfig): string {
  if (!skill.instructions) return '';
  return `\n\n## Installed skill instructions\n${sanitizeForPrompt(skill.instructions, 6000)}`;
}

export interface AssembledPrompt {
  readonly systemPrompt: string;
  readonly citationMap: CitationEntry[];
  readonly runtimeSkill: RuntimeSkillConfig | null;
}

/**
 * Compose the employee system prompt.
 *
 * Sections (in order, each optional):
 *   1. Base employee prompt (persona + company)
 *   2. Installed skill catalog (if runtimeSkill present)
 *   3. Full skill instructions (only when toolSearch is disabled)
 *   4. Relevant memories (gated on memoryService + taskDescription + memoryPolicy.injectionEnabled)
 *   5. Relevant library documents with numbered citations
 *   6. Shared scratchpad (up to 5 entries)
 *
 * Memory and library retrieval failures are silently skipped — prompt assembly never throws.
 */
export async function assemblePrompt(
  preflight: PreflightResult,
  runtimeCtx: RuntimeContext,
): Promise<AssembledPrompt> {
  const { employee, company, taskDescription, runtimeSkill, memoryPolicy, toolSearchEnabled } =
    preflight;
  const { memoryService, repos, eventBus, scratchpad, companyId } = runtimeCtx;

  let systemPrompt = buildEmployeePrompt(employee, company, taskDescription);
  if (runtimeSkill) {
    systemPrompt += formatSkillCatalogSection(runtimeSkill);
    if (!toolSearchEnabled) {
      systemPrompt += formatSkillInstructionsSection(runtimeSkill);
    }
  }

  if (memoryService && taskDescription && (memoryPolicy?.injectionEnabled ?? true)) {
    try {
      const relevantMemories = await memoryService.getRelevantMemories(
        employee.employee_id,
        companyId,
        taskDescription,
        memoryPolicy?.maxFacts ?? 10,
      );
      const memoriesSection = formatMemoriesSection(relevantMemories);
      if (memoriesSection) {
        systemPrompt += memoriesSection;
      }
    } catch {
      // Memory retrieval failure is non-critical
    }
  }

  let citationMap: CitationEntry[] = [];
  if (taskDescription && repos.libraryDocuments) {
    try {
      const libraryService = new LibraryService(repos.libraryDocuments, eventBus);
      const { text, citations } = await libraryService.getRelevantSnippetsWithCitations(
        companyId,
        taskDescription,
      );
      if (text) {
        citationMap = citations;
        systemPrompt += `\n\n## Relevant company documents\n${text}\n\nWhen referencing these documents, cite them using [N] notation.`;
      }
    } catch {
      // Library retrieval failure is non-critical
    }
  }

  const scratchpadEntries = scratchpad.list();
  if (scratchpadEntries.length > 0) {
    systemPrompt += `\n\n## Shared scratchpad\n${scratchpadEntries
      .slice(0, 5)
      .map((entry) => `- [${entry.author}] ${entry.summary}`)
      .join('\n')}`;
  }

  return { systemPrompt, citationMap, runtimeSkill };
}
