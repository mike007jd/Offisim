import type { EmployeeProjectMemoryRow, EmployeeProjectMemoryType } from '@offisim/core/browser';

const EMPLOYEE_PROJECT_EXPERIENCE_TOKEN_BUDGET = 1_500;

export const EMPLOYEE_MEMORY_TYPE_LABELS: Record<EmployeeProjectMemoryType, string> = {
  pitfall: 'Pitfall',
  repository_preference: 'Repository preference',
  convention: 'Convention',
  retrospective: 'Retrospective',
};

function estimateTokens(text: string): number {
  let asciiRun = 0;
  let tokens = 0;
  for (const character of text) {
    if ((character.codePointAt(0) ?? 0) <= 0x7f) {
      asciiRun += 1;
    } else {
      tokens += Math.ceil(asciiRun / 4) + 1;
      asciiRun = 0;
    }
  }
  return tokens + Math.ceil(asciiRun / 4);
}

export function buildProjectExperienceSection(rows: readonly EmployeeProjectMemoryRow[]): {
  text: string | null;
  memoryIds: string[];
} {
  const lines = ['## Project experience', 'Apply these learned project-specific lessons:'];
  const memoryIds: string[] = [];
  for (const row of rows) {
    const line = `- [${EMPLOYEE_MEMORY_TYPE_LABELS[row.memory_type]}] ${row.content}`;
    if (estimateTokens([...lines, line].join('\n')) > EMPLOYEE_PROJECT_EXPERIENCE_TOKEN_BUDGET) {
      break;
    }
    lines.push(line);
    memoryIds.push(row.memory_id);
  }
  return memoryIds.length > 0 ? { text: lines.join('\n'), memoryIds } : { text: null, memoryIds };
}
