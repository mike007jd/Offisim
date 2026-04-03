import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppLayout } from '../../components/layout/AppLayout';

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

    await waitFor(() => {
      expect(snapshots.at(-1)).toEqual({ leftPanelWidth: 44, rightPanelWidth: 44 });
    });

    fireEvent.click(screen.getByRole('button', { name: /personnel/i }));

    await waitFor(() => {
      expect(snapshots.at(-1)).toEqual({ leftPanelWidth: 280, rightPanelWidth: 44 });
    });
  });
});
