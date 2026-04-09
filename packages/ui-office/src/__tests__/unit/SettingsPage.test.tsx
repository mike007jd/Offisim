import { render, screen } from '@testing-library/react';

vi.mock('@offisim/ui-core', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SelectValue: () => <span>Select value</span>,
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

vi.mock('../../theme', () => ({
  useTheme: () => ({
    density: 'normal',
    setDensity: vi.fn(),
  }),
}));

vi.mock('../../lib/desktop-provider-secrets', () => ({
  clearRuntimeSecret: vi.fn(),
  getRuntimeSecretStatus: vi.fn().mockResolvedValue({ hasSecret: false }),
  setRuntimeSecret: vi.fn(),
}));

vi.mock('../../lib/env', () => ({
  isTauri: () => false,
}));

vi.mock('../../lib/provider-config', () => ({
  createDefaultRuntimePolicy: () => ({
    executionMode: 'auto',
    summarization: { enabled: true, triggerTokens: 12000, keepRecentMessages: 8 },
    memory: { enabled: true, injectionEnabled: true, maxFacts: 12, factConfidenceThreshold: 0.7 },
    toolSearch: { enabled: true },
    toolPermissions: 'ask',
    gitAutoCommit: true,
    modelPolicy: {
      default: { provider: 'anthropic', model: 'minimax-m1', profileName: 'runtime-default' },
    },
  }),
  loadProviderConfig: () => null,
  normalizeRuntimePolicy: (policy: unknown) => policy,
  saveProviderConfig: vi.fn(),
}));

vi.mock('../../components/openclaw/OpenClawSettings', () => ({
  OpenClawSettings: () => <div>OpenClaw panel</div>,
}));

vi.mock('../../components/settings/McpConfigPanel', () => ({
  McpConfigPanel: () => <div>MCP panel</div>,
}));

vi.mock('../../components/settings/provider-presets', () => ({
  PROVIDER_PRESETS: {
    'minimax-intl-anthropic-coding': {
      label: 'MiniMax Intl / Anthropic Coding',
      vendor: 'minimax',
      region: 'intl',
      compatibility: 'anthropic',
      surface: 'coding-plan',
      capabilities: {
        streaming: true,
        thinking: true,
        tool_calls: true,
        tool_stream: true,
        coding_plan: true,
      },
      hasThinking: true,
      defaults: {
        provider: 'anthropic',
        baseURL: 'https://api.minimax.io/anthropic',
        model: 'MiniMax-M1',
      },
    },
  },
  findProviderPresetKeyByConfig: () => 'minimax-intl-anthropic-coding',
  getAvailableProviderPresets: () => ({
    'minimax-intl-anthropic-coding': {
      label: 'MiniMax Intl / Anthropic Coding',
      defaults: {
        provider: 'anthropic',
        baseURL: 'https://api.minimax.io/anthropic',
        model: 'MiniMax-M1',
      },
    },
  }),
  getDefaultProviderPresetKey: () => 'minimax-intl-anthropic-coding',
  getProviderPreset: () => ({
    label: 'MiniMax Intl / Anthropic Coding',
    vendor: 'minimax',
    region: 'intl',
    compatibility: 'anthropic',
    surface: 'coding-plan',
    capabilities: {
      streaming: true,
      thinking: true,
      tool_calls: true,
      tool_stream: true,
      coding_plan: true,
    },
    defaults: {
      provider: 'anthropic',
      baseURL: 'https://api.minimax.io/anthropic',
      model: 'MiniMax-M1',
    },
  }),
}));

import { SettingsPage } from '../../components/settings/SettingsPage.js';

describe('SettingsPage', () => {
  it('renders settings as a full-page workspace surface with the same new control language', () => {
    render(
      <SettingsPage
        sessionState={{ activeTab: 'provider' }}
        onSessionStateChange={vi.fn()}
        onBack={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Provider Workspace' })).toBeInTheDocument();
    expect(screen.getAllByText('Official compatibility').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Runtime orchestration' })).toBeInTheDocument();
  });
});
