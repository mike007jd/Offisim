/**
 * Skill-mutation virtual tools for an employee pi turn.
 *
 * The employee prompt (`employee-builder.ts`) instructs the model to call
 * `create_skill_from_scratch` / `fork_skill` / `edit_skill_body` /
 * `install_skill_from_*` / `sync_from_*` when the task is a skill mutation.
 * These are NOT builtin/MCP executor tools — like `submit_deliverable` and
 * `delegate` they carry their own logic, so they are injected through the
 * `virtualToolProvider` rather than the AuditingToolExecutor dispatch.
 *
 * Each tool routes to `handleSkillInstallTool`, which stages a preview and emits
 * a `skill_install_confirm` interaction through the runtime's InteractionService
 * (the SkillInstallCommitter writes the SKILL.md to the vault + skills row on
 * confirm). Every result is the handler's structured JSON string so the model
 * can reason about pending-confirm / structured errors.
 */

import type { AgentTool, AgentToolResult } from '@offisim/pi-agent';
import type { TSchema } from '@offisim/pi-ai';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import {
  SKILL_INSTALL_TOOL_DEFS,
  type SkillInstallToolName,
  handleSkillInstallTool,
} from '../skills/skill-install-tools.js';
import type { PiToolContext } from './pi-tool-adapter.js';

/**
 * Build the skill-mutation tool set for an employee turn. Returns an empty list
 * when the turn has no employee identity (skill mutations are always
 * employee-scoped and need a caller employee id for ownership checks).
 *
 * `modelKey` is the `<provider>/<model>` label persisted as the self-authoring
 * provenance (`source_ref = llm-author:<modelKey>`) for `create_skill_from_scratch`.
 */
export function createSkillInstallTools(
  runtimeCtx: RuntimeContext,
  toolCtx: PiToolContext,
  modelKey: string,
): AgentTool[] {
  const employeeId = toolCtx.employeeId;
  if (!employeeId) return [];
  return SKILL_INSTALL_TOOL_DEFS.map((def) => ({
    name: def.name,
    label: def.name,
    description: def.description,
    parameters: def.parameters as unknown as TSchema,
    executionMode: 'sequential' as const,
    execute: async (_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> => {
      const args = (params ?? {}) as Record<string, unknown>;
      const json = await handleSkillInstallTool(
        def.name as SkillInstallToolName,
        args,
        runtimeCtx,
        employeeId,
        modelKey,
        toolCtx.projectId ?? null,
      );
      // The handler always returns a JSON string (its tool-executor contract);
      // hand the model the raw text and the parsed object as details.
      let details: unknown = json;
      try {
        details = JSON.parse(json);
      } catch {
        /* keep the raw string */
      }
      return { content: [{ type: 'text', text: json }], details };
    },
  }));
}
