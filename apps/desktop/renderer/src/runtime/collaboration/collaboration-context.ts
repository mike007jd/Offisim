// Collaboration context + speaker scheduling — the PURE, deterministic core of
// the collaboration turn controller (PR-03). No Tauri, no model, no DB: every
// function here is a total function of its inputs so the harness can reproduce
// mention parsing, speaker order, and the context packet byte-for-byte.
//
// The context packet is the ONLY thing the model sees, and it is built to a
// strict allowlist (company name; thread title + reply policy; minimal
// participant identity/persona summary; a limited recent message window; the
// current speaker + trigger message; an explicit "daily chat — no project work,
// no tools, do not claim to have modified files" instruction). It FORBIDS:
// workspace path, the Office hidden system prompt, mission criteria, and any
// non-participating member's private memory.

import type {
  CollaborationMessage,
  CollaborationReplyPolicy,
} from '@offisim/shared-types';

/** A thread participant the controller may schedule + describe in the packet. */
export interface CollaborationParticipant {
  employeeId: string;
  /** Display name used for @mention matching and attribution. */
  name: string;
  /** Short role/title line, identity context only. */
  role?: string | null;
  /**
   * A minimal persona summary for the packet. This is the ONLY persona text that
   * crosses into the model — never the full Office hidden system prompt and never
   * another member's private memory.
   */
  personaSummary?: string | null;
}

/** The bounded recent-message window the packet includes (oldest → newest). */
const COLLABORATION_CONTEXT_MESSAGE_WINDOW = 12;

/** Default + hard caps for roundtable speakers (the service also clamps 1–8). */
const ROUNDTABLE_DEFAULT_MAX_SPEAKERS = 3;
export const ROUNDTABLE_HARD_CAP_SPEAKERS = 8;

/**
 * Parse explicit `@Name` mentions from a message body, resolved against the
 * thread's participant roster. Returns the matched participants in the ORDER they
 * first appear in the text (deterministic), de-duplicated. Matching is
 * case-insensitive on the display name; only whole-token matches count so
 * `@Alex` does not match an employee named "Alexis". A name with spaces is
 * matched as a contiguous run (`@Maria Tan`).
 */
export function parseMentions(
  body: string,
  participants: readonly CollaborationParticipant[],
): CollaborationParticipant[] {
  if (!body) return [];
  const byNameLower = new Map<string, CollaborationParticipant>();
  for (const p of participants) {
    if (p.name) byNameLower.set(p.name.toLowerCase(), p);
  }
  // Sort candidate names longest-first so a multi-word name wins over a prefix.
  const candidates = [...byNameLower.keys()].sort((a, b) => b.length - a.length);
  const found: CollaborationParticipant[] = [];
  const seen = new Set<string>();
  // Walk every '@' and try to match the longest candidate name starting there.
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== '@') continue;
    const rest = body.slice(i + 1).toLowerCase();
    for (const name of candidates) {
      if (!rest.startsWith(name)) continue;
      // Whole-token guard: the char after the name must be a boundary (not a
      // letter/digit) so `@Alex` ≠ `@Alexis`.
      const after = rest.charAt(name.length);
      if (after && /[a-z0-9]/i.test(after)) continue;
      const participant = byNameLower.get(name);
      if (participant && !seen.has(participant.employeeId)) {
        seen.add(participant.employeeId);
        found.push(participant);
      }
      break; // longest match wins; move on to the next '@'
    }
  }
  return found;
}

/**
 * Deterministic speaker order for a group turn: explicit mention order FIRST,
 * then the remaining thread members in their roster order. Never random — the
 * roundtable must be reproducible. `mentioned` carries the parsed mention order;
 * `members` is the full active roster in its stable order.
 */
export function scheduleSpeakers(
  mentioned: readonly CollaborationParticipant[],
  members: readonly CollaborationParticipant[],
): CollaborationParticipant[] {
  const order: CollaborationParticipant[] = [];
  const seen = new Set<string>();
  for (const m of mentioned) {
    if (!seen.has(m.employeeId)) {
      seen.add(m.employeeId);
      order.push(m);
    }
  }
  for (const m of members) {
    if (!seen.has(m.employeeId)) {
      seen.add(m.employeeId);
      order.push(m);
    }
  }
  return order;
}

/**
 * Clamp the requested roundtable speaker count to the policy window: default 3,
 * hard cap 8, floor 1. A NaN / absent request falls back to the default.
 */
export function clampRoundtableSpeakers(requested: number | undefined): number {
  if (requested == null || Number.isNaN(requested)) return ROUNDTABLE_DEFAULT_MAX_SPEAKERS;
  return Math.min(
    ROUNDTABLE_HARD_CAP_SPEAKERS,
    Math.max(1, Math.trunc(requested)),
  );
}

/** A completed prior reply this round, fed to a later speaker as context. */
export interface PriorRoundReply {
  speakerName: string;
  body: string;
}

export interface BuildContextPacketInput {
  companyName: string;
  threadTitle: string;
  replyPolicy: CollaborationReplyPolicy;
  /** Every active participant — identity context only. */
  participants: readonly CollaborationParticipant[];
  /** The bounded recent-message window (oldest → newest), already trimmed. */
  recentMessages: readonly CollaborationMessage[];
  /** The employee that is about to speak. */
  speaker: CollaborationParticipant;
  /** The boss/user message (or round anchor) that triggered this turn. */
  triggerMessageBody: string;
  /** Prior speakers' completed replies THIS round (so employees can talk to each other). */
  priorRoundReplies?: readonly PriorRoundReply[];
}

/** The forbidden tokens a context packet must never contain (defense-in-depth;
 *  the harness asserts none of these leak). */
export const FORBIDDEN_CONTEXT_MARKERS = Object.freeze([
  'workspace_root',
  'workspaceRoot',
  'project_id',
  'mission criteria',
  'evaluator',
  'hidden system prompt',
]);

/**
 * Build the collaboration context packet (the `systemPromptAppend` the host
 * forwards as the speaking employee's appended system prompt). Strict allowlist —
 * see the module header. Deterministic given its inputs.
 */
export function buildContextPacket(input: BuildContextPacketInput): string {
  const lines: string[] = [];
  lines.push('# Daily company chat');
  lines.push(
    `You are ${input.speaker.name}${input.speaker.role ? `, ${input.speaker.role}` : ''} at ${input.companyName}.`,
  );
  if (input.speaker.personaSummary) {
    lines.push(input.speaker.personaSummary.trim());
  }
  lines.push('');
  lines.push(`This is the chat thread "${input.threadTitle}" (reply policy: ${input.replyPolicy}).`);
  lines.push(
    'This is everyday company chat — NOT project work. You have no tools, no files, and no workspace here. Do not run commands, do not claim to have edited or created any file, and do not invent task results. Just talk like a teammate in a group chat: concise and in character.',
  );

  const others = input.participants.filter((p) => p.employeeId !== input.speaker.employeeId);
  if (others.length > 0) {
    lines.push('');
    lines.push('People in this chat:');
    for (const p of others) {
      lines.push(`- ${p.name}${p.role ? ` (${p.role})` : ''}`);
    }
  }

  if (input.recentMessages.length > 0) {
    lines.push('');
    lines.push('Recent messages (oldest first):');
    for (const m of input.recentMessages) {
      lines.push(`- ${labelForMessage(m, input.participants)}: ${m.body}`);
    }
  }

  if (input.priorRoundReplies && input.priorRoundReplies.length > 0) {
    lines.push('');
    lines.push('Replies already given this round (you may respond to them):');
    for (const r of input.priorRoundReplies) {
      lines.push(`- ${r.speakerName}: ${r.body}`);
    }
  }

  lines.push('');
  lines.push(`Latest message you are replying to: ${input.triggerMessageBody}`);
  lines.push(`Reply as ${input.speaker.name}.`);
  return lines.join('\n');
}

/** Human label for a message in the recent window (boss / system / employee name). */
function labelForMessage(
  message: CollaborationMessage,
  participants: readonly CollaborationParticipant[],
): string {
  if (message.senderType === 'boss') return 'Boss';
  if (message.senderType === 'system') return 'System';
  const employee = participants.find((p) => p.employeeId === message.senderEmployeeId);
  return employee?.name ?? 'Teammate';
}

/** Trim a thread's message list to the bounded recent window (oldest → newest).
 *  `messages` may be in any order; this sorts by createdAt ascending and keeps
 *  the last `window` entries. */
export function recentWindow(
  messages: readonly CollaborationMessage[],
  window = COLLABORATION_CONTEXT_MESSAGE_WINDOW,
): CollaborationMessage[] {
  const ordered = [...messages].sort((a, b) => {
    const t = a.createdAt.localeCompare(b.createdAt);
    return t !== 0 ? t : a.messageId.localeCompare(b.messageId);
  });
  return ordered.slice(Math.max(0, ordered.length - window));
}
