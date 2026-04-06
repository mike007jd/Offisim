import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from '../../components/layout/AppLayout';

function mockViewport({
  mobile = false,
  tablet = false,
}: { mobile?: boolean; tablet?: boolean } = {}) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        query === '(max-width: 768px)' ? mobile : query === '(max-width: 1280px)' ? tablet : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  mockViewport();
  localStorage.clear();
});

describe('AppLayout', () => {
  it('defaults both panels open on desktop widths', () => {
    mockViewport({ mobile: false, tablet: false });

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

    expect(screen.getByRole('button', { name: /collapse personnel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /collapse chat/i })).toBeInTheDocument();
  });

  it('defaults to left-open right-collapsed at tablet widths', () => {
    mockViewport({ mobile: false, tablet: true });

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

    expect(screen.getByRole('button', { name: /collapse personnel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /expand chat/i })).toBeInTheDocument();
  });

  it('keeps the chat panel mounted while collapsed so collaboration state is preserved', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /collapse chat/i }));

    // Chat content stays mounted even when panel is collapsed
    expect(screen.getByText('Chat')).toBeInTheDocument();
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

  it('mirrors the collapsed chat rail so the right side points inward', () => {
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

    fireEvent.click(screen.getByRole('button', { name: /collapse chat/i }));

    const expandButton = screen.getByRole('button', { name: /expand chat/i });
    const label = screen.getByText('Chat');

    expect(label).toHaveStyle({ writingMode: 'vertical-rl', transform: 'rotate(180deg)' });
    expect(
      container.querySelector(
        'button[aria-label="Expand chat panel"] svg.lucide-chevron-left',
      ),
    ).not.toBeNull();
    expect(expandButton).toContainElement(label);
  });

  it('re-opens the right collaboration panel when a chat request arrives on desktop', async () => {
    const { rerender } = render(
      <AppLayout
        header={<div>header</div>}
        agentPanel={<div>agents</div>}
        sceneCanvas={<div>scene</div>}
        chatDrawer={<div>chat</div>}
        eventLog={<div>persistent-events</div>}
        statusBar={<div>status</div>}
        requestRightPanelOpen={0}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /collapse chat/i }));
    expect(screen.getByRole('button', { name: /expand chat/i })).toBeInTheDocument();

    rerender(
      <AppLayout
        header={<div>header</div>}
        agentPanel={<div>agents</div>}
        sceneCanvas={<div>scene</div>}
        chatDrawer={<div>chat</div>}
        eventLog={<div>persistent-events</div>}
        statusBar={<div>status</div>}
        requestRightPanelOpen={1}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /collapse chat/i })).toBeInTheDocument();
    });
  });
});
