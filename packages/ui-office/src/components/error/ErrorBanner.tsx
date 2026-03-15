import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@aics/ui-core';
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
    <div className="border-b-2 border-lobster-red/30 bg-lobster-red/10">
      {/* Main error bar */}
      <div className="flex items-center gap-2 px-4 py-2 text-sm text-lobster-red">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate font-pixel-mono text-xs">{message}</span>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {onRetry && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-lobster-red hover:text-lobster-red hover:bg-lobster-red/10"
              onClick={onRetry}
              title="Retry with same configuration"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              Retry
            </Button>
          )}

          {onSwapPerson && employeeList.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-lobster-red hover:text-lobster-red hover:bg-lobster-red/10"
              onClick={() => setShowSwapPerson(!showSwapPerson)}
              title="Re-dispatch task to a different employee"
            >
              <UserRoundCog className="h-3 w-3 mr-1" />
              Swap Person
            </Button>
          )}

          {onSwapModel && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-lobster-red hover:text-lobster-red hover:bg-lobster-red/10"
              onClick={onSwapModel}
              title="Change LLM model in settings and retry"
            >
              <Zap className="h-3 w-3 mr-1" />
              Swap Model
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-lobster-red hover:text-lobster-red hover:bg-lobster-red/10"
            onClick={() => setShowDetails(!showDetails)}
            title="View error details"
          >
            <Code className="h-3 w-3 mr-1" />
            Details
            {showDetails ? (
              <ChevronUp className="h-3 w-3 ml-0.5" />
            ) : (
              <ChevronDown className="h-3 w-3 ml-0.5" />
            )}
          </Button>

          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 hover:opacity-70 ml-1"
            aria-label="Dismiss error"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Swap Person dropdown */}
      {showSwapPerson && onSwapPerson && employeeList.length > 0 && (
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-lobster-red font-pixel-mono shrink-0">
              Re-dispatch to:
            </span>
            <Select
              onValueChange={(id) => {
                onSwapPerson(id);
                setShowSwapPerson(false);
              }}
            >
              <SelectTrigger className="h-7 text-xs max-w-[200px] border-lobster-red/30">
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
        <div className="px-4 pb-3 border-t border-lobster-red/20">
          <div className="mt-2 rounded bg-ocean-deep/80 p-3 font-pixel-mono text-[10px] text-shell space-y-1.5 max-h-[200px] overflow-y-auto">
            <div>
              <span className="text-lobster-red">Error Message:</span>{' '}
              <span className="break-all">{message}</span>
            </div>
            {latestError && (
              <>
                <div>
                  <span className="text-lobster-red">Error Code:</span> {latestError.errorCode}
                </div>
                <div>
                  <span className="text-lobster-red">Node:</span> {latestError.nodeName}
                </div>
                {latestError.employeeId && (
                  <div>
                    <span className="text-lobster-red">Employee:</span> {latestError.employeeId}
                  </div>
                )}
                {latestError.taskRunId && (
                  <div>
                    <span className="text-lobster-red">Task Run:</span> {latestError.taskRunId}
                  </div>
                )}
                <div>
                  <span className="text-lobster-red">Recoverable:</span>{' '}
                  {latestError.recoverable ? 'Yes' : 'No'}
                </div>
                <div>
                  <span className="text-lobster-red">Time:</span>{' '}
                  {new Date(latestError.timestamp).toLocaleTimeString()}
                </div>
              </>
            )}
            {hasHistory && errorHistory.length > 1 && (
              <div className="mt-2 pt-2 border-t border-ocean-light/30">
                <span className="text-coral">Error History ({errorHistory.length} total):</span>
                {errorHistory
                  .slice(-5)
                  .reverse()
                  .map((err, i) => (
                    <div
                      key={`${err.timestamp}-${i}`}
                      className="mt-1 pl-2 border-l border-ocean-light/20"
                    >
                      <span className="text-shell/60">
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
