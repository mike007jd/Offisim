import type { CostAggregate } from '@offisim/core/browser';
import { render, screen } from '@testing-library/react';
import { CostByModelCard } from '../../components/dashboard/CostByModelCard.js';
import { CostOverviewCard } from '../../components/dashboard/CostOverviewCard.js';
import type { CostSummary } from '../../hooks/useCostDashboard.js';

describe('Dashboard cost cards', () => {
  it('shows pricing confidence and unpriced calls in the overview card', () => {
    const summary: CostSummary = {
      totalCost: 1.25,
      todayCost: 0.75,
      totalCalls: 10,
      todayCalls: 4,
      pricedCallCount: 7,
      unpricedCallCount: 3,
      costConfidence: 'catalog',
    };

    render(<CostOverviewCard summary={summary} loading={false} />);

    expect(screen.getByText('Pricing')).toBeInTheDocument();
    expect(screen.getByText('Catalog estimate')).toBeInTheDocument();
    expect(screen.getByText('Unpriced Calls')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('flags model groups that include unpriced calls', () => {
    const byModel: CostAggregate[] = [
      {
        groupKey: 'openrouter/openai/gpt-4o-mini',
        inputTokens: 1000,
        outputTokens: 500,
        totalCost: 0.25,
        callCount: 2,
        pricedCallCount: 1,
        unpricedCallCount: 1,
        pricingConfidence: 'unknown',
      },
    ];

    render(<CostByModelCard byModel={byModel} loading={false} />);

    expect(screen.getByText(/1 unpriced/i)).toBeInTheDocument();
    expect(screen.getByText(/unknown pricing/i)).toBeInTheDocument();
  });
});
