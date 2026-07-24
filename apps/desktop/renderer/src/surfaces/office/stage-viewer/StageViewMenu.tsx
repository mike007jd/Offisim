import { useUiState } from '@/app/ui-state.js';
import { useActiveConversationRuns } from '@/assistant/runtime/conversation-run-react.js';
import { workbenchOf } from '@/data/git-workbench.js';
import { useDeliverables, useEmployees, useGitWorkbench } from '@/data/queries.js';
import type { Deliverable } from '@/data/types.js';
import { CapsLabel } from '@/design-system/grammar/CapsLabel.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/design-system/primitives/popover.js';
import { cn } from '@/lib/utils.js';
import { useCodexPet } from '@/surfaces/office/scene/office-companion/CodexPetProvider.js';
import { useAgentBrowserSessions } from '@/surfaces/office/stage-browser/use-agent-browser-sessions.js';
import type { DramaturgyMode, ToolRichDetail } from '@offisim/shared-types';
import {
  Clapperboard,
  Eye,
  EyeOff,
  FileCode2,
  FileText,
  Focus,
  GitCompareArrows,
  Globe,
  MonitorSmartphone,
  PawPrint,
  Plus,
  SlidersHorizontal,
  TerminalSquare,
  Users,
} from 'lucide-react';
import { useState } from 'react';

interface StageMenuItem {
  id: string;
  label: string;
  meta: string;
  isActive?: boolean;
  icon: typeof FileCode2;
  onSelect: () => void;
}

function latestBrowserDetail(
  activity: readonly { id: string; tool: string; richDetail?: ToolRichDetail }[],
) {
  return [...activity].reverse().find((entry) => entry.richDetail?.family === 'browser') ?? null;
}

function latestRichDetail(
  activity: readonly { id: string; tool: string; richDetail?: ToolRichDetail }[],
) {
  return [...activity].reverse().find((entry) => entry.richDetail) ?? null;
}

function newestDeliverable(deliverables: readonly Deliverable[]) {
  return deliverables[0] ?? null;
}

function htmlDeliverable(deliverables: readonly Deliverable[]) {
  return deliverables.find((d) => d.format?.toUpperCase() === 'HTML') ?? null;
}

export function GameViewOptions() {
  const officeMode = useUiState((s) => s.officeMode);
  const setOfficeMode = useUiState((s) => s.setOfficeMode);
  const companionEnabled = useUiState((s) => s.officeCompanionEnabled);
  const setCompanionEnabled = useUiState((s) => s.setOfficeCompanionEnabled);
  const openSettings = useUiState((s) => s.openSettings);
  const { catalog, selectedPet } = useCodexPet();
  const [open, setOpen] = useState(false);
  const options = [
    { mode: 'focus', icon: Focus, label: 'Focus' },
    { mode: 'office', icon: Users, label: 'Office' },
    { mode: 'cinematic', icon: Clapperboard, label: 'Cinematic' },
  ] as ReadonlyArray<{ mode: DramaturgyMode; icon: typeof Focus; label: string }>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="off-stage-view-options-btn off-focusable"
          aria-label="View options"
          title="View options"
        >
          <Icon icon={SlidersHorizontal} size="sm" />
          <span>View options</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="off-stage-view-pop is-compact" align="start">
        <div className="off-stage-view-pop-head">
          <CapsLabel>Game view</CapsLabel>
        </div>
        <div className="off-stage-view-options">
          {options.map((option) => (
            <button
              key={option.mode}
              type="button"
              className={cn(
                'off-stage-view-option off-focusable',
                officeMode === option.mode && 'is-active',
              )}
              onClick={() => {
                setOfficeMode(option.mode);
                setOpen(false);
              }}
            >
              <Icon icon={option.icon} size="sm" />
              <span className="off-stage-view-option-copy">
                <span className="off-stage-view-option-label">{option.label}</span>
                <span className="off-stage-view-option-meta">Game presentation</span>
              </span>
            </button>
          ))}
          <button
            type="button"
            className={cn('off-stage-view-option off-focusable', companionEnabled && 'is-active')}
            aria-pressed={companionEnabled}
            onClick={() => setCompanionEnabled(!companionEnabled)}
          >
            <Icon icon={companionEnabled ? PawPrint : EyeOff} size="sm" />
            <span className="off-stage-view-option-copy">
              <span className="off-stage-view-option-label">Show Codex pet</span>
              <span className="off-stage-view-option-meta">
                {selectedPet?.displayName ?? 'No local Codex pet'}
              </span>
            </span>
          </button>
          <button
            type="button"
            className="off-stage-view-option off-focusable"
            onClick={() => {
              openSettings('companion');
              setOpen(false);
            }}
          >
            <Icon icon={PawPrint} size="sm" />
            <span className="off-stage-view-option-copy">
              <span className="off-stage-view-option-label">Choose pet</span>
              <span className="off-stage-view-option-meta">
                {catalog ? `${catalog.pets.length} synced from Codex` : 'Syncing local catalog…'}
              </span>
            </span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function StageViewMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const draftThreadId = useUiState((s) => s.draftThread?.id ?? null);
  const projectId = useUiState((s) => s.projectId);
  const companyId = useUiState((s) => s.companyId);
  const stageView = useUiState((s) => s.stageView);
  const stagePrimaryTab = useUiState((s) => s.stagePrimaryTab);
  const setStagePrimaryTab = useUiState((s) => s.setStagePrimaryTab);
  const openStageView = useUiState((s) => s.openStageView);
  const persistedSessionThreadId = selectedThreadId === draftThreadId ? null : selectedThreadId;
  const browserScope =
    companyId && projectId && persistedSessionThreadId
      ? { companyId, projectId, threadId: persistedSessionThreadId }
      : null;
  const agentBrowserSessions = useAgentBrowserSessions(browserScope);
  const deliverables = useDeliverables(selectedThreadId);
  const git = useGitWorkbench(projectId);
  const employees = useEmployees();
  const runs = useActiveConversationRuns();
  const run = runs.runs.find((candidate) => candidate.threadId === selectedThreadId) ?? null;
  const employeeName = run?.employeeId
    ? (employees.data?.find((employee) => employee.id === run.employeeId)?.name ?? run.employeeId)
    : 'Employee';
  const latestBrowser = run ? latestBrowserDetail(run.activity) : null;
  const latestBrowserRichDetail =
    latestBrowser?.richDetail?.family === 'browser' ? latestBrowser.richDetail : null;
  const latestLog = run ? latestRichDetail(run.activity) : null;
  const latestOutput = newestDeliverable(deliverables.data ?? []);
  const latestHtmlOutput = htmlDeliverable(deliverables.data ?? []);
  const gitChanges = workbenchOf(git.data)?.changes ?? [];
  const latestChange = gitChanges[0] ?? null;
  const selectedFile =
    stageView.kind === 'preview' && stageView.ref.source === 'workspace-file'
      ? { target: stageView, path: stageView.ref.path }
      : null;
  const agentBrowserItems: StageMenuItem[] = agentBrowserSessions.map((session) => ({
    id: `agent-browser-${session.sessionId}`,
    label: `${employeeName}'s Browser`,
    meta: 'Employee is browsing · Read-only spectator',
    isActive: stageView.kind === 'browser-session' && stageView.sessionId === session.sessionId,
    icon: Globe,
    onSelect: () => {
      if (!browserScope) return;
      openStageView({
        kind: 'browser-session',
        sessionId: session.sessionId,
        scope: browserScope,
        initialUrl: session.url,
        title: `${employeeName} · Browser`,
        agent: { employeeName },
      });
    },
  }));

  const items: StageMenuItem[] = [
    {
      id: 'output',
      label: 'Output',
      meta: latestOutput
        ? `${latestOutput.name} · ${latestOutput.format ?? 'TXT'}`
        : 'Open the output guide',
      isActive:
        stageView.kind === 'preview' &&
        stageView.ref.source === 'deliverable' &&
        stageView.ref.deliverableId === latestOutput?.id,
      icon: FileCode2,
      onSelect: () => {
        if (!latestOutput) {
          setStagePrimaryTab('preview', true);
          return;
        }
        openStageView({
          kind: 'preview',
          ref: {
            source: 'deliverable',
            deliverableId: latestOutput.id,
            threadId: selectedThreadId,
            format: latestOutput.format ?? undefined,
            name: latestOutput.name,
          },
          title: latestOutput.name,
        });
      },
    },
    ...agentBrowserItems,
    {
      id: 'browser',
      label: agentBrowserItems.length ? 'New Browser' : 'Browser',
      meta: 'Navigate the web in Stage',
      isActive: stageView.kind === 'browser-session' && !stageView.agent,
      icon: Globe,
      onSelect: () => {
        if (!companyId || !projectId) return;
        openStageView({
          kind: 'browser-session',
          sessionId: crypto.randomUUID(),
          scope: { companyId, projectId, threadId: persistedSessionThreadId },
          initialUrl: 'https://example.com/',
          title: 'Browser',
        });
      },
    },
    {
      id: 'browser-activity',
      label: 'Browser activity',
      meta: latestBrowserRichDetail
        ? latestBrowserRichDetail.title ||
          latestBrowserRichDetail.url ||
          latestBrowser?.tool ||
          'Agent browser page'
        : 'Open the read-only agent preview',
      isActive:
        stageView.kind === 'preview' &&
        (stageView.ref.source === 'browser' || stageView.ref.source === 'screenshot'),
      icon: Eye,
      onSelect: () => {
        if (!latestBrowserRichDetail) {
          openStageView({
            kind: 'preview',
            ref: { source: 'browser', sourceId: 'agent-latest' },
            title: 'Browser activity',
          });
          return;
        }
        openStageView({
          kind: 'preview',
          ref: {
            source: 'browser',
            sourceId: latestBrowser?.id,
            url: latestBrowserRichDetail.url,
            detail: latestBrowserRichDetail,
          },
          title: latestBrowserRichDetail.title ?? latestBrowser?.tool,
        });
      },
    },
    {
      id: 'preview',
      label: 'Preview',
      meta: latestHtmlOutput ? latestHtmlOutput.name : 'Open the preview guide',
      // Only owns the highlight when it points at a DIFFERENT deliverable than
      // Output (i.e. an older HTML output); when the newest output is itself the
      // HTML one, Output owns the highlight so the two entries never both light up.
      isActive:
        stageView.kind === 'preview' &&
        stageView.ref.source === 'deliverable' &&
        stageView.ref.deliverableId === latestHtmlOutput?.id &&
        latestHtmlOutput?.id !== latestOutput?.id,
      icon: Eye,
      onSelect: () => {
        if (!latestHtmlOutput) {
          setStagePrimaryTab('preview', true);
          return;
        }
        openStageView({
          kind: 'preview',
          ref: {
            source: 'deliverable',
            deliverableId: latestHtmlOutput.id,
            threadId: selectedThreadId,
            format: latestHtmlOutput.format ?? undefined,
            name: latestHtmlOutput.name,
          },
          title: latestHtmlOutput.name,
        });
      },
    },
    {
      id: 'changes',
      label: 'Review',
      meta: latestChange
        ? `${gitChanges.length} changed · ${latestChange.path}`
        : 'Open the review guide',
      isActive: stageView.kind === 'changes',
      icon: GitCompareArrows,
      onSelect: () => {
        if (!latestChange) {
          setStagePrimaryTab('review', true);
          return;
        }
        openStageView({ kind: 'changes', path: latestChange.path });
      },
    },
    {
      id: 'terminal',
      label: 'Terminal',
      meta: 'Interactive project shell',
      isActive: stageView.kind === 'terminal-session',
      icon: TerminalSquare,
      onSelect: () => {
        if (!companyId || !projectId) return;
        openStageView({
          kind: 'terminal-session',
          sessionId: crypto.randomUUID(),
          scope: { companyId, projectId, threadId: persistedSessionThreadId },
          title: 'Terminal',
        });
      },
    },
    {
      id: 'logs',
      label: 'Run log',
      meta: latestLog ? latestLog.tool : 'Open the read-only agent run mirror',
      isActive: stageView.kind === 'logs',
      icon: FileText,
      onSelect: () => {
        if (!latestLog) {
          setStagePrimaryTab('terminal', true);
          return;
        }
        openStageView({
          kind: 'logs',
          sourceId: latestLog.id,
          title: latestLog.tool,
          tool: latestLog.tool,
          detail: latestLog.richDetail,
        });
      },
    },
    {
      id: 'files',
      label: 'Files',
      meta: selectedFile ? selectedFile.path : 'Open the file preview guide',
      isActive: Boolean(selectedFile),
      icon: FileText,
      onSelect: () => {
        if (selectedFile) {
          openStageView(selectedFile.target);
          return;
        }
        setStagePrimaryTab('preview', true);
      },
    },
    {
      id: 'computer',
      label: 'Computer',
      meta: selectedThreadId ? 'Open Computer Use activity' : 'Open the Computer Use guide',
      isActive: stageView.kind === 'computer',
      icon: MonitorSmartphone,
      onSelect: () => openStageView({ kind: 'computer', threadId: selectedThreadId }),
    },
  ];

  return (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'off-stage-view-trigger off-focusable',
            stagePrimaryTab !== 'game' && 'is-on',
          )}
          title="Open view"
          aria-label="Open view"
        >
          <Icon icon={Plus} size="sm" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="off-stage-view-pop" align="start">
        <div className="off-stage-view-pop-head">
          <CapsLabel>Open view</CapsLabel>
        </div>
        <div className="off-stage-view-options">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn('off-stage-view-option off-focusable', item.isActive && 'is-active')}
              onClick={() => {
                item.onSelect();
                setMenuOpen(false);
              }}
            >
              <Icon icon={item.icon} size="sm" />
              <span className="off-stage-view-option-copy">
                <span className="off-stage-view-option-label">{item.label}</span>
                <span className="off-stage-view-option-meta">{item.meta}</span>
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
