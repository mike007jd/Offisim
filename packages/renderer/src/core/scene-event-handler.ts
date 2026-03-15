// ── Scene Event Handler ──────────────────────────────────────────────
// Encapsulates all EventBus subscriptions for the scene.
// Extracted from SceneManager to isolate event wiring from lifecycle management.

import type {
  EmployeeCreatedPayload,
  EmployeeDeletedPayload,
  EmployeeInstalledPayload,
  EmployeeStatePayload,
  EmployeeWorkstationChangedPayload,
  ErrorOccurredPayload,
  GraphNodeEnteredPayload,
  GraphNodeExitedPayload,
  LlmUsageRecordedPayload,
  McpToolCalledPayload,
  McpToolResultPayload,
  MeetingStatePayload,
  ReportStatePayload,
  TaskAssignmentPayload,
} from '@aics/shared-types';
import { STATE_COLORS } from '../tokens/colors.js';
import type { PerformanceTier } from '../tokens/motion.js';
import type { NodeVisualMapping, SceneEntity, SceneEventBus } from './types.js';

/**
 * Delegate interface — SceneManager implements this so the event handler
 * can call back into it without importing SceneManager (no circular deps).
 */
export interface SceneManagerDelegate {
  // Entity operations
  addEmployee(id: string, name: string, entityType: 'employee' | 'lobster', roleSlug?: string): boolean;
  removeEmployee(id: string): boolean;
  moveEntityToWorkstation(entityId: string, workstationId: string): void;

  // Entity lookup
  getEntity(id: string): SceneEntity | undefined;
  getAllEntities(): Map<string, SceneEntity>;

  // Interaction controller
  unregisterEntity(id: string): void;

  // Visual feedback
  requestAttention(entityId: string, priority: number): void;
  clearAttention(entityId: string): void;
  flashHighlightEntity(entity: SceneEntity, durationMs: number): void;
  showToolOverlay(employeeId: string, toolName: string): void;
  addRouteLine(id: string, fromEntity: SceneEntity, toEntity: SceneEntity, color: number): void;
  addMeetingRouteLines(participantIds: readonly string[], meetingZoneCx: number, meetingZoneCy: number, color: number): void;
  removeRouteLine(taskRunId: string): void;
  getMeetingZoneCenter(): { cx: number; cy: number } | null;
  getRouteOrigin(): SceneEntity | undefined;

  // Install ghost
  showInstallGhost(txnId: string): void;
  updateInstallGhostProgress(txnId: string, fraction: number): void;
  settleInstallGhost(txnId: string): void;
  failInstallGhost(txnId: string): void;

  // Selection
  selectEmployee(employeeId: string): void;
  setSelectedEmployeeId(id: string | null): void;

  // Performance
  setPerformanceTier(tier: PerformanceTier): void;

  // Rebuild
  scheduleRebuild(): void;
}

/**
 * Manages all EventBus subscriptions for the scene.
 * Calls back into the delegate (SceneManager) for actual scene mutations.
 */
export class SceneEventHandler {
  private unsubscribers: (() => void)[] = [];
  private readonly nodeActiveEmployees: Map<string, string> = new Map();
  private readonly nodeVisualMap: Record<string, NodeVisualMapping>;
  /** Accumulated token cost per employee (reset on task unassignment). */
  private readonly employeeCost: Map<string, number> = new Map();
  /** Accumulated reference count per employee (reset on task unassignment). */
  private readonly employeeRefs: Map<string, number> = new Map();

  constructor(
    private readonly eventBus: SceneEventBus,
    private readonly delegate: SceneManagerDelegate,
    nodeVisualMap: Record<string, NodeVisualMapping>,
  ) {
    this.nodeVisualMap = nodeVisualMap;
  }

  /** Subscribe to all relevant events. Call once after mount. */
  subscribeEvents(): void {
    this.unsubscribers.push(
      this.eventBus.on('employee.state.changed', (event) => {
        const { employeeId, next } = event.payload as EmployeeStatePayload;
        const entity = this.delegate.getEntity(employeeId);
        if (entity) {
          entity.setState(next);
          entity.setHighlight(next !== 'idle');
        }
        if (next === 'blocked' || next === 'failed') {
          this.delegate.requestAttention(employeeId, 5);
        } else if (next === 'idle' || next === 'success') {
          this.delegate.clearAttention(employeeId);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('task.assignment.changed', (event) => {
        const { employeeId, action, taskRunId } = event.payload as TaskAssignmentPayload;
        const entity = this.delegate.getEntity(employeeId);
        if (entity) {
          this.delegate.showToolOverlay(employeeId, ''); // clear timer
          entity.setTask(action === 'assigned' ? taskRunId : null);
        }
        if (action === 'assigned') {
          const fromEntity = this.delegate.getRouteOrigin();
          const toEntity = this.delegate.getEntity(employeeId);
          if (fromEntity && toEntity) {
            this.delegate.addRouteLine(taskRunId, fromEntity, toEntity, STATE_COLORS.assigned);
          }
        } else if (action === 'unassigned') {
          this.delegate.removeRouteLine(taskRunId);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('graph.node.entered', (event) => {
        const { nodeName } = event.payload as GraphNodeEnteredPayload;
        const mapping = this.nodeVisualMap[nodeName];
        if (mapping) {
          const entity = this.delegate.getEntity(mapping.employeeId);
          if (entity) {
            entity.setState(mapping.enterState);
            entity.setHighlight(true);
            this.nodeActiveEmployees.set(nodeName, mapping.employeeId);
          }
        } else {
          const match = this.findEmployeeForNode(nodeName);
          if (match) match.setHighlight(true);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('graph.node.exited', (event) => {
        const { nodeName } = event.payload as GraphNodeExitedPayload;
        const employeeId = this.nodeActiveEmployees.get(nodeName);
        if (employeeId) {
          const entity = this.delegate.getEntity(employeeId);
          if (entity) {
            entity.setState('idle');
            entity.setHighlight(false);
          }
          this.nodeActiveEmployees.delete(nodeName);
        } else {
          for (const entity of this.delegate.getAllEntities().values()) {
            entity.setHighlight(false);
          }
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('meeting.state.changed', (event) => {
        const { next, participantIds } = event.payload as MeetingStatePayload;
        if (next === 'gathering') {
          const mtgCenter = this.delegate.getMeetingZoneCenter();
          if (mtgCenter) {
            this.delegate.addMeetingRouteLines(participantIds, mtgCenter.cx, mtgCenter.cy, STATE_COLORS.meeting);
          }
        }
        if (next === 'completed' || next === 'cancelled') {
          for (const pid of participantIds) {
            this.delegate.removeRouteLine(`meeting-${pid}`);
          }
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('mcp.tool.called', (event) => {
        const payload = event.payload as McpToolCalledPayload;
        this.delegate.showToolOverlay(payload.employeeId, payload.toolName);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('employee.installed', (event) => {
        const payload = event.payload as EmployeeInstalledPayload;
        this.delegate.addEmployee(payload.employeeId, payload.name, 'lobster');
        this.delegate.scheduleRebuild();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('employee.created', (event) => {
        const payload = event.payload as EmployeeCreatedPayload;
        this.delegate.addEmployee(payload.employeeId, payload.name, 'employee', payload.roleSlug);
        this.delegate.scheduleRebuild();
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('employee.deleted', (event) => {
        const payload = event.payload as EmployeeDeletedPayload;
        this.delegate.unregisterEntity(payload.employeeId);
        this.delegate.removeEmployee(payload.employeeId);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('employee.workstation.changed', (event) => {
        const payload = event.payload as EmployeeWorkstationChangedPayload;
        if (payload.toWorkstationId) {
          this.delegate.moveEntityToWorkstation(payload.employeeId, payload.toWorkstationId);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('task.state.changed', (event) => {
        const payload = event.payload as import('@aics/shared-types').TaskStatePayload;
        const { taskRunId, next } = payload;
        if (next === 'completed' || next === 'failed' || next === 'cancelled') {
          this.delegate.removeRouteLine(taskRunId);
        }
        if ((next === 'running' || next === 'completed') && payload.employeeId) {
          const entity = this.delegate.getEntity(payload.employeeId);
          if (entity) this.delegate.flashHighlightEntity(entity, 500);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('ui.selection.changed', (event) => {
        const payload = event.payload as import('@aics/shared-types').UiSelectionPayload;
        // Only react to panel-initiated selections (scene-initiated ones are emitted by us)
        if (payload.source === 'panel') {
          this.delegate.setSelectedEmployeeId(payload.entityId);
          for (const [id, entity] of this.delegate.getAllEntities()) {
            entity.setHighlight(id === payload.entityId);
          }
          // Focus camera on selected employee if one is selected
          if (payload.entityId) {
            this.delegate.selectEmployee(payload.entityId);
          }
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('install.state.changed', (event) => {
        const payload = event.payload as import('@aics/shared-types').InstallStatePayload;
        const { installTxnId, next } = payload;
        if (next === 'compatibility_checked' || next === 'awaiting_confirmation') {
          this.delegate.showInstallGhost(installTxnId);
        } else if (next === 'materializing') {
          this.delegate.updateInstallGhostProgress(installTxnId, 0.1);
        } else if (next === 'installed') {
          this.delegate.settleInstallGhost(installTxnId);
        } else if (next === 'failed' || next === 'rolled_back' || next === 'cancelled') {
          this.delegate.failInstallGhost(installTxnId);
        }
        if (next === 'failed' || next === 'rolled_back') {
          this.delegate.requestAttention(installTxnId, 5);
        } else if (next === 'installed' || next === 'cancelled') {
          this.delegate.clearAttention(installTxnId);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('install.progress', (event) => {
        const payload = event.payload as { installTxnId: string; fraction: number };
        this.delegate.updateInstallGhostProgress(payload.installTxnId, payload.fraction);
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('report.state.changed', (event) => {
        const payload = event.payload as ReportStatePayload;
        if (payload.next === 'ready' && payload.employeeId) {
          const entity = this.delegate.getEntity(payload.employeeId);
          if (entity) this.delegate.flashHighlightEntity(entity, 2000);
        }
      }),
    );

    this.unsubscribers.push(
      this.eventBus.on('runtime.performance.tier.changed', (event) => {
        const tier = (event.payload as { tier: PerformanceTier }).tier;
        this.delegate.setPerformanceTier(tier);
      }),
    );

    // ANIM-015: task row click -> scene flash highlight on target employee
    this.unsubscribers.push(
      this.eventBus.on('ui.task.focused', (event) => {
        const payload = event.payload as import('@aics/shared-types').UiTaskFocusedPayload;
        const entity = this.delegate.getEntity(payload.employeeId);
        if (entity) {
          entity.flashHighlight();
        }
      }),
    );

    // ── Bubble info: LLM cost tracking ──
    // Each llm.usage.recorded carries token counts. We estimate cost from tokens
    // using a rough $/Mtok average and accumulate per-employee via taskRunId mapping.
    this.unsubscribers.push(
      this.eventBus.on('llm.usage.recorded', (event) => {
        const payload = event.payload as LlmUsageRecordedPayload;
        // Find the employee entity for this task — event.entityId is the employee
        const employeeId = event.entityId;
        if (!employeeId) return;
        const entity = this.delegate.getEntity(employeeId);
        if (!entity) return;

        // Estimate cost: use a rough average of $3/Mtok input, $15/Mtok output
        const costDelta =
          (payload.inputTokens / 1_000_000) * 3 +
          (payload.outputTokens / 1_000_000) * 15;
        const prev = this.employeeCost.get(employeeId) ?? 0;
        const total = prev + costDelta;
        this.employeeCost.set(employeeId, total);

        entity.setBubbleInfo({ cost: total });
      }),
    );

    // ── Bubble info: MCP tool result (reference counting + error text) ──
    this.unsubscribers.push(
      this.eventBus.on('mcp.tool.result', (event) => {
        const payload = event.payload as McpToolResultPayload;
        const entity = this.delegate.getEntity(payload.employeeId);
        if (!entity) return;

        if (payload.success) {
          // Count successful tool calls as "references" when employee is searching
          const prev = this.employeeRefs.get(payload.employeeId) ?? 0;
          this.employeeRefs.set(payload.employeeId, prev + 1);
          entity.setBubbleInfo({ referenceCount: prev + 1 });
        } else if (payload.error) {
          entity.setBubbleInfo({ errorText: payload.error });
        }
      }),
    );

    // ── Bubble info: error.occurred → show readable error on employee ──
    this.unsubscribers.push(
      this.eventBus.on('error.occurred', (event) => {
        const payload = event.payload as ErrorOccurredPayload;
        if (!payload.employeeId) return;
        const entity = this.delegate.getEntity(payload.employeeId);
        if (!entity) return;
        entity.setBubbleInfo({ errorText: payload.message });
      }),
    );

    // ── Clear accumulated cost/refs when task is unassigned ──
    this.unsubscribers.push(
      this.eventBus.on('task.assignment.changed', (event) => {
        const payload = event.payload as TaskAssignmentPayload;
        if (payload.action === 'unassigned') {
          this.employeeCost.delete(payload.employeeId);
          this.employeeRefs.delete(payload.employeeId);
        }
      }),
    );
  }

  /** Unsubscribe from all events. */
  destroy(): void {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    this.nodeActiveEmployees.clear();
    this.employeeCost.clear();
    this.employeeRefs.clear();
  }

  // ── Private helpers ──

  private findEmployeeForNode(nodeName: string): SceneEntity | undefined {
    const lower = nodeName.toLowerCase();
    for (const [id, entity] of this.delegate.getAllEntities()) {
      const name = id.replace('emp-', '');
      const pattern = new RegExp(`(?:^|[^a-z])${name}(?:$|[^a-z])`);
      if (pattern.test(lower)) return entity;
    }
    return undefined;
  }
}
