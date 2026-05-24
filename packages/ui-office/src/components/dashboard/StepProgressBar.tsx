import { Button, cn } from '@offisim/ui-core';
import { useState } from 'react';
import { taskStatusSegmentClass } from '../../lib/status-display';

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
          const segmentStyle = { width: `${widthPct}%` };

          return (
            <Button
              key={step.index}
              type="button"
              variant="ghost"
              title={`Step ${step.index + 1}: ${step.description} (${step.taskCount} tasks)`}
              // ui-hardcode-allowed: runtime geometry or third-party primitive style bridge.
              style={segmentStyle}
              className={cn(
                'relative h-full rounded-none p-0 transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-info',
                taskStatusSegmentClass(step.status, isHighlighted),
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
          const tooltipStyle = { left: `${leftPct}%` };
          return (
            <div
              className="pointer-events-none absolute top-full z-50 mt-1 max-w-step-tooltip rounded bg-surface-1 px-2 py-1 text-fs-micro text-accent-fg shadow-lg"
              // ui-hardcode-allowed: runtime geometry or third-party primitive style bridge.
              style={tooltipStyle}
            >
              <div className="font-medium">Step {hovered.index + 1}</div>
              <div className="text-ink-2">{hovered.description}</div>
              <div className="text-accent">
                {hovered.taskCount} task{hovered.taskCount !== 1 ? 's' : ''}
              </div>
            </div>
          );
        })()}
    </div>
  );
}
