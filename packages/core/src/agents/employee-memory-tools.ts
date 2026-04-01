/**
 * Memory tool definitions and handler for the employee node.
 *
 * Provides remember/recall/forget virtual tools that let employees
 * build persistent memories across tasks.
 *
 * Extracted from employee-node.ts to isolate memory CRUD from the main execution path.
 */
import { memoryAccessed } from '../events/event-factories.js';
import type { ToolDef } from '../llm/gateway.js';
import type { MemoryEntryRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';

/** Virtual tool names for memory operations */
export const MEMORY_TOOL_NAMES = ['remember', 'recall', 'forget'] as const;

/** Static memory tool definitions — allocated once, reused across all employee invocations. */
const MEMORY_TOOLS: readonly ToolDef[] = Object.freeze([
  {
    name: 'remember',
    description:
      'Store a memory for future reference. Use this to save important insights, decisions, or learnings.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'What to remember' },
        category: {
          type: 'string',
          enum: ['experience', 'decision', 'knowledge', 'preference'],
          description: 'Category of memory',
        },
        scope: {
          type: 'string',
          enum: ['employee', 'team'],
          description:
            'Visibility scope (employee=personal, team=team-wide). Company scope is reserved for SOP/config.',
        },
        importance: {
          type: 'number',
          description: 'Importance 0.0-1.0 (0.3=minor, 0.5=moderate, 0.7=important, 0.9=critical)',
        },
      },
      required: ['content', 'category', 'scope', 'importance'],
    },
  },
  {
    name: 'recall',
    description: 'Search your memories for relevant past experiences, decisions, or knowledge.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for in memories' },
      },
      required: ['query'],
    },
  },
  {
    name: 'forget',
    description: 'Delete a specific memory by its ID.',
    parameters: {
      type: 'object',
      properties: {
        memoryId: { type: 'string', description: 'The ID of the memory to delete' },
      },
      required: ['memoryId'],
    },
  },
]);

/** Return the static memory tool definitions. */
export function buildMemoryTools(): ToolDef[] {
  return MEMORY_TOOLS as ToolDef[];
}

/** Format memories into a prompt section. */
export function formatMemoriesSection(memories: MemoryEntryRow[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map(
    (m) => `- [${m.scope}/${m.category}] (importance: ${m.importance}) ${m.content}`,
  );
  return `\n\n## Your memories\n${lines.join('\n')}`;
}

/** Execute a memory virtual tool call. */
export async function handleMemoryTool(
  toolName: (typeof MEMORY_TOOL_NAMES)[number],
  args: Record<string, unknown>,
  employeeId: string,
  companyId: string,
  threadId: string,
  runtimeCtx: RuntimeContext,
): Promise<string> {
  const { memoryService, repos, eventBus } = runtimeCtx;
  if (!memoryService) return 'Memory service unavailable';

  switch (toolName) {
    case 'remember': {
      const content = String(args.content ?? '');
      const category = String(args.category ?? 'experience') as
        | 'experience'
        | 'decision'
        | 'knowledge'
        | 'preference';
      const scope = String(args.scope ?? 'employee') as 'employee' | 'team' | 'company';
      const importance = Math.max(0, Math.min(1, Number(args.importance ?? 0.5)));

      const memoryId = await memoryService.createMemory({
        employeeId,
        companyId,
        scope,
        category,
        content,
        importance,
        threadId,
      });

      return `Memory stored (id: ${memoryId})`;
    }

    case 'recall': {
      const query = String(args.query ?? '');
      const memories = await memoryService.getRelevantMemories(employeeId, companyId, query, 5);

      if (memories.length === 0) return 'No relevant memories found.';

      // Touch access for each recalled memory (parallel — independent operations)
      await Promise.all(
        memories.map(async (mem) => {
          await repos.memories.touchAccess(mem.memory_id);
          eventBus.emit(memoryAccessed(companyId, mem.memory_id, employeeId, query, threadId));
        }),
      );

      return memories
        .map(
          (m) =>
            `[${m.memory_id}] (${m.scope}/${m.category}, importance: ${m.importance}) ${m.content}`,
        )
        .join('\n');
    }

    case 'forget': {
      const memoryId = String(args.memoryId ?? '');
      await repos.memories.delete(memoryId);
      return `Memory ${memoryId} deleted.`;
    }

    default:
      return `Unknown memory tool: ${toolName}`;
  }
}
