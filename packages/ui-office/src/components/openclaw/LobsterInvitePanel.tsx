/**
 * LobsterInvitePanel — lists available OpenClaw agents and lets the user
 * invite them into the Offisim office as lobster employees.
 *
 * Only shown in OpenClaw-related UI. Regular employee cards MUST NOT show
 * the "Powered by OpenClaw" badge.
 */

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@offisim/ui-core';
import { CheckCircle2 } from 'lucide-react';
import type { OpenClawAgent } from '../../hooks/useOpenClaw.js';

interface LobsterInvitePanelProps {
  agents: OpenClawAgent[];
  invitedIds: Set<string>;
  onInvite: (agentId: string) => void;
  onRemove: (agentId: string) => void;
}

export function LobsterInvitePanel({
  agents,
  invitedIds,
  onInvite,
  onRemove,
}: LobsterInvitePanelProps) {
  const isEmpty = agents.length === 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">Available Agents</CardTitle>
          {!isEmpty && (
            <span className="text-[10px] text-slate-500">
              {invitedIds.size}/{agents.length} invited
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="py-6 text-center">
            <p className="text-xs text-slate-500">Connect to OpenClaw to see available agents</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {agents.map((agent) => {
              const invited = invitedIds.has(agent.id);
              return (
                <li
                  key={agent.id}
                  className="flex items-start gap-3 border border-red-500/10 bg-red-500/[0.04] rounded px-3 py-2.5"
                >
                  {/* Status dot */}
                  <div className="mt-0.5 shrink-0">
                    <span
                      className={`block w-2 h-2 rounded-full ${
                        agent.status === 'online' ? 'bg-emerald-500' : 'bg-slate-600'
                      }`}
                    />
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium text-slate-200 truncate">
                        {agent.name}
                      </span>
                      {invited && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      )}
                      <Badge
                        variant={agent.status === 'online' ? 'success' : 'secondary'}
                        className="text-[10px] px-1.5 py-0 shrink-0"
                      >
                        {agent.status}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                      {agent.description ?? ''}
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] font-mono text-slate-500">
                        {agent.model ?? 'unknown'}
                      </span>
                      {agent.skills?.map((skill) => (
                        <span
                          key={skill}
                          className="text-[10px] bg-slate-800 text-slate-400 rounded px-1 py-0.5"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Action */}
                  <div className="shrink-0">
                    {invited ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRemove(agent.id)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-7 px-2 text-xs"
                      >
                        Remove
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => onInvite(agent.id)}
                        disabled={agent.status === 'offline'}
                        className="h-7 px-2 text-xs"
                      >
                        Invite
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Footer badge — only on lobster UI */}
        <div className="mt-3 pt-2 border-t border-white/5 flex justify-center">
          <span className="text-[10px] text-slate-500">Powered by OpenClaw 🦞</span>
        </div>
      </CardContent>
    </Card>
  );
}
