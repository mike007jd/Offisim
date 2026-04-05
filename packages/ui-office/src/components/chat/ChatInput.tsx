import { ArrowUp } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  COMMAND_CATEGORIES,
  type ChatCommand,
  filterCommands,
  parseCommand,
} from '../../lib/chat-commands.js';
import type { AgentState } from '../../runtime/use-agent-states';

// ── Mention option ──────────────────────────────────────────────────

interface MentionOption {
  id: string;
  name: string;
  role: string;
}

// ── Role color mapping ─────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  developer: 'bg-blue-500',
  engineer: 'bg-blue-500',
  backend: 'bg-blue-400',
  frontend: 'bg-cyan-500',
  fullstack: 'bg-blue-600',
  pm: 'bg-purple-500',
  product_manager: 'bg-purple-500',
  researcher: 'bg-violet-500',
  analyst: 'bg-purple-400',
  designer: 'bg-orange-500',
  artist: 'bg-orange-400',
  ui_designer: 'bg-amber-500',
  ux_designer: 'bg-orange-600',
};

function roleColor(role: string): string {
  return ROLE_COLORS[role] ?? 'bg-slate-500';
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
  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;

    const parsed = parseCommand(trimmed);
    if (parsed) {
      onCommand(parsed.command, parsed.args);
      setText('');
      return;
    }

    // Not a command (or unrecognized /something) — send as regular message
    onSend(trimmed);
    setText('');
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

  return (
    <div className="relative px-3 py-2 border-t border-white/8" data-onboarding-target="chat-input">
      {/* Slash command menu */}
      {showSlashMenu && filteredSlash.length > 0 && (
        <div
          ref={menuRef}
          className="absolute bottom-full left-3 right-3 mb-1 bg-slate-900 border border-white/10 rounded-lg shadow-xl overflow-hidden z-50"
        >
          <div className="max-h-[240px] overflow-y-auto py-1">
            {filteredSlash.map((cmd, i) => (
              <button
                key={cmd.name}
                type="button"
                className={`w-full flex items-center gap-2.5 px-3 h-8 text-left transition-colors ${
                  i === slashIndex ? 'bg-blue-500/20 text-white' : 'text-slate-300 hover:bg-white/5'
                }`}
                onMouseEnter={() => setSlashIndex(i)}
                onClick={() => selectSlashCommand(cmd)}
              >
                <span className="text-xs font-mono text-blue-400 shrink-0">/{cmd.name}</span>
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${COMMAND_CATEGORIES[cmd.category]?.badgeClass ?? 'bg-slate-500/20 text-slate-400'}`}
                >
                  {cmd.category}
                </span>
                <span className="text-xs text-slate-400 truncate">{cmd.description}</span>
                {cmd.argumentHint && (
                  <span className="text-[10px] text-slate-500 truncate ml-auto shrink-0">
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
          className="absolute bottom-full left-3 right-3 mb-1 bg-slate-900 border border-white/10 rounded-lg shadow-xl overflow-hidden z-50"
        >
          <div className="max-h-[240px] overflow-y-auto py-1">
            {filteredMentions.map((opt, i) => (
              <button
                key={opt.id}
                type="button"
                className={`w-full flex items-center gap-2.5 px-3 h-8 text-left transition-colors ${
                  i === mentionIndex
                    ? 'bg-blue-500/20 text-white'
                    : 'text-slate-300 hover:bg-white/5'
                }`}
                onMouseEnter={() => setMentionIndex(i)}
                onClick={() => selectMention(opt)}
              >
                <span
                  className={`w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-white ${roleColor(opt.role)}`}
                >
                  {opt.name[0]}
                </span>
                <span className="text-xs font-medium">{opt.name}</span>
                <span className="text-xs text-slate-500 truncate">{opt.role}</span>
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
          className="flex-1 min-h-[32px] max-h-[72px] bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white leading-snug resize-none focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-slate-600 disabled:opacity-40"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
          className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-all active:scale-95 ${
            canSend
              ? 'bg-blue-600 hover:bg-blue-500 text-white'
              : 'bg-transparent text-transparent pointer-events-none'
          }`}
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Hint line */}
      <div className="flex items-center gap-3 mt-1 px-1">
        {disabled && disabledReason ? (
          <span className="text-[10px] text-amber-300/80">{disabledReason}</span>
        ) : (
          <>
            <span className="text-[10px] text-slate-500">
              <kbd className="text-slate-500">/</kbd> commands
            </span>
            <span className="text-[10px] text-slate-500">
              <kbd className="text-slate-500">@</kbd> mention
            </span>
          </>
        )}
      </div>
    </div>
  );
}
