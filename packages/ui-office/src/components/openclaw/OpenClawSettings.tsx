/**
 * OpenClawSettings — gateway connection panel for the Settings dialog.
 *
 * Lets the user enter a gateway URL + token, connect/disconnect, and see
 * basic gateway info when connected. Config is persisted via useOpenClaw.
 */

import { Button, Card, CardContent, CardHeader, CardTitle, Input } from '@offisim/ui-core';
import { useCallback, useEffect, useState } from 'react';
import { useOpenClaw } from '../../hooks/useOpenClaw.js';
import { LobsterInvitePanel } from './LobsterInvitePanel.js';

interface OpenClawSettingsProps {
  onConnectionChange?: (connected: boolean) => void;
}

// Status dot colours
const STATUS_DOT: Record<string, string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-yellow-500 animate-pulse',
  error: 'bg-red-500',
  disconnected: 'bg-slate-500',
};

const STATUS_LABEL: Record<string, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  error: 'Error',
  disconnected: 'Disconnected',
};

export function OpenClawSettings({ onConnectionChange }: OpenClawSettingsProps) {
  const {
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
  } = useOpenClaw();

  const [urlInput, setUrlInput] = useState(config?.url ?? 'ws://127.0.0.1:18789');
  const [tokenInput, setTokenInput] = useState(config?.token ?? '');

  const isConnected = connectionState === 'connected';
  const isConnecting = connectionState === 'connecting';

  // Sync URL input when config loaded from storage
  useEffect(() => {
    if (config?.url) setUrlInput(config.url);
    if (config?.token) setTokenInput(config.token);
  }, [config?.url, config?.token]);

  // Notify parent when connection state changes
  useEffect(() => {
    onConnectionChange?.(isConnected);
  }, [isConnected, onConnectionChange]);

  const handleConnect = useCallback(() => {
    const url = urlInput.trim();
    const token = tokenInput.trim();
    if (!url) return;
    void connect(url, token);
  }, [urlInput, tokenInput, connect]);

  const handleDisconnect = useCallback(() => {
    disconnect();
  }, [disconnect]);

  return (
    <div className="flex flex-col gap-4">
      {/* Connection section */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Gateway Connection</CardTitle>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${STATUS_DOT[connectionState]}`} />
              <span className="text-xs text-slate-400">{STATUS_LABEL[connectionState]}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div>
            <label htmlFor="oc-gateway-url" className="text-xs text-slate-400 mb-1 block">
              Gateway URL
            </label>
            <Input
              id="oc-gateway-url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="ws://127.0.0.1:18789"
              disabled={isConnected || isConnecting}
              className="h-8 text-sm font-mono"
            />
          </div>

          <div>
            <label htmlFor="oc-token" className="text-xs text-slate-400 mb-1 block">
              Token
            </label>
            <Input
              id="oc-token"
              type="password"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Optional auth token"
              disabled={isConnected || isConnecting}
              className="h-8 text-sm"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5">
              {error}
            </p>
          )}

          <div className="flex justify-end">
            {isConnected ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
              >
                Disconnect
              </Button>
            ) : (
              <Button size="sm" onClick={handleConnect} disabled={isConnecting || !urlInput.trim()}>
                {isConnecting ? 'Connecting…' : 'Connect'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Gateway info — only when connected */}
      {isConnected && gatewayInfo && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Gateway Info</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-slate-500">Version</dt>
              <dd className="text-slate-300 font-mono">{gatewayInfo.version}</dd>
              <dt className="text-slate-500">Uptime</dt>
              <dd className="text-slate-300">{gatewayInfo.uptime}</dd>
              <dt className="text-slate-500">Agents</dt>
              <dd className="text-slate-300">{gatewayInfo.agentCount}</dd>
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Invite panel */}
      <LobsterInvitePanel
        agents={agents}
        invitedIds={invitedIds}
        onInvite={inviteAgent}
        onRemove={removeAgent}
      />
    </div>
  );
}
