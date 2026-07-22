import { useUiState } from '@/app/ui-state.js';
import {
  useDeliverables,
  useEmployeeMcpTools,
  useEmployeeSkills,
  useGitWorkbench,
  useProjectFiles,
  useProjects,
} from '@/data/queries.js';
import { queryKeys } from '@/data/query-keys.js';
import { loadComputerDriverStatus } from '@/surfaces/office/computer/computer-status.js';
import { useEmployeeMemories } from '@/surfaces/personnel/personnel-data.js';
import {
  CUA_DRIVER_MCP_PRESET,
  type McpServer,
  useMcpServers,
} from '@/surfaces/settings/settings-data.js';
import { useQuery } from '@tanstack/react-query';
import {
  Brain,
  FolderOpen,
  GitBranch,
  Globe,
  type LucideIcon,
  MonitorSmartphone,
  Package,
  Plug,
  Puzzle,
  SquareTerminal,
} from 'lucide-react';
import { useMemo } from 'react';

/**
 * Per-thread capability manifest. Turns "what tools/capabilities do I have?"
 * into a real, machine-readable answer resolved from the SAME sources the rest
 * of the desktop already uses — MCP grants + server health, the Computer Use
 * driver, the bound project workspace, skills/memory, thread outputs, and the
 * git repo state — instead of an apology.
 *
 * READ-ONLY by contract: every entry either reports a positive status or routes
 * the user to the real setup surface (Settings section, Personnel, or the Office
 * workspace panel). It never grants, connects, initializes, or executes; the
 * mutating actions stay in their owning surfaces.
 */
export type CapabilityStatus = 'available' | 'needs-setup' | 'disabled' | 'unavailable';

/** Where a capability physically comes from, shown as a source label per row. */
type CapabilitySource = 'Project' | 'MCP grant' | 'Workspace' | 'Settings';

interface CapabilitySetup {
  /** Action-oriented label, e.g. "Open Settings › MCP". */
  readonly label: string;
  /** Routes to the owning setup surface. Never performs the mutation itself. */
  readonly action: () => void;
}

export interface ThreadCapability {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly status: CapabilityStatus;
  readonly source: CapabilitySource;
  /** One short status line: the current state, count, or missing reason. */
  readonly detail: string;
  /** Present only when the capability is not fully available. */
  readonly setup?: CapabilitySetup;
}

const BROWSER_TOOL_HINT = /browser|navigate|playwright|chromium|\bpage[_-]|screenshot/i;

/** Detect a first-class browser tool from connected MCP servers. Browser is a
 *  distinct capability from Computer Use, so computer-use drivers are excluded.
 *  A conservative signal (server connected + a browser-shaped tool name) — a
 *  miss falls back to the honest needs-setup state, never a false positive. */
function detectBrowserServer(servers: readonly McpServer[]): McpServer | null {
  return (
    servers.find(
      (server) =>
        server.status === 'connected' &&
        server.category !== 'computer-use' &&
        server.tools.some((tool) => BROWSER_TOOL_HINT.test(tool.name)),
    ) ?? null
  );
}

function findComputerServer(servers: readonly McpServer[]): McpServer | null {
  return (
    servers.find((server) => server.category === 'computer-use') ??
    servers.find((server) => server.name === CUA_DRIVER_MCP_PRESET.name) ??
    null
  );
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

/** The thread's acting employee (null for a whole-team thread) plus its id are
 *  all the manifest needs; company/project scope come from the UI store. */
export function useThreadCapabilities(
  threadId: string | null,
  employeeId: string | null,
): ThreadCapability[] {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const openSettings = useUiState((s) => s.openSettings);
  const setSurface = useUiState((s) => s.setSurface);
  const selectEmployee = useUiState((s) => s.selectEmployee);
  const setLeftRailCollapsed = useUiState((s) => s.setOfficeLeftRailCollapsed);

  const mcpTools = useEmployeeMcpTools(employeeId);
  const mcpServers = useMcpServers();
  const projects = useProjects(companyId);
  const projectFiles = useProjectFiles(projectId);
  const skills = useEmployeeSkills(employeeId);
  const memories = useEmployeeMemories(employeeId);
  const deliverables = useDeliverables(threadId);
  const git = useGitWorkbench(projectId);
  const computerStatus = useQuery({
    queryKey: queryKeys.computerDriverStatus(),
    queryFn: loadComputerDriverStatus,
  });

  const activeProject = projects.data?.find((p) => p.id === projectId) ?? null;
  const workspaceRoot = activeProject?.workspaceRoot ?? null;
  const workspaceBound = Boolean(workspaceRoot?.trim());

  return useMemo(() => {
    const servers = mcpServers.data ?? [];

    /** Reveal the Office left rail, where the workspace / git / bind flow lives. */
    const revealWorkspacePanel = () => {
      setSurface('office');
      setLeftRailCollapsed(false);
    };
    const openPersonnelForEmployee = () => {
      if (employeeId) selectEmployee(employeeId);
      setSurface('personnel');
    };

    const capabilities: ThreadCapability[] = [];

    // ── MCP tools ────────────────────────────────────────────────────────────
    const grantedTools = mcpTools.data ?? [];
    const grantedServerCount = new Set(grantedTools.map((tool) => tool.serverName)).size;
    if (grantedTools.length > 0) {
      capabilities.push({
        id: 'mcp',
        label: 'MCP tools',
        icon: Plug,
        status: 'available',
        source: 'MCP grant',
        detail: `${plural(grantedTools.length, 'tool')} across ${plural(grantedServerCount, 'server')}`,
      });
    } else {
      const connectedServers = servers.filter((server) => server.status === 'connected').length;
      const detail = !employeeId
        ? 'Tool grants are per employee — open a direct thread to inspect them'
        : connectedServers > 0
          ? `${plural(connectedServers, 'server')} connected · no tools granted to this teammate`
          : servers.length > 0
            ? `${plural(servers.length, 'server')} registered · none connected`
            : 'No MCP server connected';
      capabilities.push({
        id: 'mcp',
        label: 'MCP tools',
        icon: Plug,
        status: 'needs-setup',
        source: 'MCP grant',
        detail,
        setup: { label: 'Open Settings › MCP', action: () => openSettings('mcp') },
      });
    }

    // ── Browser ──────────────────────────────────────────────────────────────
    const browserServer = detectBrowserServer(servers);
    if (browserServer) {
      capabilities.push({
        id: 'browser',
        label: 'Browser',
        icon: Globe,
        status: 'available',
        source: 'MCP grant',
        detail: `Rendered-page control via ${browserServer.name}`,
      });
    } else {
      capabilities.push({
        id: 'browser',
        label: 'Browser',
        icon: Globe,
        status: 'needs-setup',
        source: 'MCP grant',
        detail: 'Connect a browser tool to open, inspect, and verify web pages',
        setup: { label: 'Open Settings › MCP', action: () => openSettings('mcp') },
      });
    }

    // ── Computer Use ───────────────────────────────────────────────────────────
    const computerServer = findComputerServer(servers);
    const driver = computerStatus.data;
    const computerReady = Boolean(driver?.daemonRunning && computerServer?.status === 'connected');
    if (computerReady) {
      capabilities.push({
        id: 'computer',
        label: 'Computer Use',
        icon: MonitorSmartphone,
        status: 'available',
        source: 'Settings',
        detail: 'Desktop driver connected',
      });
    } else {
      const detail = !driver
        ? 'Checking driver status'
        : !driver.installed
          ? 'Desktop driver not installed'
          : !driver.daemonRunning
            ? 'Desktop driver not running'
            : !computerServer
              ? 'Driver not linked to Offisim'
              : 'Driver link disconnected';
      capabilities.push({
        id: 'computer',
        label: 'Computer Use',
        icon: MonitorSmartphone,
        status: 'needs-setup',
        source: 'Settings',
        detail,
        setup: { label: 'Open Settings › Computer Use', action: () => openSettings('computer') },
      });
    }

    // ── Project files ──────────────────────────────────────────────────────────
    if (workspaceBound) {
      const fileCount = projectFiles.data?.length ?? 0;
      capabilities.push({
        id: 'files',
        label: 'Project files',
        icon: FolderOpen,
        status: 'available',
        source: 'Project',
        detail:
          fileCount > 0 ? `${plural(fileCount, 'item')} in Project folder` : 'Project folder ready',
      });
    } else {
      capabilities.push({
        id: 'files',
        label: 'Project files',
        icon: FolderOpen,
        status: 'needs-setup',
        source: 'Project',
        detail: 'No Project folder chosen',
        setup: { label: 'Choose folder', action: revealWorkspacePanel },
      });
    }

    // ── Terminal ───────────────────────────────────────────────────────────────
    if (workspaceBound) {
      capabilities.push({
        id: 'terminal',
        label: 'Terminal',
        icon: SquareTerminal,
        status: 'available',
        source: 'Project',
        detail: 'Commands run in this Project folder',
      });
    } else {
      capabilities.push({
        id: 'terminal',
        label: 'Terminal',
        icon: SquareTerminal,
        status: 'needs-setup',
        source: 'Project',
        detail: 'Choose a Project folder to use Terminal',
        setup: { label: 'Choose folder', action: revealWorkspacePanel },
      });
    }

    // ── Skills ─────────────────────────────────────────────────────────────────
    const skillCount = skills.data?.length ?? 0;
    if (skillCount > 0) {
      capabilities.push({
        id: 'skills',
        label: 'Skills',
        icon: Puzzle,
        status: 'available',
        source: 'Workspace',
        detail: plural(skillCount, 'skill'),
      });
    } else {
      capabilities.push({
        id: 'skills',
        label: 'Skills',
        icon: Puzzle,
        status: 'needs-setup',
        source: 'Workspace',
        detail: employeeId
          ? 'No skills assigned to this teammate'
          : 'Skills are per employee — open a direct thread to inspect them',
        setup: { label: 'Manage in Personnel', action: openPersonnelForEmployee },
      });
    }

    // ── Memory ─────────────────────────────────────────────────────────────────
    if (employeeId) {
      const memoryCount = memories.data?.length ?? 0;
      capabilities.push({
        id: 'memory',
        label: 'Memory',
        icon: Brain,
        status: 'available',
        source: 'Workspace',
        detail:
          memoryCount > 0
            ? `${plural(memoryCount, 'entry')} of operational memory`
            : 'Operational memory ready — no entries yet',
      });
    } else {
      capabilities.push({
        id: 'memory',
        label: 'Memory',
        icon: Brain,
        status: 'unavailable',
        source: 'Workspace',
        detail: 'Operational memory is per employee — open a direct thread',
      });
    }

    // ── Outputs ────────────────────────────────────────────────────────────────
    const outputCount = deliverables.data?.length ?? 0;
    capabilities.push({
      id: 'outputs',
      label: 'Outputs',
      icon: Package,
      status: 'available',
      source: 'Workspace',
      detail:
        outputCount > 0
          ? `${plural(outputCount, 'artifact')} in this thread`
          : 'Run artifacts land here as they are produced',
    });

    // ── Review / Git ───────────────────────────────────────────────────────────
    const gitState = git.data;
    if (gitState?.status === 'repo') {
      const changes = gitState.workbench.changes.length;
      capabilities.push({
        id: 'git',
        label: 'Review & Git',
        icon: GitBranch,
        status: 'available',
        source: 'Workspace',
        detail: `${gitState.workbench.branch} · ${changes === 0 ? 'clean tree' : plural(changes, 'change')}`,
      });
    } else {
      const detail =
        gitState?.status === 'uninitialized'
          ? 'Project folder is not a Git repository yet'
          : gitState?.status === 'invalid-folder'
            ? 'Project folder is missing or unavailable'
            : 'No Project folder chosen';
      const setupLabel =
        gitState?.status === 'uninitialized'
          ? 'Initialize in workspace panel'
          : gitState?.status === 'invalid-folder'
            ? 'Change folder'
            : 'Choose folder';
      capabilities.push({
        id: 'git',
        label: 'Review & Git',
        icon: GitBranch,
        status: 'needs-setup',
        source: 'Workspace',
        detail,
        setup: { label: setupLabel, action: revealWorkspacePanel },
      });
    }

    return capabilities;
  }, [
    mcpTools.data,
    mcpServers.data,
    computerStatus.data,
    projectFiles.data,
    skills.data,
    memories.data,
    deliverables.data,
    git.data,
    workspaceBound,
    employeeId,
    openSettings,
    setSurface,
    selectEmployee,
    setLeftRailCollapsed,
  ]);
}
