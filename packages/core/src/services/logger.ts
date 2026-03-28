/**
 * Lightweight structured logger for @offisim/core.
 *
 * Replaces scattered console.error/warn calls with a unified, testable
 * logging facility. Default handler emits JSON to console; replaceable
 * via setLogHandler() for production log aggregators or test assertions.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  category: string;
  message: string;
  error?: unknown;
  context?: Record<string, unknown>;
  timestamp: number;
}

type LogHandler = (entry: LogEntry) => void;

let currentHandler: LogHandler = defaultHandler;

function defaultHandler(entry: LogEntry): void {
  const method =
    entry.level === 'debug'
      ? 'debug'
      : entry.level === 'info'
        ? 'info'
        : entry.level === 'warn'
          ? 'warn'
          : 'error';
  if (entry.error) {
    console[method](JSON.stringify({ ...entry, error: String(entry.error) }));
  } else {
    console[method](JSON.stringify(entry));
  }
}

/** Replace the global log handler (e.g. for testing or production log sinks). */
export function setLogHandler(handler: LogHandler): void {
  currentHandler = handler;
}

/** Reset to the default console JSON handler. */
export function resetLogHandler(): void {
  currentHandler = defaultHandler;
}

export class Logger {
  constructor(private readonly category: string) {}

  error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    currentHandler({
      level: 'error',
      category: this.category,
      message,
      error,
      context,
      timestamp: Date.now(),
    });
  }

  warn(message: string, context?: Record<string, unknown>): void {
    currentHandler({
      level: 'warn',
      category: this.category,
      message,
      context,
      timestamp: Date.now(),
    });
  }

  info(message: string, context?: Record<string, unknown>): void {
    currentHandler({
      level: 'info',
      category: this.category,
      message,
      context,
      timestamp: Date.now(),
    });
  }

  debug(message: string, context?: Record<string, unknown>): void {
    currentHandler({
      level: 'debug',
      category: this.category,
      message,
      context,
      timestamp: Date.now(),
    });
  }
}
