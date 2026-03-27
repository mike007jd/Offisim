import { render, screen } from '@testing-library/react';
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
});
