import type { SopStep } from '@offisim/shared-types';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SopDagCanvas } from '../../components/sop/SopDagCanvas';
import type { DagLayout } from '../../components/sop/sop-dag-layout';

const resizeObserverStub = class {
  observe() {}
  disconnect() {}
};

const START_STEP: SopStep = {
  step_id: 'start',
  label: 'Start',
  role_slug: 'developer',
  instruction: 'Begin the workflow.',
  dependencies: [],
  output_key: 'start',
};

const REVIEW_STEP: SopStep = {
  step_id: 'review',
  label: 'Review',
  role_slug: 'qa',
  instruction: 'Review the result.',
  dependencies: ['start'],
  output_key: 'review',
};

const LAYOUT: DagLayout = {
  nodes: [
    {
      stepId: START_STEP.step_id,
      step: START_STEP,
      x: 40,
      y: 40,
      width: 280,
      height: 140,
      batchIndex: 0,
      inputPort: { x: 40, y: 110 },
      outputPort: { x: 320, y: 110 },
    },
    {
      stepId: REVIEW_STEP.step_id,
      step: REVIEW_STEP,
      x: 440,
      y: 40,
      width: 280,
      height: 140,
      batchIndex: 1,
      inputPort: { x: 440, y: 110 },
      outputPort: { x: 720, y: 110 },
    },
  ],
  edges: [
    {
      fromStepId: START_STEP.step_id,
      toStepId: REVIEW_STEP.step_id,
      fromPoint: { x: 320, y: 110 },
      toPoint: { x: 440, y: 110 },
    },
  ],
  totalWidth: 760,
  totalHeight: 220,
};

describe('SopDagCanvas', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', resizeObserverStub);
  });

  it('renders edit handles in the SVG layer instead of relying on foreignObject overflow', () => {
    render(
      <SopDagCanvas
        layout={LAYOUT}
        runtimeState={null}
        selectedStepId={null}
        onStepClick={vi.fn()}
        stepIds={[START_STEP.step_id, REVIEW_STEP.step_id]}
        editMode
      />,
    );

    const outputHandle = screen.getByLabelText('Create dependency from Start');
    const inputHandle = screen.getByLabelText('Connect dependency into Review');

    expect(outputHandle.closest('foreignObject')).toBeNull();
    expect(inputHandle.closest('foreignObject')).toBeNull();
  });

  it('creates a dependency when dragging from an output handle to an input handle', () => {
    const onAddDependency = vi.fn();

    render(
      <SopDagCanvas
        layout={LAYOUT}
        runtimeState={null}
        selectedStepId={null}
        onStepClick={vi.fn()}
        stepIds={[START_STEP.step_id, REVIEW_STEP.step_id]}
        editMode
        onAddDependency={onAddDependency}
      />,
    );

    fireEvent.mouseDown(screen.getByLabelText('Create dependency from Start'));
    fireEvent.mouseUp(screen.getByLabelText('Connect dependency into Review'));

    expect(onAddDependency).toHaveBeenCalledWith('start', 'review');
  });

  it('uses a readable default stroke for pending edges', () => {
    const { container } = render(
      <SopDagCanvas
        layout={LAYOUT}
        runtimeState={null}
        selectedStepId={null}
        onStepClick={vi.fn()}
        stepIds={[START_STEP.step_id, REVIEW_STEP.step_id]}
      />,
    );

    const edgePath = container.querySelector('path[d^="M320,110 C"]');
    expect(edgePath).not.toBeNull();
    expect(edgePath).toHaveAttribute('stroke', 'rgba(148,163,184,0.45)');
  });
});
