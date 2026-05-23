/**
 * Event payload barrel. All payloads live under `./events/<domain>.ts`,
 * one module per event-prefix domain. Consumers keep using
 * `import type { XPayload } from '@offisim/shared-types'` — this file just
 * re-exports every domain so the public surface stays flat.
 */

export * from './events/boss-route.js';
export * from './events/chat-attachment-events.js';
export * from './events/chat-thread.js';
export * from './events/company-startup.js';
export * from './events/conversation.js';
export * from './events/core.js';
export * from './events/cost.js';
export * from './events/deliverable.js';
export * from './events/direct-chat.js';
export * from './events/employee.js';
export * from './events/engine.js';
export * from './events/execution.js';
export * from './events/graph.js';
export * from './events/handoff.js';
export * from './events/hr.js';
export * from './events/install.js';
export * from './events/interaction.js';
export * from './events/llm.js';
export * from './events/meeting.js';
export * from './events/memory.js';
export * from './events/notification.js';
export * from './events/plan.js';
export * from './events/prefab.js';
export * from './events/rack-slot.js';
export * from './events/report.js';
export * from './events/session.js';
export * from './events/task.js';
export * from './events/tool.js';
export * from './events/ui.js';
export * from './events/vault.js';
export * from './events/workspace.js';
