import type { EventBus } from '@offisim/core/browser';
import type { ParsedAttachment, StagedAttachment } from '@offisim/shared-types';
import { Button, Input, Textarea, cn } from '@offisim/ui-core';
import { ArrowUp, Paperclip } from 'lucide-react';
import {
  type KeyboardEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { AttachmentStore } from '../../lib/attachment-store.js';
import {
  COMMAND_CATEGORIES,
  type ChatCommand,
  filterCommands,
  parseCommand,
} from '../../lib/chat-commands.js';
import { isTauri } from '../../lib/env.js';
import type { AgentState } from '../../runtime/use-agent-states';
import { useTourTarget } from '../onboarding/tour-context.js';
import { AttachmentDropOverlay } from './AttachmentDropOverlay.js';
import { StagedAttachmentChip } from './StagedAttachmentChip.js';
import { mergeClipboardTextIntoComposer } from './clipboard-text.js';
import { readTauriDroppedFiles } from './tauri-dropped-files.js';
import { useChatAttachmentStaging } from './useChatAttachmentStaging.js';

type TauriDropPosition = { x: number; y: number };

export interface ChatInputAttachmentPayload {
  staged: StagedAttachment[];
  cachedParsed: Map<string, ParsedAttachment>;
}

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
    options?: {
      entryMode?: 'boss_chat' | 'direct_chat' | 'meeting';
      attachments?: ChatInputAttachmentPayload;
    },
  ) => void;
  onCommand: (command: ChatCommand, args: string) => void;
  disabled?: boolean;
  placeholder?: string;
  agents?: Map<string, AgentState>;
  disabledReason?: string;
  modeChip?: ReactNode;
  companyId: string;
  threadId: string;
  attachmentStore: AttachmentStore | null;
  eventBus: EventBus | null;
}

export function ChatInput({
  onSend,
  onCommand,
  disabled,
  placeholder = 'Message your team...',
  agents,
  disabledReason,
  modeChip,
  companyId,
  threadId,
  attachmentStore,
  eventBus,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const chatInputElementRef = useRef<HTMLDivElement | null>(null);
  const lastHtmlDropAtRef = useRef(0);
  const lastNativeDropAtRef = useRef(0);
  const staging = useChatAttachmentStaging({
    companyId,
    threadId,
    attachmentStore,
    eventBus,
  });

  // ── Menu state ──────────────────────────────────────────────────
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);

  const [showMentionMenu, setShowMentionMenu] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(-1);

  const menuRef = useRef<HTMLDivElement>(null);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mentionItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

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

  // ── Scroll active row into view (kbd nav) ──────────────────────
  useEffect(() => {
    if (!showSlashMenu) return;
    slashItemRefs.current[slashIndex]?.scrollIntoView({ block: 'nearest' });
  }, [slashIndex, showSlashMenu]);

  useEffect(() => {
    if (!showMentionMenu) return;
    mentionItemRefs.current[mentionIndex]?.scrollIntoView({ block: 'nearest' });
  }, [mentionIndex, showMentionMenu]);

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
    staging.clear();
  }

  function handleSend() {
    const trimmed = text.trim();
    const hasAttachments = staging.staged.length > 0;
    if ((!trimmed && !hasAttachments) || disabled) return;

    if (trimmed) {
      const parsed = parseCommand(trimmed);
      if (parsed) {
        onCommand(parsed.command, parsed.args);
        clearComposer();
        return;
      }
    }

    const attachmentPayload: ChatInputAttachmentPayload | undefined = hasAttachments
      ? {
          staged: staging.staged,
          cachedParsed: new Map(
            staging.staged
              .map((s) => [s.attachmentId, staging.getCachedParsed(s.attachmentId)] as const)
              .filter((pair): pair is [string, ParsedAttachment] => pair[1] !== undefined),
          ),
        }
      : undefined;
    // Attachment-only sends ship empty content + non-empty refs; do NOT inject
    // placeholder text per the chat-attachments-end-to-end spec.
    onSend(trimmed, attachmentPayload ? { attachments: attachmentPayload } : undefined);
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

  const focusComposerAfterAttach = useCallback(() => {
    requestAnimationFrame(() => {
      chatInputElementRef.current?.scrollIntoView({ block: 'nearest' });
      textareaRef.current?.focus();
    });
  }, []);

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

  const canSend = (!!text.trim() || staging.staged.length > 0) && !disabled;
  const registerChatInputTarget = useTourTarget('office:chat-input');
  const setChatInputTargetRef = useCallback(
    (el: HTMLDivElement | null) => {
      chatInputElementRef.current = el;
      registerChatInputTarget(el);
    },
    [registerChatInputTarget],
  );

  const isNativeDropInsideComposer = useCallback((position: TauriDropPosition): boolean => {
    const element = chatInputElementRef.current;
    if (!element || typeof window === 'undefined') return false;
    const scale = window.devicePixelRatio || 1;
    const dropTarget = element.closest('[data-chat-panel-root]');
    const rect =
      dropTarget instanceof HTMLElement
        ? dropTarget.getBoundingClientRect()
        : element.getBoundingClientRect();
    const candidates = [
      { x: position.x, y: position.y },
      ...(scale !== 1 ? [{ x: position.x / scale, y: position.y / scale }] : []),
    ];
    return candidates.some(
      ({ x, y }) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
    );
  }, []);

  useEffect(() => {
    if (!isTauri()) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void (async () => {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        unlisten = await getCurrentWebviewWindow().onDragDropEvent((event) => {
          if (cancelled) return;
          const payload = event.payload;
          if (payload.type === 'leave') {
            dragDepthRef.current = 0;
            setDragActive(false);
            return;
          }
          if (payload.type === 'enter') {
            const inside = payload.paths.length > 0 && isNativeDropInsideComposer(payload.position);
            dragDepthRef.current = inside ? 1 : 0;
            setDragActive(inside);
            return;
          }
          if (payload.type === 'over') {
            setDragActive(isNativeDropInsideComposer(payload.position));
            return;
          }
          if (payload.type !== 'drop') return;

          dragDepthRef.current = 0;
          setDragActive(false);
          if (!isNativeDropInsideComposer(payload.position) || payload.paths.length === 0) return;
          if (Date.now() - lastHtmlDropAtRef.current < 1000) return;
          lastNativeDropAtRef.current = Date.now();

          void (async () => {
            const result = await readTauriDroppedFiles(payload.paths);
            for (const error of result.errors) {
              staging.reportExternalError(error.filename, error.message);
            }
            if (result.files.length > 0) {
              await staging.handleStaging(result.files);
              focusComposerAfterAttach();
            }
          })();
        });
      } catch (err) {
        if (!cancelled) {
          console.warn('[chat-attachments] Tauri file-drop listener unavailable', err);
        }
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [
    focusComposerAfterAttach,
    isNativeDropInsideComposer,
    staging.handleStaging,
    staging.reportExternalError,
  ]);

  const onPickerChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) {
        void staging.handleStaging(files).then(focusComposerAfterAttach);
      }
      // reset so re-picking the same file fires onChange again
      e.target.value = '';
    },
    [focusComposerAfterAttach, staging.handleStaging],
  );

  const onPaste = useCallback(
    (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length > 0) {
        e.preventDefault();
        const pastedText = e.clipboardData?.getData('text/plain') ?? '';
        const merged = mergeClipboardTextIntoComposer({
          currentText: text,
          selectionStart: e.currentTarget.selectionStart ?? text.length,
          selectionEnd: e.currentTarget.selectionEnd ?? text.length,
          pastedText,
        });
        if (merged.text !== text) {
          setText(merged.text);
          resizeTextarea(e.currentTarget, merged.text);
          requestAnimationFrame(() => {
            textareaRef.current?.setSelectionRange(merged.selectionStart, merged.selectionEnd);
          });
        }
        void staging.handleStaging(files).then(focusComposerAfterAttach);
      }
    },
    [focusComposerAfterAttach, staging.handleStaging, text],
  );

  const onDragEnter = useCallback((e: ReactDragEvent) => {
    e.preventDefault();
    if (e.dataTransfer?.types.includes('Files')) {
      dragDepthRef.current += 1;
      setDragActive(true);
    }
  }, []);
  const onDragOver = useCallback((e: ReactDragEvent) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);
  const onDragLeave = useCallback((e: ReactDragEvent) => {
    if (e.dataTransfer?.types.includes('Files')) {
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragActive(false);
    }
  }, []);
  const onDrop = useCallback(
    (e: ReactDragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      if (Date.now() - lastNativeDropAtRef.current < 1000) return;
      lastHtmlDropAtRef.current = Date.now();
      dragDepthRef.current = 0;
      setDragActive(false);
      void staging.handleStaging(files).then(focusComposerAfterAttach);
    },
    [focusComposerAfterAttach, staging.handleStaging],
  );

  const dropMessage = staging.storageAvailable ? 'Drop to attach' : 'Storage unavailable';

  return (
    <div
      ref={setChatInputTargetRef}
      className="relative box-border w-full min-w-0 max-w-full overflow-hidden border-t border-border-default px-3 py-2"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <AttachmentDropOverlay visible={dragActive} message={dropMessage} />
      <Input ref={fileInputRef} type="file" multiple hidden onChange={onPickerChange} />
      {/* Slash command menu */}
      {showSlashMenu && filteredSlash.length > 0 && (
        <div
          ref={menuRef}
          className="absolute bottom-full left-3 right-3 z-50 mb-1 overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-modal"
        >
          <div className="max-h-60 overflow-y-auto py-1">
            {filteredSlash.map((cmd, i) => (
              <Button
                key={cmd.name}
                ref={(el) => {
                  slashItemRefs.current[i] = el;
                }}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-8 w-full justify-start gap-2.5 rounded-none px-3 text-left',
                  i === slashIndex
                    ? 'bg-accent-muted text-accent-text'
                    : 'text-text-secondary hover:bg-surface-hover',
                )}
                onMouseEnter={() => setSlashIndex(i)}
                onClick={() => selectSlashCommand(cmd)}
              >
                <span className="shrink-0 font-mono text-xs text-accent">/{cmd.name}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-caption font-semibold uppercase tracking-wider ${COMMAND_CATEGORIES[cmd.category]?.badgeClass ?? 'bg-surface-muted text-text-muted'}`}
                >
                  {cmd.category}
                </span>
                <span className="truncate text-xs text-text-secondary">{cmd.description}</span>
                {cmd.argumentHint && (
                  <span className="ml-auto shrink-0 truncate text-caption text-text-muted">
                    {cmd.argumentHint}
                  </span>
                )}
              </Button>
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
          <div className="max-h-60 overflow-y-auto py-1">
            {filteredMentions.map((opt, i) => (
              <Button
                key={opt.id}
                ref={(el) => {
                  mentionItemRefs.current[i] = el;
                }}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-8 w-full justify-start gap-2.5 rounded-none px-3 text-left',
                  i === mentionIndex
                    ? 'bg-accent-muted text-accent-text'
                    : 'text-text-secondary hover:bg-surface-hover',
                )}
                onMouseEnter={() => setMentionIndex(i)}
                onClick={() => selectMention(opt)}
              >
                <span
                  className={`flex size-4 shrink-0 items-center justify-center rounded-full text-caption font-bold text-text-inverse ${roleColor(opt.role)}`}
                >
                  {opt.name[0]}
                </span>
                <span className="text-xs font-medium">{opt.name}</span>
                <span className="truncate text-xs text-text-muted">{opt.role}</span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Staged attachment chips */}
      {staging.errors.length > 0 && (
        <output
          className="mb-1 flex min-w-0 max-w-full flex-col gap-1 overflow-hidden"
          aria-live="polite"
        >
          {staging.errors.map((error) => (
            <div
              key={error.id}
              className="min-w-0 max-w-full truncate rounded border border-warning/40 bg-warning-muted px-2 py-1 text-caption text-warning"
            >
              {error.message}
            </div>
          ))}
        </output>
      )}
      {staging.staged.length > 0 && (
        <div className="mb-1 grid min-w-0 max-w-full grid-cols-1 gap-1 overflow-hidden sm:grid-cols-2">
          {staging.staged.map((s) => (
            <StagedAttachmentChip
              key={s.attachmentId}
              attachment={s}
              onRemove={staging.removeStaged}
            />
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex w-full min-w-0 max-w-full items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          maxLength={8000}
          className="max-h-20 min-h-8 min-w-0 flex-1 resize-none py-1.5 text-sm leading-snug"
        />
        <Button
          type="button"
          size="icon"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
          className="size-7 shrink-0 rounded-lg bg-accent text-text-inverse transition-all hover:bg-accent-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-accent"
        >
          <ArrowUp className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      {/* Hint line */}
      <div className="mt-1 flex w-full min-w-0 max-w-full flex-wrap items-center gap-3 overflow-hidden px-1">
        {disabled && disabledReason ? (
          <span className="text-caption text-warning">{disabledReason}</span>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || !staging.storageAvailable}
              aria-label="Attach file"
              title={
                staging.storageAvailable
                  ? 'Attach file'
                  : 'Storage unavailable — try a non-private window'
              }
              className="size-6 rounded p-0.5 text-text-muted hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Paperclip className="size-3" aria-hidden="true" />
            </Button>
            <span className="text-caption text-text-muted">
              <kbd className="text-text-muted">/</kbd> commands
            </span>
            <span className="text-caption text-text-muted">
              <kbd className="text-text-muted">@</kbd> mention
            </span>
          </>
        )}
        {modeChip ? <span className="ml-auto">{modeChip}</span> : null}
      </div>
    </div>
  );
}
