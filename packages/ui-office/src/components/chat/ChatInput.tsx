import {
  ComposerPrimitive,
  type Unstable_DirectiveFormatter,
  type Unstable_TriggerItem,
  unstable_useMentionAdapter,
  unstable_useSlashCommandAdapter,
  useAui,
  useAuiState,
} from '@assistant-ui/react';
import type { EventBus } from '@offisim/core/browser';
import type { ParsedAttachment, StagedAttachment } from '@offisim/shared-types';
import { Button, Input, Textarea, TriggerListboxSurface, cn } from '@offisim/ui-core';
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
  getVisibleCommands,
  parseCommand,
} from '../../lib/chat-commands.js';
import { isTauri } from '../../lib/env.js';
import type { AgentState } from '../../runtime/use-agent-states';
import { useTourTarget } from '../onboarding/tour-context.js';
import { AgentAvatar } from './AgentAvatar.js';
import { AttachmentDropOverlay } from './AttachmentDropOverlay.js';
import { StagedAttachmentChip } from './StagedAttachmentChip.js';
import { mergeClipboardTextIntoComposer } from './clipboard-text.js';
import { readTauriDroppedFiles } from './tauri-dropped-files.js';
import { useChatAttachmentStaging } from './useChatAttachmentStaging.js';

type TauriDropPosition = { x: number; y: number };
type ComposerTriggerMatch = { query: string; offset: number };

export interface ChatInputAttachmentPayload {
  staged: StagedAttachment[];
  cachedParsed: Map<string, ParsedAttachment>;
}

export interface OffisimComposerRunConfig {
  custom?: {
    offisim?: {
      attachments?: ChatInputAttachmentPayload;
    };
  };
}

// ── Mention option ──────────────────────────────────────────────────

interface MentionOption {
  id: string;
  name: string;
  role: string;
}

const mentionFormatter: Unstable_DirectiveFormatter = {
  serialize(item) {
    return `@${item.label}`;
  },
  parse(text) {
    return text ? [{ kind: 'text', text }] : [];
  },
};

function detectComposerTrigger(
  text: string,
  triggerChar: string,
  cursorPosition: number,
): ComposerTriggerMatch | null {
  const textUpToCursor = text.slice(0, Math.min(cursorPosition, text.length));
  for (let i = textUpToCursor.length - 1; i >= 0; i -= 1) {
    const char = textUpToCursor[i] ?? '';
    if (/\s/u.test(char)) return null;
    if (!textUpToCursor.startsWith(triggerChar, i)) continue;
    if (i > 0 && !/\s/u.test(textUpToCursor[i - 1] ?? '')) continue;
    return { query: textUpToCursor.slice(i + triggerChar.length), offset: i };
  }
  return null;
}

function resizeTextarea(element: HTMLTextAreaElement | null, currentText: string) {
  if (!element) return;
  element.style.height = 'auto';
  const maxHeight = Number.parseFloat(getComputedStyle(element).maxHeight);
  const nextHeight = Number.isFinite(maxHeight)
    ? Math.min(element.scrollHeight, maxHeight)
    : element.scrollHeight;
  element.style.height = `${nextHeight}px`;
  void currentText;
}

// ── ChatInput props ─────────────────────────────────────────────────

export interface ChatInputProps {
  onCommand: (command: ChatCommand, args: string) => void;
  onSendMessage: (text: string, attachments?: ChatInputAttachmentPayload) => void | Promise<void>;
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
  onCommand,
  onSendMessage,
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
  const aui = useAui();
  const text = useAuiState((state) => state.composer.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const chatInputElementRef = useRef<HTMLElement | null>(null);
  const lastHtmlDropAtRef = useRef(0);
  const lastNativeDropAtRef = useRef(0);
  const staging = useChatAttachmentStaging({
    companyId,
    threadId,
    attachmentStore,
    eventBus,
  });

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

  const visibleCommands = useMemo(() => getVisibleCommands(), []);
  const commandById = useMemo(() => {
    return new Map(visibleCommands.map((command) => [command.name, command]));
  }, [visibleCommands]);

  // ── Input change handler ────────────────────────────────────────
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    resizeTextarea(e.currentTarget, val);
  }, []);

  useEffect(() => {
    resizeTextarea(textareaRef.current, text);
  }, [text]);

  // ── Send logic ──────────────────────────────────────────────────
  const setComposerText = useCallback(
    (nextText: string) => {
      aui.composer().setText(nextText);
    },
    [aui],
  );

  const clearComposer = useCallback(() => {
    setComposerText('');
    staging.clear();
  }, [setComposerText, staging.clear]);

  const buildAttachmentPayload = useCallback((): ChatInputAttachmentPayload => {
    return {
      staged: staging.staged,
      cachedParsed: new Map(
        staging.staged
          .map((s) => [s.attachmentId, staging.getCachedParsed(s.attachmentId)] as const)
          .filter((pair): pair is [string, ParsedAttachment] => pair[1] !== undefined),
      ),
    };
  }, [staging.getCachedParsed, staging.staged]);

  const submitAttachmentOnly = useCallback(async () => {
    if (disabled || staging.staged.length === 0) return;
    const attachmentPayload = buildAttachmentPayload();
    await onSendMessage('', attachmentPayload);
    aui.composer().setText('');
    aui.composer().setRunConfig({});
    staging.clear();
  }, [aui, buildAttachmentPayload, disabled, onSendMessage, staging.clear, staging.staged.length]);

  const submitComposerForm = useCallback(() => {
    const form =
      chatInputElementRef.current instanceof HTMLFormElement
        ? chatInputElementRef.current
        : textareaRef.current?.form;
    form?.requestSubmit();
  }, []);

  const prepareComposerSubmit = useCallback((): boolean => {
    const composer = aui.composer();
    const messageText = composer.getState().text;
    const trimmed = messageText.trim();
    const hasAttachments = staging.staged.length > 0;
    if ((!trimmed && !hasAttachments) || disabled) return true;

    if (trimmed) {
      const parsed = parseCommand(trimmed);
      if (parsed) {
        onCommand(parsed.command, parsed.args);
        clearComposer();
        composer.setRunConfig({});
        return true;
      }
    }

    if (!hasAttachments) {
      composer.setRunConfig({});
      return false;
    }

    const attachmentPayload = buildAttachmentPayload();
    if (!trimmed) {
      void submitAttachmentOnly();
      return true;
    }

    composer.setRunConfig({ custom: { offisim: { attachments: attachmentPayload } } });
    staging.clear();
    return false;
  }, [
    aui,
    buildAttachmentPayload,
    clearComposer,
    disabled,
    onCommand,
    staging.clear,
    staging.staged.length,
    submitAttachmentOnly,
  ]);

  // ── Select slash command ────────────────────────────────────────
  const selectSlashCommand = useCallback(
    (cmd: ChatCommand) => {
      const currentText = aui.composer().getState().text;
      const slashTrigger = detectComposerTrigger(
        currentText,
        '/',
        textareaRef.current?.selectionStart ?? currentText.length,
      );
      if (slashTrigger && slashTrigger.offset !== 0) {
        setComposerText(currentText);
        requestAnimationFrame(submitComposerForm);
        return;
      }
      setComposerText(`/${cmd.name} `);
      textareaRef.current?.focus();
    },
    [aui, setComposerText, submitComposerForm],
  );

  const slashCommands = useMemo(
    () =>
      visibleCommands.map((command) => ({
        id: command.name,
        label: `/${command.name}`,
        description: command.description,
        execute: () => selectSlashCommand(command),
      })),
    [selectSlashCommand, visibleCommands],
  );

  const mentionItems = useMemo(
    () =>
      mentionOptions.map((option) => ({
        id: option.id,
        type: 'mention' as const,
        label: option.name,
        description: option.role,
        metadata: {
          initial: option.name[0] ?? '',
          role: option.role,
        },
      })),
    [mentionOptions],
  );

  const handleMentionInserted = useCallback(() => {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const slashCommand = unstable_useSlashCommandAdapter({
    commands: slashCommands,
    removeOnExecute: true,
  });

  const mention = unstable_useMentionAdapter({
    includeModelContextTools: false,
    formatter: mentionFormatter,
    items: mentionItems,
    onInserted: handleMentionInserted,
  });

  function slashQueryHasNoResults(value: string, cursorPosition: number): boolean {
    const slashTrigger = detectComposerTrigger(value, '/', cursorPosition);
    if (!slashTrigger?.query) return false;
    const lowerQuery = slashTrigger.query.toLowerCase();
    return !visibleCommands.some(
      (command) =>
        command.name.includes(lowerQuery) ||
        command.aliases?.some((alias) => alias.includes(lowerQuery)) ||
        command.description.toLowerCase().includes(lowerQuery),
    );
  }

  function mentionQueryHasNoResults(value: string, cursorPosition: number): boolean {
    const beforeCursor = value.slice(0, cursorPosition);
    const lastAt = beforeCursor.lastIndexOf('@');
    if (lastAt < 0) return false;
    const charBefore = lastAt > 0 ? beforeCursor[lastAt - 1] : ' ';
    if (lastAt !== 0 && charBefore !== ' ' && charBefore !== '\n') return false;
    const query = beforeCursor.slice(lastAt + 1);
    if (!query || query.includes(' ')) return false;
    const lowerQuery = query.toLowerCase();
    return !mentionOptions.some(
      (option) =>
        option.name.toLowerCase().includes(lowerQuery) ||
        option.role.toLowerCase().includes(lowerQuery),
    );
  }

  function handleComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    const value = e.currentTarget.value;
    const parsed = parseCommand(value.trim());
    const shouldRunNoArgCommand = parsed && parsed.args === '' && parsed.command.type !== 'runtime';
    const shouldSendAttachmentOnly = staging.staged.length > 0 && !value.trim();
    const cursorPosition = e.currentTarget.selectionStart ?? value.length;
    const shouldSendNoResultTrigger =
      slashQueryHasNoResults(value, cursorPosition) ||
      mentionQueryHasNoResults(value, cursorPosition);

    if (shouldRunNoArgCommand || shouldSendAttachmentOnly || shouldSendNoResultTrigger) {
      e.preventDefault();
      submitComposerForm();
    }
  }

  const focusComposerAfterAttach = useCallback(() => {
    requestAnimationFrame(() => {
      chatInputElementRef.current?.scrollIntoView({ block: 'nearest' });
      textareaRef.current?.focus();
    });
  }, []);

  const canSend = (!!text.trim() || staging.staged.length > 0) && !disabled;
  const registerChatInputTarget = useTourTarget('office:chat-input');
  const setChatInputTargetRef = useCallback(
    (el: HTMLFormElement | null) => {
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
          setComposerText(merged.text);
          resizeTextarea(e.currentTarget, merged.text);
          requestAnimationFrame(() => {
            textareaRef.current?.setSelectionRange(merged.selectionStart, merged.selectionEnd);
          });
        }
        void staging.handleStaging(files).then(focusComposerAfterAttach);
      }
    },
    [focusComposerAfterAttach, setComposerText, staging.handleStaging, text],
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
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root
        ref={setChatInputTargetRef}
        className="chat-composer-root"
        onSubmit={(event) => {
          if (prepareComposerSubmit()) {
            event.preventDefault();
          }
        }}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <AttachmentDropOverlay visible={dragActive} message={dropMessage} />
        <Input ref={fileInputRef} type="file" multiple hidden onChange={onPickerChange} />

        {/* Staged attachment chips */}
        {staging.errors.length > 0 && (
          <output className="chat-composer-stack" aria-live="polite">
            {staging.errors.map((error) => (
              <div key={error.id} className="chat-composer-error">
                {error.message}
              </div>
            ))}
          </output>
        )}
        {staging.staged.length > 0 && (
          <div className="chat-composer-attachments">
            {staging.staged.map((attachment) => (
              <StagedAttachmentChip
                key={attachment.attachmentId}
                attachment={attachment}
                onRemove={staging.removeStaged}
              />
            ))}
          </div>
        )}

        <div className="chat-composer-input-shell">
          <div className="chat-composer-input-row">
            <ComposerPrimitive.Input
              render={<Textarea />}
              ref={textareaRef}
              onChange={handleChange}
              onKeyDown={handleComposerKeyDown}
              onPaste={onPaste}
              placeholder={placeholder}
              disabled={disabled}
              cancelOnEscape={false}
              submitMode="enter"
              rows={1}
              maxLength={8000}
              className="chat-composer-textarea"
            />
            <Button
              type="submit"
              variant="accent"
              size="iconSm"
              disabled={!canSend}
              aria-label="Send message"
              className="chat-composer-submit"
            >
              <ArrowUp className="chat-composer-send-icon" aria-hidden="true" />
            </Button>
          </div>

          <ComposerPrimitive.Unstable_TriggerPopover
            char="/"
            adapter={slashCommand.adapter}
            aria-label="Command suggestions"
            render={<TriggerListboxSurface />}
          >
            <ComposerPrimitive.Unstable_TriggerPopover.Action {...slashCommand.action} />
            <ComposerTriggerMenuItems
              renderItem={(item, index) => {
                const command = commandById.get(item.id);
                if (!command) return null;
                return (
                  <ComposerPrimitive.Unstable_TriggerPopoverItem
                    key={item.id}
                    item={item}
                    index={index}
                    render={<Button variant="ghost" size="sm" />}
                    className="chat-composer-menu-item"
                  >
                    <span className="chat-composer-command-name">/{command.name}</span>
                    <span
                      className={cn(
                        'chat-composer-command-badge',
                        COMMAND_CATEGORIES[command.category]?.badgeClass ??
                          'bg-surface-muted text-text-muted',
                      )}
                    >
                      {command.category}
                    </span>
                    <span className="chat-composer-command-description">{command.description}</span>
                    {command.argumentHint && (
                      <span className="chat-composer-command-argument">{command.argumentHint}</span>
                    )}
                  </ComposerPrimitive.Unstable_TriggerPopoverItem>
                );
              }}
            />
          </ComposerPrimitive.Unstable_TriggerPopover>

          <ComposerPrimitive.Unstable_TriggerPopover
            char="@"
            adapter={mention.adapter}
            aria-label="Mention suggestions"
            render={<TriggerListboxSurface />}
          >
            <ComposerPrimitive.Unstable_TriggerPopover.Directive {...mention.directive} />
            <ComposerTriggerMenuItems
              renderItem={(item, index) => (
                <ComposerPrimitive.Unstable_TriggerPopoverItem
                  key={item.id}
                  item={item}
                  index={index}
                  render={<Button variant="ghost" size="sm" />}
                  className="chat-composer-menu-item"
                >
                  <AgentAvatar name={item.label} role={String(item.description ?? '')} />
                  <span className="chat-composer-mention-name">{item.label}</span>
                  <span className="chat-composer-mention-role">{item.description}</span>
                </ComposerPrimitive.Unstable_TriggerPopoverItem>
              )}
            />
          </ComposerPrimitive.Unstable_TriggerPopover>
        </div>

        {/* Hint line */}
        <div className="chat-composer-meta-row">
          {disabled && disabledReason ? (
            <span className="text-caption text-warning">{disabledReason}</span>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="iconSm"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || !staging.storageAvailable}
                aria-label="Attach file"
                title={
                  staging.storageAvailable
                    ? 'Attach file'
                    : 'Storage unavailable — try a non-private window'
                }
                className="chat-composer-attach-button"
              >
                <Paperclip className="chat-composer-attach-icon" aria-hidden="true" />
              </Button>
              <span className="text-caption text-text-muted">
                <kbd className="text-text-muted">/</kbd> commands
              </span>
              <span className="text-caption text-text-muted">
                <kbd className="text-text-muted">@</kbd> mention
              </span>
            </>
          )}
          {modeChip ? <span className="ml-auto min-w-0 shrink">{modeChip}</span> : null}
        </div>
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
}

function ComposerTriggerMenuItems({
  renderItem,
}: {
  renderItem: (item: Unstable_TriggerItem, index: number) => ReactNode;
}) {
  return (
    <ComposerPrimitive.Unstable_TriggerPopoverItems className="chat-composer-menu-list">
      {(items) => items.map(renderItem)}
    </ComposerPrimitive.Unstable_TriggerPopoverItems>
  );
}
