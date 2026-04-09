import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SopWorkspacePage } from '../../components/sop/workspace/SopWorkspacePage.js';

const useSopsMock = vi.fn();
const sendMessageMock = vi.fn();
const eventBusOnMock = vi.fn(() => () => {});

vi.mock('../../hooks/useSops', () => ({
  useSops: () => useSopsMock(),
}));

vi.mock('../../runtime/offisim-runtime-context', () => ({
  useOffisimRuntime: () => ({
    sendMessage: sendMessageMock,
    eventBus: {
      on: eventBusOnMock,
    },
  }),
}));

vi.mock('../../components/sop/SopEditorDialog', () => ({
  SopEditorDialog: () => null,
}));

vi.mock('../../components/sop/SopImportDialog', () => ({
  SopImportDialog: () => null,
}));

vi.mock('../../components/sop/workspace/SopWorkspaceCanvas', () => ({
  SopWorkspaceCanvas: () => <div>canvas</div>,
}));

vi.mock('../../components/sop/workspace/SopWorkspaceEmptyState', () => ({
  SopWorkspaceEmptyState: () => <div>empty-state</div>,
}));

describe('SopWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSopsMock.mockReturnValue({
      sops: [],
      loading: false,
      deleteSop: vi.fn(),
      refreshSops: vi.fn(),
    });
  });

  it('renders the full-screen page with correct testId', () => {
    render(
      <SopWorkspacePage
        sessionState={{
          selectedSopId: null,
          leftPaneMode: 'library',
          centerMode: 'empty',
          rightPaneTab: 'context',
          search: '',
        }}
        onSessionStateChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('workspace-sops')).toBeInTheDocument();
    expect(screen.getByText('empty-state')).toBeInTheDocument();
  });
});
