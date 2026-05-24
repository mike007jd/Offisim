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
    <div className="error-banner">
      {/* Main error bar */}
      <div className="error-banner-main">
        <AlertCircle data-icon="status" aria-hidden="true" />
        <span data-slot="message">{message}</span>

        {/* Action buttons */}
        <div className="error-banner-actions">
          {onRetry && (
            <Button
              variant="ghost"
              size="sm"
              className="error-banner-action"
              onClick={onRetry}
              title="Retry with same configuration"
            >
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
              Retry
            </Button>
          )}

          {onSwapPerson && employeeList.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="error-banner-action"
              onClick={() => setShowSwapPerson(!showSwapPerson)}
              title="Re-dispatch task to a different employee"
            >
              <UserRoundCog data-icon="inline-start" aria-hidden="true" />
              Swap Person
            </Button>
          )}

          {onSwapModel && (
            <Button
              variant="ghost"
              size="sm"
              className="error-banner-action"
              onClick={onSwapModel}
              title="Change LLM model in settings and retry"
            >
              <Zap data-icon="inline-start" aria-hidden="true" />
              Swap Model
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="error-banner-action"
            onClick={() => setShowDetails(!showDetails)}
            title="View error details"
          >
            <Code data-icon="inline-start" aria-hidden="true" />
            Details
            {showDetails ? (
              <ChevronUp data-icon="inline-end" aria-hidden="true" />
            ) : (
              <ChevronDown data-icon="inline-end" aria-hidden="true" />
            )}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onDismiss}
            className="error-banner-dismiss"
            aria-label="Dismiss error"
          >
            <X data-icon="button" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Swap Person dropdown */}
      {showSwapPerson && onSwapPerson && employeeList.length > 0 && (
        <div className="error-banner-swap">
          <div>
            <span>Re-dispatch to:</span>
            <Select
              onValueChange={(id) => {
                onSwapPerson(id);
                setShowSwapPerson(false);
              }}
            >
              <SelectTrigger className="error-banner-select">
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
        <div className="error-banner-details-wrap">
          <div className="error-banner-details">
            <div>
              <span data-tone="danger">Error Message:</span> <span data-break>{message}</span>
            </div>
            {latestError && (
              <>
                <div>
                  <span data-tone="danger">Error Code:</span> {latestError.errorCode}
                </div>
                <div>
                  <span data-tone="danger">Node:</span> {latestError.nodeName}
                </div>
                {latestError.employeeId && (
                  <div>
                    <span data-tone="danger">Employee:</span> {latestError.employeeId}
                  </div>
                )}
                {latestError.taskRunId && (
                  <div>
                    <span data-tone="danger">Task Run:</span> {latestError.taskRunId}
                  </div>
                )}
                <div>
                  <span data-tone="danger">Recoverable:</span>{' '}
                  {latestError.recoverable ? 'Yes' : 'No'}
                </div>
                <div>
                  <span data-tone="danger">Time:</span>{' '}
                  {new Date(latestError.timestamp).toLocaleTimeString()}
                </div>
              </>
            )}
            {hasHistory && errorHistory.length > 1 && (
              <div className="error-banner-history">
                <span data-tone="warn">Error History ({errorHistory.length} total):</span>
                {errorHistory
                  .slice(-5)
                  .reverse()
                  .map((err, i) => (
                    <div key={`${err.timestamp}-${i}`}>
                      <span data-slot="time">[{new Date(err.timestamp).toLocaleTimeString()}]</span>{' '}
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
