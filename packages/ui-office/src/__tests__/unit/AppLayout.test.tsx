import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from '../../components/layout/AppLayout';

// Mock matchMedia so jsdom doesn't trigger narrow-screen auto-collapse
beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  localStorage.clear();
});

describe('AppLayout', () => {
  it('keeps the operations panel mounted while collapsed so event state is preserved', () => {
    render(
      <AppLayout
        header={<div>header</div>}
        agentPanel={<div>agents</div>}
        sceneCanvas={<div>scene</div>}
        chatDrawer={<div>chat</div>}
        eventLog={<div>persistent-events</div>}
        statusBar={<div>status</div>}
      />,
    );

    // Panels default to expanded — collapse the right panel
    fireEvent.click(screen.getByRole('button', { name: /collapse operations/i }));

    // Event log content stays mounted even when panel is collapsed
    expect(screen.getByText('Operations')).toBeInTheDocument();
    expect(screen.getByText('persistent-events')).toBeInTheDocument();
  });

  it('reports panel metrics so external overlays can follow sidebar width', async () => {
    const snapshots: Array<{ leftPanelWidth: number; rightPanelWidth: number }> = [];

    render(
      <AppLayout
        header={<div>header</div>}
        agentPanel={<div>agents</div>}
        sceneCanvas={<div>scene</div>}
        chatDrawer={<div>chat</div>}
        eventLog={<div>persistent-events</div>}
        statusBar={<div>status</div>}
        onLayoutMetricsChange={(metrics) => {
          snapshots.push({
            leftPanelWidth: metrics.leftPanelWidth,
            rightPanelWidth: metrics.rightPanelWidth,
          });
        }}
      />,
    );

    // Panels default to expanded (280px each)
    await waitFor(() => {
      expect(snapshots.at(-1)).toEqual({ leftPanelWidth: 280, rightPanelWidth: 280 });
    });

    // Collapse left panel
    fireEvent.click(screen.getByRole('button', { name: /collapse personnel/i }));

    await waitFor(() => {
      expect(snapshots.at(-1)).toEqual({ leftPanelWidth: 44, rightPanelWidth: 280 });
    });
  });

  it('mirrors the collapsed operations rail so the right side points inward', () => {
    const { container } = render(
      <AppLayout
        header={<div>header</div>}
        agentPanel={<div>agents</div>}
        sceneCanvas={<div>scene</div>}
        chatDrawer={<div>chat</div>}
        eventLog={<div>persistent-events</div>}
        statusBar={<div>status</div>}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /collapse operations/i }));

    const expandButton = screen.getByRole('button', { name: /expand operations/i });
    const label = screen.getByText('Operations');

    expect(label).toHaveStyle({ writingMode: 'vertical-rl', transform: 'rotate(180deg)' });
    expect(
      container.querySelector('button[aria-label="Expand operations panel"] svg.lucide-chevron-left'),
    ).not.toBeNull();
    expect(expandButton).toContainElement(label);
  });
});
