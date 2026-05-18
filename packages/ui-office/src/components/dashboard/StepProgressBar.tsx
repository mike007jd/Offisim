import { Button, cn } from '@offisim/ui-core';
import { useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StepProgressSegment {
  index: number;
  description: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  taskCount: number;
}

export interface StepProgressBarProps {
  steps: StepProgressSegment[];
  activeFilter: number | null;
  onSegmentClick: (stepIndex: number | null) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function segmentColor(status: StepProgressSegment['status'], isHighlighted: boolean): string {
  const dimmed = !isHighlighted ? 'opacity-50' : '';
  switch (status) {
    case 'completed':
      return cn('bg-success', dimmed);
    case 'active':
      return cn('bg-info', dimmed);
    case 'failed':
      return cn('bg-error', dimmed);
    default:
      return cn('bg-text-muted', dimmed);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StepProgressBar({ steps, activeFilter, onSegmentClick }: StepProgressBarProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (steps.length === 0) return null;

  const totalTasks = steps.reduce((sum, s) => sum + Math.max(s.taskCount, 1), 0);

  return (
    <div className="relative h-8 w-full">
      <div className="flex h-full w-full gap-px overflow-hidden rounded">
        {steps.map((step) => {
          const widthPct = (Math.max(step.taskCount, 1) / totalTasks) * 100;
          const isHighlighted = activeFilter === null || activeFilter === step.index;

          return (
            <Button
              key={step.index}
              type="button"
              variant="ghost"
              title={`Step ${step.index + 1}: ${step.description} (${step.taskCount} tasks)`}
              style={{ width: `${widthPct}%` }}
              className={cn(
                'relative h-full rounded-none p-0 transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-info',
                segmentColor(step.status, isHighlighted),
                activeFilter === step.index && 'ring-2 ring-inset ring-border-focus',
              )}
              onClick={() => onSegmentClick(activeFilter === step.index ? null : step.index)}
              onMouseEnter={() => setHoveredIndex(step.index)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
          );
        })}
      </div>

      {/* Tooltip */}
      {hoveredIndex !== null &&
        (() => {
          const hovered = steps.find((s) => s.index === hoveredIndex);
          if (!hovered) return null;
          const totalSoFar = steps
            .slice(0, hoveredIndex)
            .reduce((sum, s) => sum + Math.max(s.taskCount, 1), 0);
          const leftPct = (totalSoFar / totalTasks) * 100;
          return (
            <div
              className="pointer-events-none absolute top-full z-50 mt-1 max-w-step-tooltip rounded bg-ocean-deep px-2 py-1 text-caption text-pearl shadow-lg"
              style={{ left: `${leftPct}%` }}
            >
              <div className="font-medium">Step {hovered.index + 1}</div>
              <div className="text-shell">{hovered.description}</div>
              <div className="text-koi">
                {hovered.taskCount} task{hovered.taskCount !== 1 ? 's' : ''}
              </div>
            </div>
          );
        })()}
    </div>
  );
}
