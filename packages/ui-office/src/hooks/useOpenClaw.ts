/**
 * useOpenClaw — manages OpenClaw gateway connection and lobster agent lifecycle.
 *
 * Persists gateway config and invited agent IDs to localStorage.
 * Emits standard employee.installed / employee.deleted events so the
 * renderer SceneManager adds/removes lobster puppets automatically.
 *
 * The actual OpenClawClient is mocked until the client package is available.
 */

import { employeeDeleted, employeeInstalled } from '@aics/core/browser';
import { useCallback, useState } from 'react';
import { useAicsRuntime } from '../runtime/aics-runtime-context.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenClawAgent {
  id: string;
  name: string;
  description: string;
  status: 'online' | 'offline';
  model: string;
  skills: string[];
}

export interface OpenClawConfig {
  url: string;
  token: string;
}

export type OpenClawConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

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
const COMPANY_ID = 'company-001';

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

function loadConfig(): OpenClawConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.url === 'string' && typeof parsed?.token === 'string') {
      return parsed as OpenClawConfig;
    }
    return null;
  } catch {
    return null;
  }
}

function saveConfig(cfg: OpenClawConfig): void {
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

  const [config, setConfigState] = useState<OpenClawConfig | null>(loadConfig);
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
        const cfg: OpenClawConfig = { url, token };
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

      // Emit employee.installed so SceneManager adds a lobster puppet
      eventBus.emit(
        employeeInstalled(
          COMPANY_ID,
          agentId,
          agent.name,
          `openclaw-invite-${Date.now()}`,
          `openclaw.${agentId}`,
        ),
      );
    },
    [agents, eventBus],
  );

  const removeAgent = useCallback(
    (agentId: string) => {
      setInvitedIds((prev) => {
        const next = new Set(prev);
        next.delete(agentId);
        saveInvitedIds(next);
        return next;
      });

      // Emit employee.deleted so SceneManager removes the lobster puppet
      eventBus.emit(employeeDeleted(COMPANY_ID, agentId));
    },
    [eventBus],
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
