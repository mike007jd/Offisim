// ---------------------------------------------------------------------------
// Chat Command Registry — unified command system for Offisim chat input.
//
// Three command types:
//   runtime  — prompt sent to AI orchestration (like Claude Code's prompt commands)
//   client   — browser-local JS logic (like Claude Code's local commands)
//   panel    — open UI panels/dialogs (like Claude Code's local-jsx commands)
// ---------------------------------------------------------------------------

import type { RunToolPolicy } from '@offisim/shared-types';

export type CommandCategory = 'team' | 'workflow' | 'config' | 'chat';

export const COMMAND_CATEGORIES: Record<CommandCategory, { label: string; badgeClass: string }> = {
  team: { label: 'Team', badgeClass: 'bg-success-muted text-success' },
  workflow: { label: 'Workflow', badgeClass: 'bg-info-muted text-info' },
  config: { label: 'Config', badgeClass: 'bg-accent-muted text-accent' },
  chat: { label: 'Chat', badgeClass: 'bg-surface-muted text-text-muted' },
};

// ── Context types (provided by ChatPanel) ──────────────────────────

export interface ClientCommandContext {
  clearMessages: () => void;
  showHelp: () => void;
}

export interface PanelCommandContext {
  openSettings: () => void;
  openEditor: () => void;
  openStudio: () => void;
}

// ── Command types ──────────────────────────────────────────────────

interface ChatCommandBase {
  name: string;
  aliases?: string[];
  description: string;
  argumentHint?: string;
  category: CommandCategory;
  isEnabled?: () => boolean;
}

export interface RuntimeCommand extends ChatCommandBase {
  type: 'runtime';
  buildPrompt: (args: string) => string;
  entryMode?: 'boss_chat' | 'direct_chat' | 'meeting';
  runToolPolicy?: RunToolPolicy;
}

export interface ClientCommand extends ChatCommandBase {
  type: 'client';
  execute: (args: string, ctx: ClientCommandContext) => void;
}

export interface PanelCommand extends ChatCommandBase {
  type: 'panel';
  execute: (args: string, ctx: PanelCommandContext) => void;
}

export type ChatCommand = RuntimeCommand | ClientCommand | PanelCommand;

// ── Registry ───────────────────────────────────────────────────────

export const CHAT_COMMANDS: readonly ChatCommand[] = [
  // ── Team ──
  {
    type: 'runtime',
    name: 'hire',
    category: 'team',
    description: 'Start HR hiring flow',
    argumentHint: '[role] [requirements]',
    buildPrompt: (args) =>
      `I want to hire: ${args || 'a new team member'}. Assess the team needs and recommend a candidate profile.`,
  },
  {
    type: 'runtime',
    name: 'assess',
    category: 'team',
    description: 'Run team performance assessment',
    argumentHint: '[employee]',
    buildPrompt: (args) =>
      args
        ? `Assess ${args}'s performance, strengths, and areas for improvement.`
        : 'Run a comprehensive team assessment covering all employees.',
  },
  {
    type: 'runtime',
    name: 'assign',
    category: 'team',
    description: 'Assign a task to an employee',
    argumentHint: '<employee> <task>',
    buildPrompt: (args) => `Assign this task: ${args}`,
  },

  // ── Workflow ──
  {
    type: 'runtime',
    name: 'meeting',
    category: 'workflow',
    description: 'Start a team meeting',
    argumentHint: '[brainstorm|kickoff|standup|review] [topic]',
    entryMode: 'meeting',
    buildPrompt: (args) => {
      const parts = args.split(' ');
      const meetingType = parts[0] || 'brainstorm';
      const topic = parts.slice(1).join(' ');
      return topic
        ? `Start a ${meetingType} meeting about: ${topic}`
        : `Start a ${meetingType} meeting.`;
    },
  },
  {
    type: 'runtime',
    name: 'sop',
    category: 'workflow',
    description: 'Execute a saved workflow',
    argumentHint: '<sop-name>',
    buildPrompt: (args) => `Run the SOP: ${args}`,
  },
  {
    type: 'runtime',
    name: 'library',
    category: 'workflow',
    description: 'Reference a library document',
    argumentHint: '<document-name>',
    buildPrompt: (args) => `Reference this library document in your work: ${args}`,
  },
  {
    type: 'runtime',
    name: 'readonly',
    aliases: ['inspect'],
    category: 'workflow',
    description: 'Run without file or shell writes',
    argumentHint: '<task>',
    runToolPolicy: { readOnly: true },
    buildPrompt: (args) =>
      args || 'Inspect the current project and report findings without making changes.',
  },

  // ── Config ──
  {
    type: 'panel',
    name: 'settings',
    category: 'config',
    description: 'Open provider settings',
    execute: (_args, ctx) => ctx.openSettings(),
  },
  {
    type: 'panel',
    name: 'editor',
    category: 'config',
    description: 'Open office layout editor',
    execute: (_args, ctx) => ctx.openEditor(),
  },
  {
    type: 'panel',
    name: 'studio',
    category: 'config',
    description: 'Open decoration studio',
    execute: (_args, ctx) => ctx.openStudio(),
  },

  // ── Chat ──
  {
    type: 'client',
    name: 'clear',
    aliases: ['reset'],
    category: 'chat',
    description: 'Clear current conversation',
    execute: (_args, ctx) => ctx.clearMessages(),
  },
  {
    type: 'client',
    name: 'help',
    aliases: ['?', 'commands'],
    category: 'chat',
    description: 'Show available commands',
    execute: (_args, ctx) => ctx.showHelp(),
  },
];

// ── Parsing ────────────────────────────────────────────────────────

export function parseCommand(input: string): { command: ChatCommand; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const spaceIdx = trimmed.indexOf(' ');
  const name = (spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

  const cmd = CHAT_COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));
  if (!cmd) return null;
  if (cmd.isEnabled && !cmd.isEnabled()) return null;
  return { command: cmd, args };
}

export function getVisibleCommands(): ChatCommand[] {
  return CHAT_COMMANDS.filter((c) => !c.isEnabled || c.isEnabled());
}

export function filterCommands(query: string): ChatCommand[] {
  const q = query.toLowerCase();
  return getVisibleCommands().filter(
    (c) =>
      c.name.includes(q) ||
      c.aliases?.some((a) => a.includes(q)) ||
      c.description.toLowerCase().includes(q),
  );
}

// ── Help text ──────────────────────────────────────────────────────

export function buildHelpText(): string {
  const commands = getVisibleCommands();
  const byCategory = new Map<CommandCategory, ChatCommand[]>();

  for (const cmd of commands) {
    const list = byCategory.get(cmd.category) ?? [];
    list.push(cmd);
    byCategory.set(cmd.category, list);
  }

  const order: CommandCategory[] = ['team', 'workflow', 'config', 'chat'];
  const lines: string[] = ['Available commands:', ''];

  for (const cat of order) {
    const cmds = byCategory.get(cat);
    if (!cmds || cmds.length === 0) continue;
    lines.push(COMMAND_CATEGORIES[cat].label);
    for (const cmd of cmds) {
      const nameCol = cmd.aliases ? `/${cmd.name}, /${cmd.aliases.join(', /')}` : `/${cmd.name}`;
      const hint = cmd.argumentHint ? ` ${cmd.argumentHint}` : '';
      lines.push(`  ${(nameCol + hint).padEnd(28)} ${cmd.description}`);
    }
    lines.push('');
  }

  lines.push('Tip: Use @name to mention a specific employee in your message.');
  return lines.join('\n');
}

// ── @mention parsing ───────────────────────────────────────────────

export interface MentionHint {
  employeeId: string;
  name: string;
}

const AT_MENTION_PATTERN = /@(\S+)/g;

/** Extract raw @fragments from text (e.g. "@Alex" → ["Alex"]). */
export function extractAtFragments(text: string): string[] {
  return [...text.matchAll(AT_MENTION_PATTERN)].map((m) => m[1] ?? '').filter(Boolean);
}

export function extractMentionHints(
  text: string,
  agents: ReadonlyMap<string, { name: string }>,
): MentionHint[] {
  const mentions: MentionHint[] = [];
  const seen = new Set<string>();

  for (const fragment of extractAtFragments(text)) {
    for (const [id, agent] of agents) {
      if (!seen.has(id) && agent.name.toLowerCase().startsWith(fragment.toLowerCase())) {
        mentions.push({ employeeId: id, name: agent.name });
        seen.add(id);
      }
    }
  }

  return mentions;
}
