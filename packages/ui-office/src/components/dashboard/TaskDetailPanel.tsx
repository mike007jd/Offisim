import { useState } from 'react';
import { cn } from '@aics/ui-core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskDetail {
  taskRunId: string;
  description: string;
  employeeName?: string;
  taskType?: string;
  status: string;
  output?: string;
  dependencies?: string[];
}

export interface TaskDetailPanelProps {
  task: TaskDetail;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'text-green-400';
    case 'active':
    case 'running':
      return 'text-blue-400';
    case 'failed':
    case 'cancelled':
      return 'text-red-400';
    case 'review_ready':
      return 'text-sand';
    default:
      return 'text-shell';
  }
}

const OUTPUT_PREVIEW_LIMIT = 200;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskDetailPanel({ task }: TaskDetailPanelProps) {
  const [showFullOutput, setShowFullOutput] = useState(false);

  const hasOutput = typeof task.output === 'string' && task.output.length > 0;
  const outputTruncated = hasOutput && !showFullOutput && task.output!.length > OUTPUT_PREVIEW_LIMIT;
  const outputText = outputTruncated ? task.output!.slice(0, OUTPUT_PREVIEW_LIMIT) + '…' : task.output;

  return (
    <div
      className={cn(
        'overflow-hidden transition-all duration-200 ease-in-out',
        'border-t border-ocean-mid/20 bg-ocean-deep/70 px-3 py-2',
      )}
    >
      <div className="flex flex-col gap-1.5">
        {/* Description */}
        <div>
          <span className="text-[10px] font-medium text-shell uppercase tracking-wide">Task</span>
          <p className="mt-0.5 text-xs text-pearl">{task.description}</p>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px]">
          {task.employeeName && (
            <span>
              <span className="text-shell">Assigned to: </span>
              <span className="text-koi">{task.employeeName}</span>
            </span>
          )}
          {task.taskType && (
            <span>
              <span className="text-shell">Type: </span>
              <span className="text-pearl">{task.taskType}</span>
            </span>
          )}
          <span>
            <span className="text-shell">Status: </span>
            <span className={statusColor(task.status)}>{task.status}</span>
          </span>
        </div>

        {/* Dependencies */}
        {task.dependencies && task.dependencies.length > 0 && (
          <div className="text-[10px]">
            <span className="text-shell">Depends on: </span>
            <span className="text-pearl">{task.dependencies.join(', ')}</span>
          </div>
        )}

        {/* Output preview */}
        {hasOutput && (
          <div>
            <span className="text-[10px] font-medium text-shell uppercase tracking-wide">Output</span>
            <p className="mt-0.5 whitespace-pre-wrap break-words text-[10px] text-shell font-mono leading-relaxed">
              {outputText}
            </p>
            {task.output!.length > OUTPUT_PREVIEW_LIMIT && (
              <button
                type="button"
                className="mt-0.5 text-[10px] text-koi hover:underline"
                onClick={() => setShowFullOutput((v) => !v)}
              >
                {showFullOutput ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
