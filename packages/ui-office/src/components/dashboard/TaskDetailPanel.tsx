import { Button, cn } from '@offisim/ui-core';
import { useState } from 'react';
import { taskStatusLabel, taskStatusTextClass } from '../../lib/status-display';

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
  /** Accumulated estimated LLM cost for this task in USD. Hidden when 0. */
  taskCost?: number;
}

const OUTPUT_PREVIEW_LIMIT = 200;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskDetailPanel({ task, taskCost = 0 }: TaskDetailPanelProps) {
  const [showFullOutput, setShowFullOutput] = useState(false);

  const output = task.output ?? '';
  const hasOutput = output.length > 0;
  const outputTruncated = hasOutput && !showFullOutput && output.length > OUTPUT_PREVIEW_LIMIT;
  const outputText = outputTruncated ? `${output.slice(0, OUTPUT_PREVIEW_LIMIT)}…` : output;

  return (
    <div
      className={cn(
        'overflow-hidden transition-all duration-200 ease-in-out',
        'border-t border-line-soft bg-surface-2/70 px-3 py-2',
      )}
    >
      <div className="flex flex-col gap-1.5">
        {/* Description */}
        <div>
          <span className="text-fs-micro font-medium uppercase tracking-wide text-ink-3">Task</span>
          <p className="mt-0.5 text-xs text-ink-1">{task.description}</p>
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-fs-micro">
          {task.employeeName && (
            <span>
              <span className="text-ink-3">Owner: </span>
              <span className="text-accent">{task.employeeName}</span>
            </span>
          )}
          {task.taskType && (
            <span>
              <span className="text-ink-3">Type: </span>
              <span className="text-ink-1">{task.taskType}</span>
            </span>
          )}
          <span>
            <span className="text-ink-3">Status: </span>
            <span className={taskStatusTextClass(task.status)}>{taskStatusLabel(task.status)}</span>
          </span>
          {taskCost > 0 && (
            <span>
              <span className="text-ink-3">Est. cost: </span>
              <span className="font-mono text-ok">${taskCost.toFixed(4)}</span>
            </span>
          )}
        </div>

        {/* Dependencies */}
        {task.dependencies && task.dependencies.length > 0 && (
          <div className="text-fs-micro">
            <span className="text-ink-3">Depends on: </span>
            <span className="text-ink-1">{task.dependencies.join(', ')}</span>
          </div>
        )}

        {/* Output preview */}
        {hasOutput && (
          <div>
            <span className="text-fs-micro font-medium uppercase tracking-wide text-ink-3">
              Output
            </span>
            <p className="mt-0.5 whitespace-pre-wrap break-words font-mono text-fs-micro leading-relaxed text-ink-3">
              {outputText}
            </p>
            {output.length > OUTPUT_PREVIEW_LIMIT && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="mt-0.5 h-auto p-0 text-fs-micro text-accent"
                onClick={() => setShowFullOutput((v) => !v)}
              >
                {showFullOutput ? 'Show less' : 'Show more'}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
