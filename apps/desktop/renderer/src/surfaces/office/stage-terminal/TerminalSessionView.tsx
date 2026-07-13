import type { StageViewTarget } from '@/app/ui-state.js';
import {
  type NativeStageSessionScope,
  type TerminalOutputChunk,
  type TerminalSessionSnapshot,
  invokeCommand,
} from '@/lib/tauri-commands.js';
import { acquireNativeStageSessionLease } from '@/surfaces/office/stage-viewer/StageSessionReconciler.js';
import { useSetStageChrome } from '@/surfaces/office/stage-viewer/stage-chrome.js';
import { type UnlistenFn, listen } from '@tauri-apps/api/event';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState } from 'react';
import './terminal-session.css';
import { bytesToBase64, terminalReplayStep } from './terminal-replay.js';

type TerminalTarget = Extract<StageViewTarget, { kind: 'terminal-session' }>;

interface TerminalSessionEvent {
  sessionId: string;
  kind: 'started' | 'output' | 'resized' | 'exited' | 'closed' | 'error';
  startCursor?: number;
  endCursor?: number;
  dataBase64?: string;
  status?: TerminalSessionSnapshot['status'];
  exitCode?: number | null;
  message?: string | null;
}

const TERMINAL_EVENT = 'offisim-terminal-session-event-v1';

function nativeScope(target: TerminalTarget): NativeStageSessionScope {
  return target.scope;
}

export function TerminalSessionView({ target }: { target: TerminalTarget }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const cursorRef = useRef(0);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const [snapshot, setSnapshot] = useState<TerminalSessionSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setChrome = useSetStageChrome();

  useEffect(() => {
    setChrome({
      title: target.title ?? 'Terminal',
      meta: snapshot?.cwd ?? 'Opening project shell…',
      badge: 'You · Manual',
    });
    return () => setChrome(null);
  }, [setChrome, snapshot?.cwd, target.title]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: '"SFMono-Regular", "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 8_000,
      theme: {
        background: '#090d12',
        foreground: '#d7e2ef',
        cursor: '#8be9fd',
        selectionBackground: '#24435a',
        black: '#0b1016',
        brightBlack: '#5f6b7a',
        red: '#ff6b7a',
        brightRed: '#ff8793',
        green: '#7ee787',
        brightGreen: '#9be9a8',
        yellow: '#e3b341',
        brightYellow: '#f2cc60',
        blue: '#58a6ff',
        brightBlue: '#79c0ff',
        magenta: '#bc8cff',
        brightMagenta: '#d2a8ff',
        cyan: '#56d4dd',
        brightCyan: '#8be9fd',
        white: '#b1bac4',
        brightWhite: '#f0f6fc',
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;

    const scope = nativeScope(target);
    const lease = acquireNativeStageSessionLease('terminal', target.scope, target.sessionId);
    let unlisten: UnlistenFn | undefined;
    let resizeFrame = 0;
    let focusFrame = 0;

    const writeChunk = (chunk: TerminalOutputChunk) => {
      if (!lease.isCurrent()) return;
      const step = terminalReplayStep(cursorRef.current, chunk);
      if (step.kind === 'ignore') return;
      if (step.kind === 'gap') {
        void refreshRef.current();
        return;
      }
      terminal.write(step.bytes);
      cursorRef.current = step.nextCursor;
    };

    const applySnapshot = (next: TerminalSessionSnapshot) => {
      if (!lease.isCurrent()) return;
      if (next.gap && cursorRef.current < next.startCursor) {
        terminal.reset();
        terminal.writeln(
          '\x1b[2m[Earlier terminal output was trimmed from the replay buffer.]\x1b[0m',
        );
        cursorRef.current = next.startCursor;
      }
      for (const chunk of [...next.chunks].sort((a, b) => a.startCursor - b.startCursor)) {
        writeChunk(chunk);
      }
      cursorRef.current = Math.max(cursorRef.current, next.endCursor);
      setSnapshot(next);
    };

    const refresh = async () => {
      if (!lease.isCurrent()) return;
      try {
        const next = await invokeCommand('terminal_session_snapshot', {
          sessionId: target.sessionId,
          scope,
          afterCursor: cursorRef.current,
        });
        if (lease.isCurrent()) applySnapshot(next);
      } catch (cause) {
        if (lease.isCurrent()) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    refreshRef.current = refresh;

    const resize = () => {
      if (!lease.isCurrent() || !host.isConnected) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      const cols = Math.max(20, terminal.cols);
      const rows = Math.max(4, terminal.rows);
      void lease
        .runIfCurrent(() =>
          invokeCommand('terminal_session_resize', {
            sessionId: target.sessionId,
            scope,
            cols,
            rows,
          }),
        )
        .catch(() => {});
    };

    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(resize);
    });
    observer.observe(host);

    const input = terminal.onData((data) => {
      if (!lease.isCurrent()) return;
      const bytes = new TextEncoder().encode(data);
      void lease
        .runIfCurrent(() =>
          invokeCommand('terminal_session_write', {
            sessionId: target.sessionId,
            scope,
            dataBase64: bytesToBase64(bytes),
          }),
        )
        .catch((cause: unknown) => {
          if (lease.isCurrent()) setError(cause instanceof Error ? cause.message : String(cause));
        });
    });

    void (async () => {
      try {
        const nextUnlisten = await listen<TerminalSessionEvent>(TERMINAL_EVENT, ({ payload }) => {
          if (payload.sessionId !== target.sessionId || !lease.isCurrent()) return;
          if (
            payload.kind === 'output' &&
            payload.dataBase64 &&
            payload.startCursor != null &&
            payload.endCursor != null
          ) {
            writeChunk({
              startCursor: payload.startCursor,
              endCursor: payload.endCursor,
              dataBase64: payload.dataBase64,
            });
            return;
          }
          if (payload.kind === 'error' && payload.message) setError(payload.message);
          void refresh();
        });
        if (!lease.isCurrent()) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
        const initial = await lease.runIfCurrent(() =>
          invokeCommand('terminal_session_create', {
            sessionId: target.sessionId,
            scope,
            cols: Math.max(20, terminal.cols),
            rows: Math.max(4, terminal.rows),
          }),
        );
        if (!lease.isCurrent() || !initial) return;
        applySnapshot(initial);
        setError(null);
        if (!lease.isCurrent()) return;
        focusFrame = window.requestAnimationFrame(() => {
          if (!lease.isCurrent()) return;
          resize();
          terminal.focus();
        });
      } catch (cause) {
        if (lease.isCurrent()) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    return () => {
      lease.release();
      window.cancelAnimationFrame(resizeFrame);
      window.cancelAnimationFrame(focusFrame);
      observer.disconnect();
      input.dispose();
      unlisten?.();
      refreshRef.current = async () => {};
      terminalRef.current = null;
      fitRef.current = null;
      terminal.dispose();
    };
  }, [target]);

  return (
    <section className="off-terminal-session" aria-label="Interactive project terminal">
      <div ref={hostRef} className="off-terminal-session-host" />
      <div className="off-terminal-session-foot" aria-live="polite">
        <span className={`is-${snapshot?.status ?? 'opening'}`}>
          {snapshot?.status ?? 'opening'}
        </span>
        <code>{snapshot?.shell ?? 'project shell'}</code>
        {error ? <strong>{error}</strong> : null}
      </div>
    </section>
  );
}
