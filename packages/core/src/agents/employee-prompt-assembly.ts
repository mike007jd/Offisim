import type { SkillMetadata } from '@offisim/shared-types';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import type { CitationEntry } from '../services/library-service.js';
import { LibraryService } from '../services/library-service.js';
import { sanitizeForPrompt } from '../utils/sanitize-prompt.js';
import { buildEmployeePrompt } from './employee-builder.js';
import { formatMemoriesSection } from './employee-memory-tools.js';
import type { PreflightResult } from './employee-preflight.js';
import { buildEnrichedEmployeeList } from './employee-roster.js';

const DESCRIPTION_TRUNCATION_LIMIT = 200;

function truncateDescription(text: string): string {
  if (text.length <= DESCRIPTION_TRUNCATION_LIMIT) return text;
  return `${text.slice(0, DESCRIPTION_TRUNCATION_LIMIT)}…`;
}

export function formatAvailableSkillsSection(skills: SkillMetadata[]): string {
  if (skills.length === 0) return '';
  const lines = ['', '## Available skills', ''];
  for (const skill of skills) {
    const name = sanitizeForPrompt(skill.name, 120);
    const desc = sanitizeForPrompt(truncateDescription(skill.description), 240);
    lines.push(`- **${name}** — ${desc}`);
  }
  return `\n${lines.join('\n')}`;
}

export interface AssembledPrompt {
  readonly systemPrompt: string;
  readonly citationMap: CitationEntry[];
}

/**
 * Compose the employee system prompt.
 *
 * Sections (in order, each optional):
 *   1. Base employee prompt (persona + company)
 *   2. Available skills list (progressive disclosure tier 1, frontmatter-only)
 *   3. Relevant memories (gated on memoryService + taskDescription + memoryPolicy.injectionEnabled)
 *   4. Relevant library documents with numbered citations
 *   5. Shared scratchpad (up to 5 entries)
 *
 * Memory and library retrieval failures are silently skipped — prompt assembly never throws.
 */
export async function assemblePrompt(
  preflight: PreflightResult,
  runtimeCtx: RuntimeContext,
): Promise<AssembledPrompt> {
  const { employee, company, taskDescription, memoryPolicy } = preflight;
  const { memoryService, repos, eventBus, scratchpad, companyId, skillLoader } = runtimeCtx;

  let systemPrompt = buildEmployeePrompt(employee, company, taskDescription);

  if (skillLoader) {
    try {
      const skills = await skillLoader.listSkillsForEmployee(companyId, employee.employee_id);
      systemPrompt += formatAvailableSkillsSection(skills);
    } catch {
      // Skill listing failures are non-critical — prompt assembly must not throw.
    }
  }

  try {
    const roster = await repos.employees.findByCompany(companyId);
    const coworkers = roster.filter((row) => row.employee_id !== employee.employee_id);
    if (coworkers.length > 0) {
      systemPrompt += `\n\n## Available coworkers\n\nWhen a tool requires an employee_id (e.g. installing a skill to a specific person), look it up from this list. Prefer the employee_id over the name.\n\n${buildEnrichedEmployeeList(
        coworkers,
      )}`;
    }
  } catch {
    // Roster assembly failure is non-critical.
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

  return { systemPrompt, citationMap };
}
