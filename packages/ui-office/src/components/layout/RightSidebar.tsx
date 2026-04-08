import { Tabs, TabsContent, TabsList, TabsTrigger } from '@offisim/ui-core';
import { MessageSquare, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { STAGE_META, usePipelineStage } from '../../hooks/usePipelineStage';
import { useOffisimRuntimeStatus } from '../../runtime/offisim-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';
import { PitchHall } from '../pitch/PitchHall';
import { TaskDashboard } from '../plan/TaskDashboard';

interface RightSidebarProps {
  chatPanel: ReactNode;
  focusTasksToken?: number;
  requestChatToken?: number;
  /** Filter outputs to this thread only. Null shows all. */
  activeThreadId?: string | null;
}

export function RightSidebar({
  chatPanel,
  focusTasksToken,
  requestChatToken,
  activeThreadId,
}: RightSidebarProps) {
  const agents = useAgentStates();
  const stage = usePipelineStage();
  const { isRunning } = useOffisimRuntimeStatus();
  const [activeTab, setActiveTab] = useState<'chat' | 'tasks'>('chat');

  useEffect(() => {
    if (focusTasksToken) {
      setActiveTab('tasks');
    }
  }, [focusTasksToken]);

  useEffect(() => {
    if (requestChatToken) {
      setActiveTab('chat');
    }
  }, [requestChatToken]);

  const workflowLabel = useMemo(() => {
    if (!stage && !isRunning) return 'Ready';
    if (!stage && isRunning) return 'Starting workflow';
    const activeStage = stage ?? 'boss';
    return STAGE_META[activeStage].chatLabel;
  }, [stage, isRunning]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-white/5 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Workspace Rail</p>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-slate-400">
            {workflowLabel}
          </span>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'chat' | 'tasks')} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-white/5 px-2 pt-2">
          <TabsList className="flex w-full justify-start gap-1 overflow-x-auto rounded-none border-0 bg-transparent p-0 pb-2">
            <TabsTrigger
              value="chat"
              title="Chat"
              aria-label="Chat"
              className="h-auto min-w-fit shrink-0 gap-1.5 rounded-full border border-transparent px-3 py-2 text-[11px] text-slate-400 data-[state=active]:border-cyan-400/40 data-[state=active]:bg-cyan-400/10 data-[state=active]:text-cyan-100 hover:text-slate-200"
            >
              <MessageSquare className="h-4 w-4" />
              <span>Chat</span>
            </TabsTrigger>
            <TabsTrigger
              value="tasks"
              title="Tasks"
              aria-label="Tasks"
              data-onboarding-target="tasks-tab"
              className="h-auto min-w-fit shrink-0 gap-1.5 rounded-full border border-transparent px-3 py-2 text-[11px] text-slate-400 data-[state=active]:border-cyan-400/40 data-[state=active]:bg-cyan-400/10 data-[state=active]:text-cyan-100 hover:text-slate-200"
            >
              <Terminal className="h-4 w-4" />
              <span>Tasks</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent
          value="chat"
          forceMount
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{chatPanel}</div>
        </TabsContent>

        <TabsContent
          value="tasks"
          forceMount
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
              <TaskDashboard agents={agents} />
              <div className="border-t border-white/5 px-3 pb-3 pt-2">
                <div className="mb-2">
                  <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">
                    Deliverables
                  </p>
                </div>
                <PitchHall activeThreadId={activeThreadId} />
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
