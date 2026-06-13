/**
 * The `submit_deliverable` virtual tool — the explicit deliverable seam.
 *
 * This replaces the deleted intent-guessing chain (task-tool-intent →
 * completion-verifier-evidence → employee-completion). A worker produces a
 * deliverable ONLY by calling this tool; a normal conversational reply is never
 * mistaken for one. The tool emits `deliverable.created`, which the wired
 * `DeliverablePersistenceService` writes to the `deliverables` table with a
 * row shape (including contributor brand fields for avatar propagation) that is
 * byte-compatible with the old path's `mapPayloadToRow`.
 */

import type { TSchema } from '@offisim/pi-ai';
import type { AgentTool, AgentToolResult } from '@offisim/pi-agent';
import { deliverableCreated } from '../events/task-events.js';
import { type DeliverableKind, employeeBrandFields } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { Logger } from '../services/logger.js';
import { generateId } from '../utils/generate-id.js';
import type { PiToolContext } from './pi-tool-adapter.js';

const logger = new Logger('pi-deliverable-tool');

const SUBMIT_DELIVERABLE_PARAMS = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'Short human title for the deliverable.',
    },
    content: {
      type: 'string',
      description: 'The full deliverable body (document text, code, report, …).',
    },
    kind: {
      type: 'string',
      enum: ['document', 'file'],
      description:
        "Deliverable category: 'document' for prose/markdown, 'file' for a named " +
        'file with an extension. Optional — inferred from file_name when omitted.',
    },
    file_name: {
      type: 'string',
      description: 'Suggested file name including extension, when the deliverable is a file.',
    },
    mime_type: {
      type: 'string',
      description: 'MIME type when the deliverable is a file (e.g. text/markdown).',
    },
  },
  required: ['title', 'content'],
  additionalProperties: false,
} as const;

interface SubmitDeliverableArgs {
  title: string;
  content: string;
  kind?: string;
  file_name?: string;
  mime_type?: string;
}

/**
 * Build the `submit_deliverable` tool for an employee turn. Boss turns do not
 * get it — deliverables are produced by the worker that did the work.
 */
export function createSubmitDeliverableTool(
  runtimeCtx: RuntimeContext,
  toolCtx: PiToolContext,
): AgentTool {
  return {
    name: 'submit_deliverable',
    label: 'Submit deliverable',
    description:
      'Persist a finished work product (document, code, report, dataset) to the ' +
      'company deliverables library so the user can open and download it. Call ' +
      'this ONLY for a concrete artifact you actually produced — a normal ' +
      'conversational reply is NOT a deliverable and must never be submitted here.',
    parameters: SUBMIT_DELIVERABLE_PARAMS as unknown as TSchema,
    executionMode: 'sequential',
    execute: async (_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> => {
      const args = (params ?? {}) as SubmitDeliverableArgs;
      const title = args.title?.trim();
      if (!title || !args.content?.trim()) {
        throw new Error('submit_deliverable requires a non-empty title and content');
      }
      const employee = toolCtx.employeeId
        ? await runtimeCtx.repos.employees.findById(toolCtx.employeeId)
        : null;
      if (!employee) {
        throw new Error('submit_deliverable is only available to an employee worker');
      }

      const deliverableId = generateId('del');
      const chatThreadId = toolCtx.runScope?.threadId ?? toolCtx.threadId;
      const contributor = {
        employeeId: employee.employee_id,
        employeeName: employee.name,
        sourceKind: 'employee' as const,
        roleSlug: employee.role_slug,
        ...employeeBrandFields(employee),
      };

      runtimeCtx.eventBus.emit(
        deliverableCreated(
          toolCtx.companyId,
          deliverableId,
          toolCtx.threadId,
          title,
          args.content,
          [contributor],
          {
            kind: normalizeKind(args.kind, args.file_name),
            fileName: args.file_name ?? null,
            mimeType: args.mime_type ?? null,
            chatThreadId,
          },
        ),
      );
      logger.info('deliverable submitted', {
        deliverableId,
        threadId: toolCtx.threadId,
        employeeId: employee.employee_id,
      });

      return {
        content: [
          {
            type: 'text',
            text: `Deliverable "${title}" saved to the library (id ${deliverableId}).`,
          },
        ],
        details: { deliverableId },
      };
    },
  };
}

function normalizeKind(kind: string | undefined, fileName?: string): DeliverableKind {
  if (kind === 'file' || kind === 'document') return kind;
  // Infer: a named file with an extension is a 'file', otherwise a 'document'.
  return fileName?.includes('.') ? 'file' : 'document';
}
