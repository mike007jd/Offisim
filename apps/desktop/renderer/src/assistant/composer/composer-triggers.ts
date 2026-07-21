import { useUiState } from '@/app/ui-state.js';
import type { PermissionMode } from '@/runtime/pi-thread-mode-store.js';
import type {
  Unstable_DirectiveFormatter,
  Unstable_DirectiveSegment,
  Unstable_Mention,
  Unstable_SlashCommand,
} from '@assistant-ui/react';
import { openLoopPicker } from './loop-picker-store.js';

/**
 * Composer trigger wiring for the Office thread.
 *
 * `@` mentions address a teammate for a single turn; `/` commands fire an
 * immediate action. assistant-ui owns char detection, filtering, and keyboard
 * navigation (via `Unstable_TriggerPopover`); this module supplies the data and
 * the send-time extraction.
 *
 * assistant-ui's composer input is a plain multi-line text field that cannot
 * render mention chips, so the default `:type[label]{name=id}` directive syntax
 * would surface raw tokens to the user. We serialize mentions to a clean
 * Slack-style `@Name` instead and recover the employee id at send time by
 * matching `@Name` against the live roster.
 */

export interface MentionEmployee {
  id: string;
  /** Display name, also the literal `@`-token text. */
  label: string;
  role?: string;
}

/**
 * Build the mention roster from the company directory. Shared by the trigger
 * popover (display list) and send-time id extraction so the two can never
 * disagree about an employee's `@`-label and mis-route a turn.
 */
export function toMentionRoster(
  employees: Iterable<{ id: string; name: string; role: string }>,
): MentionEmployee[] {
  return Array.from(employees, (employee) => ({
    id: employee.id,
    label: employee.name,
    role: employee.role,
  }));
}

/** Mentionable employee items for `unstable_useMentionAdapter`. */
export function employeeMentionItems(employees: readonly MentionEmployee[]): Unstable_Mention[] {
  return employees.map((employee) => ({
    id: employee.id,
    type: 'employee',
    label: employee.label,
    description: employee.role,
  }));
}

/** Roster sorted longest-label-first so prefix names never shadow longer ones. */
function sortedRoster(roster: readonly MentionEmployee[]): MentionEmployee[] {
  return [...roster]
    .filter((employee) => employee.label)
    .sort((a, b) => b.label.length - a.label.length);
}

/**
 * Split directive text into literal text + resolved `@employee` mentions by
 * matching against the known roster (longest match wins). Used both as the
 * adapter's `parse` (keeps assistant-ui's directive accounting consistent) and
 * as the basis for send-time id extraction. Exported so the Prompt Enhance
 * protected-span extractor (PR-06) reuses the SAME mention tokenizer the composer
 * uses, instead of re-detecting `@Name` with a second, drift-prone parser.
 */
export function parseMentionSegments(
  text: string,
  roster: readonly MentionEmployee[],
): Unstable_DirectiveSegment[] {
  const sorted = sortedRoster(roster);
  const segments: Unstable_DirectiveSegment[] = [];
  let buffer = '';
  for (let i = 0; i < text.length; ) {
    if (text[i] === '@') {
      const after = text.slice(i + 1);
      const hit = sorted.find((employee) => {
        if (!after.startsWith(employee.label)) return false;
        // Require a word boundary after the name so "@Al" never matches inside
        // "@Alice" when only the shorter name is on the roster.
        const next = after[employee.label.length];
        return next === undefined || /[\s.,!?;:)@'"]/u.test(next);
      });
      if (hit) {
        if (buffer) {
          segments.push({ kind: 'text', text: buffer });
          buffer = '';
        }
        segments.push({ kind: 'mention', type: 'employee', label: hit.label, id: hit.id });
        i += 1 + hit.label.length;
        continue;
      }
    }
    buffer += text[i];
    i += 1;
  }
  if (buffer) segments.push({ kind: 'text', text: buffer });
  return segments;
}

/** Directive formatter that keeps mentions as clean `@Name` plain text. */
export function makeEmployeeDirectiveFormatter(
  roster: readonly MentionEmployee[],
): Unstable_DirectiveFormatter {
  return {
    serialize: (item) => `@${item.label}`,
    parse: (text) => parseMentionSegments(text, roster),
  };
}

/**
 * Employee ids `@`-mentioned in a sent message, in order of first appearance.
 * The first becomes that turn's routing target (overriding the thread assignee).
 */
export function extractMentionedEmployeeIds(
  text: string,
  roster: readonly MentionEmployee[],
): string[] {
  const ids: string[] = [];
  for (const segment of parseMentionSegments(text, roster)) {
    if (segment.kind === 'mention' && !ids.includes(segment.id)) ids.push(segment.id);
  }
  return ids;
}

/**
 * Slash palette groups, in display order. The assistant-ui slash adapter
 * renders one flat, query-filtered list, so grouping is a presentation
 * concern: every command carries a category and the popover inserts quiet
 * group headers between runs of the same category.
 */
export type SlashCategory = 'commands' | 'skills' | 'tools' | 'modes' | 'navigation';

export const SLASH_CATEGORY_LABEL: Record<SlashCategory, string> = {
  commands: 'Commands',
  skills: 'Skills',
  tools: 'Tools & MCP',
  modes: 'Modes',
  navigation: 'Navigation',
};

export interface OfficeSlashCommand extends Unstable_SlashCommand {
  readonly category: SlashCategory;
}

interface SlashSkillItem {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

interface SlashToolItem {
  readonly id: string;
  readonly serverName: string;
  readonly toolName: string;
  readonly title: string;
  readonly description?: string;
}

export interface BuildSlashCommandsOptions {
  /** Skills the thread's employee can run right now. */
  readonly skills?: readonly SlashSkillItem[];
  /** MCP tools granted to the thread's employee right now. */
  readonly tools?: readonly SlashToolItem[];
  /** Inserts an executable directive at the composer's caret. */
  readonly insertText?: (text: string) => void;
  /** Switches the thread's permission mode. */
  readonly setMode?: (mode: PermissionMode) => void;
}

const MODE_COMMANDS: ReadonlyArray<{ mode: PermissionMode; label: string; description: string }> = [
  { mode: 'plan', label: 'Plan mode', description: 'Read-only — investigate, no changes' },
  { mode: 'ask', label: 'Ask mode', description: 'Read-only — approve changes and internet' },
  { mode: 'auto', label: 'Auto mode', description: 'Runs in the Project — asks when needed' },
  { mode: 'full', label: 'Full mode', description: 'No restrictions' },
];

/**
 * `/` commands. Each maps to a real action — no placeholder commands. Read
 * fresh state inside `execute` so the action always targets the currently-open
 * conversation.
 *
 * `/loop` is the dedicated Loop reference path (PR-10) — it opens a searchable
 * Loop picker that inserts a structured, pinned-revision chip. `@` stays
 * people-only (employee mentions); the two never overload.
 *
 * `/skill …` and `/tool …` expand the items actually available to the thread's
 * employee and insert an executable directive into the composer; the
 * management routes stay as explicit "Manage …" entries instead of being the
 * only outcome.
 */
export function buildSlashCommands(options: BuildSlashCommandsOptions = {}): OfficeSlashCommand[] {
  const { skills = [], tools = [], insertText, setMode } = options;
  const commands: OfficeSlashCommand[] = [
    {
      id: 'new',
      category: 'commands',
      label: 'New conversation',
      description: 'Start a fresh team conversation',
      execute: () => useUiState.getState().openDraftThread(),
    },
    {
      id: 'loop',
      category: 'commands',
      label: 'Reference a Loop',
      description: 'Insert a saved Loop to run when you Send',
      execute: () => openLoopPicker(),
    },
  ];

  for (const skill of skills) {
    commands.push({
      id: `skill:${skill.name}`,
      category: 'skills',
      label: `/skill ${skill.name}`,
      description: skill.description || 'Insert this skill directive',
      execute: () => insertText?.(`/skill ${skill.name} `),
    });
  }
  commands.push({
    id: 'skill',
    category: 'skills',
    label: skills.length ? 'Manage skills' : 'Skills',
    description: skills.length
      ? 'Browse and assign skills in Personnel'
      : 'Browse the skills employees can run',
    execute: () => useUiState.getState().setSurface('personnel'),
  });

  for (const tool of tools) {
    commands.push({
      id: `tool:${tool.id}`,
      category: 'tools',
      label: `/tool ${tool.toolName}`,
      description: `${tool.serverName} · ${tool.description || tool.title}`,
      execute: () => insertText?.(`/tool ${tool.toolName} `),
    });
  }
  commands.push({
    id: 'tool',
    category: 'tools',
    label: tools.length ? 'Manage tools & MCP' : 'Tools & MCP',
    description: tools.length
      ? 'Manage MCP servers and tool grants'
      : 'Connect MCP servers to grant tools',
    execute: () => useUiState.getState().openSettings('mcp'),
  });

  if (setMode) {
    for (const entry of MODE_COMMANDS) {
      commands.push({
        id: entry.mode,
        category: 'modes',
        label: entry.label,
        description: entry.description,
        execute: () => setMode(entry.mode),
      });
    }
  }

  commands.push(
    {
      id: 'browser',
      category: 'navigation',
      label: 'Browser',
      description: 'See rendered browser pages from runs',
      execute: () => useUiState.getState().openBoard('timeline'),
    },
    {
      id: 'computer',
      category: 'navigation',
      label: 'Computer Use',
      description: 'Set up the desktop-control capability',
      execute: () => useUiState.getState().openSettings('computer'),
    },
    {
      id: 'memory',
      category: 'navigation',
      label: 'Memory',
      description: 'Open agent memory and reusable context',
      execute: () => useUiState.getState().setSurface('personnel'),
    },
    {
      id: 'output',
      category: 'navigation',
      label: 'Outputs',
      description: 'View artifacts produced by runs',
      execute: () => useUiState.getState().openBoard('timeline'),
    },
    {
      id: 'inbox',
      category: 'navigation',
      label: 'Open conversations',
      description: 'Return to the Office conversation list',
      execute: () => {
        const state = useUiState.getState();
        state.closeThread();
      },
    },
    {
      id: 'activity',
      category: 'navigation',
      label: 'Activity log',
      description: 'Open the run activity log',
      execute: () => useUiState.getState().openBoard('timeline'),
    },
    {
      id: 'settings',
      category: 'navigation',
      label: 'Settings',
      description: 'Open settings',
      execute: () => useUiState.getState().setSurface('settings'),
    },
  );

  return commands;
}
