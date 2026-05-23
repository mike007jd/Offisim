import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@offisim/ui-core';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Code,
  RefreshCw,
  UserRoundCog,
  X,
  Zap,
} from 'lucide-react';
import { useState } from 'react';
import type { TrackedError } from '../../hooks/useErrorTracking';
import type { AgentState } from '../../runtime/use-agent-states';

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
  onRetry?: () => void;
  /** Available employees for swap-person action. */
  employees?: Map<string, AgentState>;
  /** Called when user selects a different employee to re-dispatch. */
  onSwapPerson?: (employeeId: string) => void;
  /** Called to open settings so user can change model. */
  onSwapModel?: () => void;
  /** Accumulated error history from useErrorTracking. */
  errorHistory?: TrackedError[];
}

export function ErrorBanner({
  message,
  onDismiss,
  onRetry,
  employees,
  onSwapPerson,
  onSwapModel,
  errorHistory,
}: ErrorBannerProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [showSwapPerson, setShowSwapPerson] = useState(false);

  const employeeList = employees ? [...employees.entries()] : [];
  const hasHistory = errorHistory && errorHistory.length > 0;
  const latestError = hasHistory ? errorHistory[errorHistory.length - 1] : null;

  return (
    <div className="border-b-2 border-error/30 bg-error-muted">
      {/* Main error bar */}
      <div className="flex items-center gap-2 px-4 py-2 text-sm text-error">
        <AlertCircle className="size-4 shrink-0" />
        <span className="flex-1 truncate font-pixel-mono text-xs">{message}</span>

        {/* Action buttons */}
        <div className="flex shrink-0 items-center gap-1">
          {onRetry && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-error hover:bg-error-muted hover:text-error"
              onClick={onRetry}
              title="Retry with same configuration"
            >
              <RefreshCw className="mr-1 size-3" />
              Retry
            </Button>
          )}

          {onSwapPerson && employeeList.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-error hover:bg-error-muted hover:text-error"
              onClick={() => setShowSwapPerson(!showSwapPerson)}
              title="Re-dispatch task to a different employee"
            >
              <UserRoundCog className="mr-1 size-3" />
              Swap Person
            </Button>
          )}

          {onSwapModel && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-error hover:bg-error-muted hover:text-error"
              onClick={onSwapModel}
              title="Change LLM model in settings and retry"
            >
              <Zap className="mr-1 size-3" />
              Swap Model
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-error hover:bg-error-muted hover:text-error"
            onClick={() => setShowDetails(!showDetails)}
            title="View error details"
          >
            <Code className="mr-1 size-3" />
            Details
            {showDetails ? (
              <ChevronUp className="ml-0.5 size-3" />
            ) : (
              <ChevronDown className="ml-0.5 size-3" />
            )}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onDismiss}
            className="ml-1 size-6 shrink-0 text-error hover:bg-error-muted hover:text-error"
            aria-label="Dismiss error"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Swap Person dropdown */}
      {showSwapPerson && onSwapPerson && employeeList.length > 0 && (
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2">
            <span className="shrink-0 font-pixel-mono text-caption text-error">
              Re-dispatch to:
            </span>
            <Select
              onValueChange={(id) => {
                onSwapPerson(id);
                setShowSwapPerson(false);
              }}
            >
              <SelectTrigger className="h-7 max-w-48 border-error/30 text-xs">
                <SelectValue placeholder="Select employee..." />
              </SelectTrigger>
              <SelectContent>
                {employeeList.map(([id, agent]) => (
                  <SelectItem key={id} value={id}>
                    {agent.name} ({agent.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Error details panel */}
      {showDetails && (
        <div className="border-t border-error/20 px-4 pb-3">
          <div className="mt-2 max-h-48 flex flex-col gap-1.5 overflow-y-auto rounded bg-surface-elevated p-3 font-pixel-mono text-caption text-text-primary">
            <div>
              <span className="text-error">Error Message:</span>{' '}
              <span className="break-all">{message}</span>
            </div>
            {latestError && (
              <>
                <div>
                  <span className="text-error">Error Code:</span> {latestError.errorCode}
                </div>
                <div>
                  <span className="text-error">Node:</span> {latestError.nodeName}
                </div>
                {latestError.employeeId && (
                  <div>
                    <span className="text-error">Employee:</span> {latestError.employeeId}
                  </div>
                )}
                {latestError.taskRunId && (
                  <div>
                    <span className="text-error">Task Run:</span> {latestError.taskRunId}
                  </div>
                )}
                <div>
                  <span className="text-error">Recoverable:</span>{' '}
                  {latestError.recoverable ? 'Yes' : 'No'}
                </div>
                <div>
                  <span className="text-error">Time:</span>{' '}
                  {new Date(latestError.timestamp).toLocaleTimeString()}
                </div>
              </>
            )}
            {hasHistory && errorHistory.length > 1 && (
              <div className="mt-2 pt-2 border-t border-line">
                <span className="text-warning">Error History ({errorHistory.length} total):</span>
                {errorHistory
                  .slice(-5)
                  .reverse()
                  .map((err, i) => (
                    <div
                      key={`${err.timestamp}-${i}`}
                      className="mt-1 pl-2 border-l border-line"
                    >
                      <span className="text-ink-2/60">
                        [{new Date(err.timestamp).toLocaleTimeString()}]
                      </span>{' '}
                      {err.nodeName}: {err.message}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
