import type { InteractionRequest } from '@offisim/shared-types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatusBar } from '../../components/layout/StatusBar';

const mockRuntime = {
  error: null as string | null,
  interactionMode: 'human_in_loop' as const,
  setInteractionMode: vi.fn(),
  pendingInteraction: null as InteractionRequest | null,
};

vi.mock('../../runtime/offisim-runtime-context', () => ({
  useOffisimRuntime: () => mockRuntime,
  useOffisimRuntimeStatus: () => ({ isRunning: false, version: 1 }),
}));

vi.mock('../../runtime/use-runtime-activity-feed', () => ({
  useRuntimeActivityFeed: () => ({
    headline: null,
    entries: [],
    activeTools: [],
    totalCostUsd: null,
    hasActivity: false,
  }),
}));

vi.mock('../../hooks/useDashboardMetrics', () => ({
  useDashboardMetrics: () => ({
    activeTaskCount: 0,
    employeeUtilization: { active: 1, total: 3 },
    totalInputTokens: 0,
    totalOutputTokens: 0,
    estimatedCostUsd: 0,
    elapsedMs: null,
  }),
}));

vi.mock('../../hooks/usePipelineStage', () => ({
  usePipelineStage: () => ({ stage: null, routeLabel: null }),
  STAGE_META: {},
}));

vi.mock('./EnergyMeter.js', () => ({
  EnergyMeter: () => null,
}));

describe('StatusBar', () => {
  it('shows an interaction-specific label for plan review', () => {
    mockRuntime.pendingInteraction = {
      interactionId: 'ix-plan-1',
      threadId: 'thread-1',
      companyId: 'co-1',
      kind: 'plan_review',
      severity: 'normal',
      title: 'Review plan before execution',
      prompt: 'Review the generated plan.',
      options: [{ id: 'start_execution', label: 'Start execution' }],
      allowFreeformResponse: true,
      createdAt: Date.now(),
    };

    render(<StatusBar modelName="gpt-test" />);

    expect(screen.getByText('Awaiting plan review')).toBeInTheDocument();
  });
});
