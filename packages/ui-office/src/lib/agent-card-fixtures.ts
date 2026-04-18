import type { A2AAgentCard } from '@offisim/core/browser';

export const HERMES_FIXTURE_CARD: A2AAgentCard = {
  name: 'Hermes',
  description: 'Brand-packaged engineering agent for design-system tasks.',
  version: '1.0.0',
  supportedInterfaces: [
    { url: 'https://hermes.example.dev/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
  ],
  capabilities: { streaming: true, pushNotifications: false },
  provider: { organization: 'Hermes Labs', url: 'https://hermes.example.dev' },
  skills: [
    {
      id: 'design-tokens',
      name: 'Design tokens',
      description: 'Generate and refine design tokens from requirements.',
      tags: ['design', 'tokens'],
    },
  ],
};

export const OPENCLAW_FIXTURE_CARD: A2AAgentCard = {
  name: 'OpenClaw Deep Research',
  description: 'Research-focused OpenClaw agent for market intelligence.',
  version: '1.0.0',
  supportedInterfaces: [
    { url: 'https://openclaw.example.dev/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
  ],
  capabilities: { streaming: false },
  provider: { organization: 'OpenClaw', url: 'https://openclaw.example.dev' },
};

export const UNKNOWN_FIXTURE_CARD: A2AAgentCard = {
  name: 'Nebula Analyst',
  description: 'Unknown-brand analyst agent used for custom fallback.',
  version: '1.0.0',
  supportedInterfaces: [
    { url: 'https://nebula.example.dev/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
  ],
  capabilities: {},
  provider: { organization: 'Nebula Cooperative', url: 'https://nebula.example.dev' },
};
