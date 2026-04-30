import { ArrowUp } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  COMMAND_CATEGORIES,
  type ChatCommand,
  filterCommands,
  parseCommand,
} from '../../lib/chat-commands.js';
import type { AgentState } from '../../runtime/use-agent-states';
import { useTourTarget } from '../onboarding/tour-context.js';

// ── Mention option ──────────────────────────────────────────────────

interface MentionOption {
  id: string;
  name: string;
  role: string;
}

// ── Role color mapping ─────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  developer: 'bg-info',
  engineer: 'bg-info',
  backend: 'bg-info',
  frontend: 'bg-accent',
  fullstack: 'bg-info',
  pm: 'bg-accent',
  product_manager: 'bg-accent',
  researcher: 'bg-success',
  analyst: 'bg-success',
  designer: 'bg-warning',
  artist: 'bg-warning',
  ui_designer: 'bg-warning',
  ux_designer: 'bg-warning',
};

function roleColor(role: string): string {
  return ROLE_COLORS[role] ?? 'bg-text-muted';
}

function resizeTextarea(element: HTMLTextAreaElement | null, currentText: string) {
  if (!element) return;
  element.style.height = 'auto';
  // Max 3 lines (~72px), min 1 line (32px)
  element.style.height = `${Math.min(element.scrollHeight, 72)}px`;
  void currentText;
}

// ── ChatInput props ─────────────────────────────────────────────────

export interface ChatInputProps {
  onSend: (
    message: string,
    options?: { entryMode?: 'boss_chat' | 'direct_chat' | 'meeting' },
  ) => void;
  onCommand: (command: ChatCommand, args: string) => void;
  disabled?: boolean;
  placeholder?: string;
  agents?: Map<string, AgentState>;
  disabledReason?: string;
}

export function ChatInput({
  onSend,
  onCommand,
  disabled,
  placeholder = 'Message your team...',
  agents,
  disabledReason,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Menu state ──────────────────────────────────────────────────
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);

  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(-1);

  const menuRef = useRef<HTMLDivElement>(null);

  // ── Mention options ─────────────────────────────────────────────
  const mentionOptions: MentionOption[] = useMemo(() => {
    if (!agents) return [];
    const entries = [...agents.entries()].map(([id, a]) => ({
      id,
      name: a.name,
      role: a.role,
    }));
    return [{ id: 'team', name: 'Team', role: 'Everyone' }, ...entries];
  }, [agents]);

  // ── Filtered lists ──────────────────────────────────────────────
  const filteredSlash: ChatCommand[] = useMemo(() => {
    return filterCommands(slashFilter);
  }, [slashFilter]);

  const filteredMentions = useMemo(() => {
    const q = mentionFilter.toLowerCase();
    return mentionOptions.filter(
      (m) => m.name.toLowerCase().includes(q) || m.role.toLowerCase().includes(q),
    );
  }, [mentionFilter, mentionOptions]);

  // ── Auto-resize textarea ────────────────────────────────────────
  useEffect(() => {
    resizeTextarea(textareaRef.current, text);
  }, [text]);

  // ── Close menus on outside click ────────────────────────────────
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowSlashMenu(false);
        setShowMentionMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // ── Clamp indices ───────────────────────────────────────────────
  useEffect(() => {
    if (slashIndex >= filteredSlash.length) setSlashIndex(Math.max(0, filteredSlash.length - 1));
  }, [filteredSlash.length, slashIndex]);

  useEffect(() => {
    if (mentionIndex >= filteredMentions.length)
      setMentionIndex(Math.max(0, filteredMentions.length - 1));
  }, [filteredMentions.length, mentionIndex]);

  // ── Input change handler ────────────────────────────────────────
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    resizeTextarea(e.currentTarget, val);

    // Slash menu: triggers when input starts with /
    if (val.startsWith('/')) {
      const afterSlash = val.slice(1).split(' ')[0] ?? '';
      setSlashFilter(afterSlash);
      setShowSlashMenu(true);
      setSlashIndex(0);
      // Close mention menu if slash is active
      setShowMentionMenu(false);
    } else {
      setShowSlashMenu(false);
    }

    // Mention menu: triggers when @ is typed
    if (!val.startsWith('/')) {
      const cursorPos = e.target.selectionStart ?? val.length;
      // Search backwards from cursor for @
      const beforeCursor = val.slice(0, cursorPos);
      const lastAt = beforeCursor.lastIndexOf('@');
      if (lastAt >= 0) {
        // Check there's no space before @ (or @ is at start)
        const charBefore = lastAt > 0 ? beforeCursor[lastAt - 1] : ' ';
        if (lastAt === 0 || charBefore === ' ' || charBefore === '\n') {
          const fragment = beforeCursor.slice(lastAt + 1);
          // Only show menu if we haven't completed the mention (no space after name)
          if (!fragment.includes(' ')) {
            setMentionFilter(fragment);
            setMentionStartPos(lastAt);
            setShowMentionMenu(true);
            setMentionIndex(0);
            return;
          }
        }
      }
      setShowMentionMenu(false);
    }
  }, []);

  // ── Send logic ──────────────────────────────────────────────────
  function clearComposer() {
    setText('');
    setShowSlashMenu(false);
    setShowMentionMenu(false);
    setSlashFilter('');
    setMentionFilter('');
  }

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;

    const parsed = parseCommand(trimmed);
    if (parsed) {
      onCommand(parsed.command, parsed.args);
      clearComposer();
      return;
    }

    // Not a command (or unrecognized /something) — send as regular message
    onSend(trimmed);
    clearComposer();
  }

  // ── Select slash command ────────────────────────────────────────
  function selectSlashCommand(cmd: ChatCommand) {
    setText(`/${cmd.name} `);
    setShowSlashMenu(false);
    textareaRef.current?.focus();
  }

  // ── Select mention ─────────────────────────────────────────────
  function selectMention(option: MentionOption) {
    // Replace @fragment with @Name
    const before = text.slice(0, mentionStartPos);
    const afterCursor = text.slice(mentionStartPos + 1 + mentionFilter.length);
    setText(`${before}@${option.name} ${afterCursor}`);
    setShowMentionMenu(false);
    textareaRef.current?.focus();
  }

  // ── Keyboard navigation ─────────────────────────────────────────
  function handleKeyDown(e: KeyboardEvent) {
    // Slash menu navigation
    if (showSlashMenu && filteredSlash.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % filteredSlash.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + filteredSlash.length) % filteredSlash.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const cmd = filteredSlash[slashIndex];
        const parsed = parseCommand(text.trim());
        if (parsed && parsed.command === cmd && parsed.args === '' && cmd.type !== 'runtime') {
          handleSend();
          return;
        }
        if (cmd) selectSlashCommand(cmd);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const cmd = filteredSlash[slashIndex];
        if (cmd) selectSlashCommand(cmd);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
    }

    // Mention menu navigation
    if (showMentionMenu && filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % filteredMentions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + filteredMentions.length) % filteredMentions.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const opt = filteredMentions[mentionIndex];
        if (opt) selectMention(opt);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const opt = filteredMentions[mentionIndex];
        if (opt) selectMention(opt);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowMentionMenu(false);
        return;
      }
    }

    // Normal send: Enter without shift
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const canSend = !!text.trim() && !disabled;
  const chatInputTargetRef = useTourTarget('office:chat-input');

  return (
    <div ref={chatInputTargetRef} className="relative border-t border-border-default px-3 py-2">
      {/* Slash command menu */}
      {showSlashMenu && filteredSlash.length > 0 && (
        <div
          ref={menuRef}
          className="absolute bottom-full left-3 right-3 z-50 mb-1 overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-modal"
        >
          <div className="max-h-[240px] overflow-y-auto py-1">
            {filteredSlash.map((cmd, i) => (
              <button
                key={cmd.name}
                type="button"
                className={`flex h-8 w-full items-center gap-2.5 px-3 text-left transition-colors ${
                  i === slashIndex
                    ? 'bg-accent-muted text-accent-text'
                    : 'text-text-secondary hover:bg-surface-hover'
                }`}
                onMouseEnter={() => setSlashIndex(i)}
                onClick={() => selectSlashCommand(cmd)}
              >
                <span className="shrink-0 font-mono text-xs text-accent">/{cmd.name}</span>
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${COMMAND_CATEGORIES[cmd.category]?.badgeClass ?? 'bg-surface-muted text-text-muted'}`}
                >
                  {cmd.category}
                </span>
                <span className="truncate text-xs text-text-secondary">{cmd.description}</span>
                {cmd.argumentHint && (
                  <span className="ml-auto shrink-0 truncate text-[10px] text-text-muted">
                    {cmd.argumentHint}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mention menu */}
      {showMentionMenu && filteredMentions.length > 0 && (
        <div
          ref={menuRef}
          className="absolute bottom-full left-3 right-3 z-50 mb-1 overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-modal"
        >
          <div className="max-h-[240px] overflow-y-auto py-1">
            {filteredMentions.map((opt, i) => (
              <button
                key={opt.id}
                type="button"
                className={`flex h-8 w-full items-center gap-2.5 px-3 text-left transition-colors ${
                  i === mentionIndex
                    ? 'bg-accent-muted text-accent-text'
                    : 'text-text-secondary hover:bg-surface-hover'
                }`}
                onMouseEnter={() => setMentionIndex(i)}
                onClick={() => selectMention(opt)}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-text-inverse ${roleColor(opt.role)}`}
                >
                  {opt.name[0]}
                </span>
                <span className="text-xs font-medium">{opt.name}</span>
                <span className="truncate text-xs text-text-muted">{opt.role}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          maxLength={8000}
          className="min-h-[32px] max-h-[72px] flex-1 resize-none rounded-lg border border-border-default bg-surface px-3 py-1.5 text-sm leading-snug text-text-primary transition-colors placeholder:text-text-muted focus:border-border-focus focus:outline-none disabled:bg-surface-muted disabled:text-text-muted"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-text-inverse transition-all hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent`}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Hint line */}
      <div className="mt-1 flex items-center gap-3 px-1">
        {disabled && disabledReason ? (
          <span className="text-[10px] text-warning">{disabledReason}</span>
        ) : (
          <>
            <span className="text-[10px] text-text-muted">
              <kbd className="text-text-muted">/</kbd> commands
            </span>
            <span className="text-[10px] text-text-muted">
              <kbd className="text-text-muted">@</kbd> mention
            </span>
          </>
        )}
      </div>
    </div>
  );
}
