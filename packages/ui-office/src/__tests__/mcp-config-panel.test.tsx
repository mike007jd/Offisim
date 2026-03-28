import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpConfigPanel } from '../components/settings/McpConfigPanel';

const connectMcpServer = vi.fn();
const disconnectMcpServer = vi.fn();

vi.mock('../runtime/offisim-runtime-context', () => ({
  useOffisimRuntime: () => ({
    connectMcpServer,
    disconnectMcpServer,
    connectedMcpServers: new Set<string>(),
    isReady: true,
  }),
}));

function setTauriMode(enabled: boolean) {
  if (enabled) {
    Object.defineProperty(window, '__TAURI__', {
      value: {},
      configurable: true,
    });
    return;
  }

  Reflect.deleteProperty(window, '__TAURI__');
}

describe('McpConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setTauriMode(false);
  });

  afterEach(() => {
    localStorage.clear();
    setTauriMode(false);
  });

  it('keeps legacy browser MCP configs reconnectable', async () => {
    localStorage.setItem(
      'offisim:mcp-servers',
      JSON.stringify([
        {
          name: 'legacy-fs',
          transport: 'stdio',
          commandOrUrl: 'npx @modelcontextprotocol/server-filesystem /tmp',
        },
      ]),
    );

    const user = userEvent.setup();
    render(<McpConfigPanel />);

    expect(
      screen.getByText((content) =>
        content.includes('npx @modelcontextprotocol/server-filesystem /tmp'),
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(connectMcpServer).toHaveBeenCalledWith({
      name: 'legacy-fs',
      transport: 'stdio',
      registeredServerId: undefined,
      command: 'npx @modelcontextprotocol/server-filesystem /tmp',
      args: undefined,
      url: undefined,
    });
  });
});
