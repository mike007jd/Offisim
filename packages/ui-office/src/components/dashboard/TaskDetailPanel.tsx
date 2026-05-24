import { Button } from '@offisim/ui-core';
import { useState } from 'react';
import { taskStatusLabel } from '../../lib/status-display';

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
    <div className="task-detail-panel">
      <div className="task-detail-body">
        {/* Description */}
        <div className="task-detail-section">
          <span data-slot="label">Task</span>
          <p>{task.description}</p>
        </div>

        {/* Meta row */}
        <div className="task-detail-meta">
          {task.employeeName && (
            <span>
              <span data-slot="label-inline">Owner: </span>
              <span data-tone="accent">{task.employeeName}</span>
            </span>
          )}
          {task.taskType && (
            <span>
              <span data-slot="label-inline">Type: </span>
              <span>{task.taskType}</span>
            </span>
          )}
          <span>
            <span data-slot="label-inline">Status: </span>
            <span data-status={task.status}>{taskStatusLabel(task.status)}</span>
          </span>
          {taskCost > 0 && (
            <span>
              <span data-slot="label-inline">Est. cost: </span>
              <span data-tone="ok">${taskCost.toFixed(4)}</span>
            </span>
          )}
        </div>

        {/* Dependencies */}
        {task.dependencies && task.dependencies.length > 0 && (
          <div className="task-detail-dependencies">
            <span data-slot="label-inline">Depends on: </span>
            <span>{task.dependencies.join(', ')}</span>
          </div>
        )}

        {/* Output preview */}
        {hasOutput && (
          <div className="task-detail-section">
            <span data-slot="label">Output</span>
            <p data-slot="output">{outputText}</p>
            {output.length > OUTPUT_PREVIEW_LIMIT && (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="task-detail-toggle"
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
