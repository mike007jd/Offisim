/**
 * useOpenClaw — manages OpenClaw gateway connection and lobster agent lifecycle.
 *
 * Persists gateway config and invited agent IDs to localStorage.
 * Emits standard employee.installed / employee.deleted events so the
 * scene views react to these events and update accordingly.
 *
 * The actual OpenClawClient is mocked until the client package is available.
 */

import { employeeDeleted, employeeInstalled } from '@aics/core/browser';
import type { OpenClawAgent, OpenClawConfig, ConnectionState } from '@aics/core/browser';
import { useCallback, useState } from 'react';
import { useAicsRuntime } from '../runtime/aics-runtime-context.js';
import { useCompany } from '../components/company/CompanyContext.js';

// ---------------------------------------------------------------------------
// Re-export core types that consumers of this hook may need
// ---------------------------------------------------------------------------

export type { OpenClawAgent, OpenClawConfig };

/** Subset of ConnectionState values relevant to the hook's UI surface.
 *  'authenticating' is included to match the full core ConnectionState. */
export type OpenClawConnectionState = ConnectionState;

export interface OpenClawGatewayInfo {
  version: string;
  uptime: string;
  agentCount: number;
}

// ---------------------------------------------------------------------------
// localStorage keys
// ---------------------------------------------------------------------------

const STORAGE_KEY_CONFIG = 'offisim.openclaw.config';
const STORAGE_KEY_INVITED = 'offisim.openclaw.invited';

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function loadConfig(): Pick<OpenClawConfig, 'url' | 'token'> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.url === 'string' && typeof parsed?.token === 'string') {
      return { url: parsed.url as string, token: parsed.token as string };
    }
    return null;
  } catch {
    return null;
  }
}

function saveConfig(cfg: Pick<OpenClawConfig, 'url' | 'token'>): void {
  localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(cfg));
}

function clearConfig(): void {
  localStorage.removeItem(STORAGE_KEY_CONFIG);
}

function loadInvitedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_INVITED);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed as string[]);
    return new Set();
  } catch {
    return new Set();
  }
}

function saveInvitedIds(ids: Set<string>): void {
  localStorage.setItem(STORAGE_KEY_INVITED, JSON.stringify([...ids]));
}

// ---------------------------------------------------------------------------
// Mock client — replace with real OpenClawClient import when available
// ---------------------------------------------------------------------------

const MOCK_AGENTS: OpenClawAgent[] = [
  {
    id: 'oc-1',
    name: 'CodeReviewer',
    description: 'Reviews code and suggests improvements',
    status: 'online',
    model: 'claude-3.5-sonnet',
    skills: ['code-review', 'refactoring'],
  },
  {
    id: 'oc-2',
    name: 'Translator',
    description: 'Translates documents between languages',
    status: 'online',
    model: 'gpt-4o',
    skills: ['translation', 'localization'],
  },
  {
    id: 'oc-3',
    name: 'DataAnalyst',
    description: 'Analyzes data and creates reports',
    status: 'offline',
    model: 'claude-3-haiku',
    skills: ['data-analysis', 'visualization'],
  },
];

const MOCK_GATEWAY_INFO: OpenClawGatewayInfo = {
  version: '0.9.0-mock',
  uptime: '2h 14m',
  agentCount: MOCK_AGENTS.length,
};

async function mockConnect(_url: string, _token: string): Promise<void> {
  // Simulate network delay
  await new Promise<void>((resolve) => setTimeout(resolve, 800));
  // Always succeeds in mock mode; throw to simulate error states
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useOpenClaw() {
  const { eventBus } = useAicsRuntime();
  const { activeCompanyId } = useCompany();

  const [config, setConfigState] = useState<Pick<OpenClawConfig, 'url' | 'token'> | null>(loadConfig);
  const [connectionState, setConnectionState] = useState<OpenClawConnectionState>('disconnected');
  const [agents, setAgents] = useState<OpenClawAgent[]>([]);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(loadInvitedIds);
  const [error, setError] = useState<string | null>(null);
  const [gatewayInfo, setGatewayInfo] = useState<OpenClawGatewayInfo | null>(null);

  const connect = useCallback(
    async (url: string, token: string) => {
      setConnectionState('connecting');
      setError(null);
      try {
        await mockConnect(url, token);
        const cfg: Pick<OpenClawConfig, 'url' | 'token'> = { url, token };
        saveConfig(cfg);
        setConfigState(cfg);
        setAgents(MOCK_AGENTS);
        setGatewayInfo(MOCK_GATEWAY_INFO);
        setConnectionState('connected');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setConnectionState('error');
      }
    },
    [],
  );

  const disconnect = useCallback(() => {
    clearConfig();
    setConfigState(null);
    setAgents([]);
    setGatewayInfo(null);
    setConnectionState('disconnected');
    setError(null);
  }, []);

  const inviteAgent = useCallback(
    (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) return;

      setInvitedIds((prev) => {
        const next = new Set(prev);
        next.add(agentId);
        saveInvitedIds(next);
        return next;
      });

      // Emit employee.installed so scene views add a lobster puppet
      eventBus.emit(
        employeeInstalled(
          activeCompanyId!,
          agentId,
          agent.name,
          `openclaw-invite-${Date.now()}`,
          `openclaw.${agentId}`,
        ),
      );
    },
    [agents, eventBus, activeCompanyId],
  );

  const removeAgent = useCallback(
    (agentId: string) => {
      setInvitedIds((prev) => {
        const next = new Set(prev);
        next.delete(agentId);
        saveInvitedIds(next);
        return next;
      });

      // Emit employee.deleted so scene views remove the lobster puppet
      eventBus.emit(employeeDeleted(activeCompanyId!, agentId));
    },
    [eventBus, activeCompanyId],
  );

  return {
    config,
    connectionState,
    agents,
    invitedIds,
    error,
    gatewayInfo,
    connect,
    disconnect,
    inviteAgent,
    removeAgent,
  };
}
