import type { LlmGateway, LlmMessage } from '@offisim/core/browser';
import { Button, ScrollArea, Textarea, cn } from '@offisim/ui-core';
import { MessageSquare, Send, Trash2 } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { EmployeeFormData } from '../../hooks/useEmployeeEditor';
import { buildSystemPrompt } from '../../lib/build-system-prompt';
import { createDesktopProviderGateway } from '../../lib/desktop-provider-secrets';
import { isTauri } from '../../lib/env';
import { loadProviderConfig } from '../../lib/provider-config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface TestChatTabProps {
  formData: EmployeeFormData;
  employeeName: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _nextId = 0;
function genId(): string {
  return `test-msg-${_nextId++}`;
}

/**
 * Lazily create an LlmGateway from the user's saved provider config.
 * Returns null if no provider is configured.
 */
async function createTestGateway(): Promise<LlmGateway | null> {
  const config = loadProviderConfig();
  if (!config) return null;

  const isDev = typeof window !== 'undefined' && '__VITE_DEV_SERVER_URL' in window;
  const proxyBaseURL =
    isDev && config.baseURL ? `${window.location.origin}/api/llm-proxy` : undefined;
  const proxyHeaders =
    isDev && config.baseURL
      ? { ...config.defaultHeaders, 'X-LLM-Base-URL': config.baseURL }
      : config.defaultHeaders;

  if (isTauri()) {
    return createDesktopProviderGateway({
      ...config,
      baseURL: config.baseURL,
      defaultHeaders: config.defaultHeaders,
    });
  }

  // Dynamic import keeps LLM SDKs out of the initial bundle
  const { createGateway } = await import('@offisim/core');

  return createGateway({
    provider: config.provider,
    apiKey: config.apiKey ?? '',
    baseURL: proxyBaseURL ?? config.baseURL,
    defaultHeaders: proxyHeaders,
    dangerouslyAllowBrowser: true,
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TestChatTab({ formData, employeeName }: TestChatTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gatewayRef = useRef<LlmGateway | null>(null);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  });

  const handleClear = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;

    setInput('');
    setError(null);

    const userMsg: ChatMessage = { id: genId(), role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setIsSending(true);

    try {
      // Lazy-init the gateway
      if (!gatewayRef.current) {
        gatewayRef.current = await createTestGateway();
      }
      if (!gatewayRef.current) {
        setError('No provider configured. Open Settings to configure an LLM provider.');
        setIsSending(false);
        return;
      }

      // Build conversation for the LLM
      const systemPrompt = buildSystemPrompt(formData);
      const providerConfig = loadProviderConfig();
      const model = formData.modelPreference || providerConfig?.model || 'gpt-4o-mini';

      const llmMessages: LlmMessage[] = [
        { role: 'system', content: systemPrompt },
        // Include prior conversation for multi-turn context
        ...messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user' as const, content: trimmed },
      ];

      const response = await gatewayRef.current.chat({
        messages: llmMessages,
        model,
        temperature: formData.temperature,
        maxTokens: formData.maxTokens,
      });

      const assistantMsg: ChatMessage = {
        id: genId(),
        role: 'assistant',
        content: response.content || '(empty response)',
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsSending(false);
    }
  }, [input, isSending, formData, messages]);

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col gap-2 pt-2" style={{ minHeight: 320 }}>
      {/* Header with clear button */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400 font-mono">
          Test chat with <span className="text-orange-400">{employeeName || 'this employee'}</span>{' '}
          (unsaved config)
        </span>
        {!isEmpty && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-slate-400 hover:text-slate-100"
            onClick={handleClear}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="border-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Message area */}
      <ScrollArea className="flex-1 border-2 border-slate-700 rounded" style={{ height: 220 }}>
        <div ref={scrollRef} className="flex flex-col gap-2 p-3">
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
              <MessageSquare className="h-8 w-8 text-slate-400/40" />
              <p className="text-xs text-slate-400/60 font-mono max-w-[240px]">
                Send a message to test this employee's personality and configuration. Uses current
                form values, not saved data.
              </p>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div key={msg.id} className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[80%] border-2 px-3 py-1.5 text-xs whitespace-pre-wrap',
                      isUser
                        ? 'border-red-500/40 bg-red-500/10 text-slate-100'
                        : 'border-slate-700 bg-slate-800 text-slate-100',
                    )}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            })
          )}
          {isSending && (
            <div className="flex justify-start">
              <div className="border-2 border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-400 animate-pulse">
                Thinking...
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a test message..."
          disabled={isSending}
          className="min-h-[36px] max-h-[80px] resize-none text-xs"
          rows={1}
        />
        <Button
          size="icon"
          className="h-9 w-9"
          onClick={handleSend}
          disabled={isSending || !input.trim()}
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
