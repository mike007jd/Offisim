import type { SopDefinition } from '@offisim/shared-types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../runtime/offisim-runtime-context.js', () => ({
  useOffisimRuntime: () => ({ eventBus: { on: vi.fn(() => () => {}) } }),
  useOffisimRuntimeStatus: () => ({ isRunning: false }),
}));

import { SopStepCard } from '../../components/sop/SopStepCard.js';
import { SopTimelineView } from '../../components/sop/SopTimelineView.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LINEAR_SOP: SopDefinition = {
  sop_id: 'sop-1',
  name: 'Test Linear',
  description: '',
  created_at: '2026-01-01',
  steps: [
    {
      step_id: 's1',
      label: 'Research',
      // biome-ignore lint/suspicious/noExplicitAny: mock type cast in test fixture
      role_slug: 'researcher' as any,
      instruction: '',
      dependencies: [],
      output_key: 'out1',
    },
    {
      step_id: 's2',
      label: 'Write',
      // biome-ignore lint/suspicious/noExplicitAny: mock type cast in test fixture
      role_slug: 'writer' as any,
      instruction: '',
      dependencies: ['s1'],
      output_key: 'out2',
    },
    {
      step_id: 's3',
      label: 'Review',
      // biome-ignore lint/suspicious/noExplicitAny: mock type cast in test fixture
      role_slug: 'manager' as any,
      instruction: '',
      dependencies: ['s2'],
      output_key: 'out3',
    },
  ],
};

const PARALLEL_SOP: SopDefinition = {
  sop_id: 'sop-2',
  name: 'Test Parallel',
  description: '',
  created_at: '2026-01-01',
  steps: [
    {
      step_id: 's1',
      label: 'Research',
      // biome-ignore lint/suspicious/noExplicitAny: mock type cast in test fixture
      role_slug: 'researcher' as any,
      instruction: '',
      dependencies: [],
      output_key: 'out1',
    },
    {
      step_id: 's2',
      label: 'Design',
      // biome-ignore lint/suspicious/noExplicitAny: mock type cast in test fixture
      role_slug: 'designer' as any,
      instruction: '',
      dependencies: [],
      output_key: 'out2',
    },
    {
      step_id: 's3',
      label: 'Merge',
      // biome-ignore lint/suspicious/noExplicitAny: mock type cast in test fixture
      role_slug: 'manager' as any,
      instruction: '',
      dependencies: ['s1', 's2'],
      output_key: 'out3',
    },
  ],
};

const EMPTY_SOP: SopDefinition = {
  sop_id: 'sop-3',
  name: 'Empty',
  description: '',
  created_at: '2026-01-01',
  steps: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SopTimelineView', () => {
  it('renders 3 cards for a 3-step linear SOP', () => {
    render(<SopTimelineView definition={LINEAR_SOP} />);
    expect(screen.getByText('Research')).toBeInTheDocument();
    expect(screen.getByText('Write')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
  });

  it('renders 3 phase labels for a linear SOP (one step per batch)', () => {
    render(<SopTimelineView definition={LINEAR_SOP} />);
    expect(screen.getAllByText(/Phase \d+/)).toHaveLength(3);
  });

  it('renders 2 batches for a parallel SOP (2 steps in batch 1)', () => {
    render(<SopTimelineView definition={PARALLEL_SOP} />);
    expect(screen.getAllByText(/Phase \d+/)).toHaveLength(2);
    // Batch 1 contains both Research and Design
    expect(screen.getByText('Research')).toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.getByText('Merge')).toBeInTheDocument();
  });

  it('shows empty state for SOP with no steps', () => {
    render(<SopTimelineView definition={EMPTY_SOP} />);
    expect(screen.getByText('No steps defined.')).toBeInTheDocument();
  });

  it('shows role slugs on cards', () => {
    render(<SopTimelineView definition={LINEAR_SOP} />);
    expect(screen.getByText('researcher')).toBeInTheDocument();
    expect(screen.getByText('writer')).toBeInTheDocument();
  });
});

describe('SopStepCard', () => {
  it('renders label and role slug', () => {
    render(<SopStepCard label="Research" roleSlug="researcher" status="design" stepIndex={0} totalSteps={3} />);
    expect(screen.getByText('Research')).toBeInTheDocument();
    expect(screen.getByText('researcher')).toBeInTheDocument();
  });

  it('shows emerald border for completed status', () => {
    const { container } = render(<SopStepCard label="Done" roleSlug="r" status="completed" stepIndex={0} totalSteps={1} />);
    expect(container.querySelector('button')).toHaveClass('border-emerald-400/20');
  });

  it('shows cyan border for active status', () => {
    const { container } = render(<SopStepCard label="Active" roleSlug="r" status="active" stepIndex={0} totalSteps={1} />);
    expect(container.querySelector('button')).toHaveClass('border-cyan-400/30');
  });

  it('shows red border for failed status', () => {
    const { container } = render(<SopStepCard label="Failed" roleSlug="r" status="failed" stepIndex={0} totalSteps={1} />);
    expect(container.querySelector('button')).toHaveClass('border-red-400/20');
  });
});
