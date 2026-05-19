import type { InMemoryEventBus, RuntimeRepositories, SkillLoader } from '@offisim/core/browser';
import type { McpToolExecutor } from '@offisim/core/mcp';
import type { buildOffisimGraph, createRuntimeContext } from '@offisim/core/runtime';
import type { ResumeCoordinator, SessionCostTracker } from '@offisim/core/runtime';
import type {
  InteractionService,
  OrchestrationService,
  ToolTelemetryService,
  UserMemoryService,
} from '@offisim/core/services';
import type {
  AgentContextPackService,
  ConversationBudgetService,
  MemoryService,
} from '@offisim/core/services';
import type { InstallService } from '@offisim/install-core';
import type { AttachmentStore } from '@offisim/ui-office/web';
import type { VaultActivation } from './vault-activation';

export type RuntimeBundle = {
  eventBus: InMemoryEventBus;
  graph: ReturnType<typeof buildOffisimGraph>;
  runtimeCtx: ReturnType<typeof createRuntimeContext>;
  skillLoader: SkillLoader | null;
  orch: OrchestrationService | null;
  installService: InstallService | null;
  mcpToolExecutor: McpToolExecutor | null;
  repos: RuntimeRepositories;
  userMemoryService?: UserMemoryService;
  sessionCostTracker?: SessionCostTracker;
  toolTelemetryService?: ToolTelemetryService;
  interactionService?: InteractionService;
  packService?: AgentContextPackService;
  resumeCoordinator?: ResumeCoordinator;
  memoryService?: MemoryService;
  conversationBudgetService?: ConversationBudgetService;
  vaultActivation?: VaultActivation;
  desktopVaultRoot?: string | null;
  attachmentStore?: AttachmentStore;
  dispose?: () => void;
};
