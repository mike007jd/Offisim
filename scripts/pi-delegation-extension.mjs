// Delegation extension — registers the `delegate` tool on the root Pi session.
//
// This is the manager-as-tools seam: the root agent autonomously decides when to
// delegate; calling `delegate` hands a bounded objective to a teammate's isolated
// child session (run by the ChildAgentSupervisor) and returns the teammate's
// summary as the tool result. Phase 1 implements `single` mode (one task, awaited).
//
// Registered alongside the permission gate in resourceLoader.extensionFactories.
// Children do NOT receive this extension (maxDepth=1 is enforced structurally —
// recursion arrives in Phase 2).

import { Type } from 'typebox';
import { WORK_KINDS } from './pi-agent-host-wire.mjs';

const DelegateParams = Type.Object({
  tasks: Type.Array(
    Type.Object({
      employeeId: Type.String({ description: 'employeeId of the teammate to delegate to' }),
      objective: Type.String({ description: 'The bounded task or question for the teammate' }),
      access: Type.Optional(
        Type.Union([Type.Literal('read'), Type.Literal('write'), Type.Literal('review')], {
          description: 'Capability band. read = investigate; write = edit/run; review = read + run checks. Default: read.',
        }),
      ),
      workKind: Type.Optional(
        Type.Union(
          WORK_KINDS.map((kind) => Type.Literal(kind)),
          {
            description:
              'The kind of work: plan, research, design, implement, review, test, compute, publish, present, coordinate. Optional; shapes how the teammate is staged.',
          },
        ),
      ),
      relation: Type.Optional(
        Type.Union(
          [Type.Literal('delegate'), Type.Literal('review'), Type.Literal('handoff')],
          {
            description:
              'Parent-child relation. Default: review for review-like work (workKind/access review), else delegate.',
          },
        ),
      ),
    }),
    { description: 'Tasks to delegate. single mode requires exactly one; parallel allows several.' },
  ),
  executionMode: Type.Optional(
    Type.Union([Type.Literal('single'), Type.Literal('parallel')], {
      description:
        'single = exactly one task, awaited; parallel = fan out one or more concurrently. Default: single.',
    }),
  ),
});

/**
 * Build the extension factory that registers `delegate`, closing over the
 * supervisor that actually runs children.
 * @param {{ runSingle: Function, roster: Array<{employeeId:string,name?:string,roleSlug?:string}> }} supervisor
 */
export function createDelegationExtensionFactory(supervisor) {
  const roster = supervisor.roster ?? [];
  const teammates =
    roster
      .map((entry) => {
        const role = entry.roleSlug ? `, ${entry.roleSlug}` : '';
        return `${entry.employeeId} (${entry.name ?? entry.employeeId}${role})`;
      })
      .join('; ') || 'none';

  return (pi) => {
    pi.registerTool({
      name: 'delegate',
      label: 'Delegate',
      description: [
        'Delegate a bounded task to one of your teammates. The teammate runs it with',
        'a fresh, isolated context and reports back a summary you then synthesize.',
        'Use this for well-scoped subtasks that benefit from a focused teammate',
        '(research, drafting, review). You keep the conversation with the user.',
        `Available teammates: ${teammates}.`,
      ].join(' '),
      parameters: DelegateParams,

      async execute(_toolCallId, params, signal) {
        const tasks = Array.isArray(params.tasks) ? params.tasks : [];
        if (tasks.length === 0) {
          return {
            content: [
              { type: 'text', text: 'delegate: provide at least one task { employeeId, objective }.' },
            ],
            isError: true,
          };
        }
        // executionMode is honest about the fan-out: single awaits exactly one
        // teammate; parallel fans out one or more. An ambiguous call (multiple
        // tasks without parallel) is rejected rather than silently coerced.
        const executionMode = params.executionMode === 'parallel' ? 'parallel' : 'single';
        if (executionMode === 'single' && tasks.length !== 1) {
          return {
            content: [
              {
                type: 'text',
                text: `delegate: single mode runs exactly one task (got ${tasks.length}). Use executionMode "parallel" to fan out, or send one task.`,
              },
            ],
            isError: true,
          };
        }
        // Parallel write safety: every child shares the same working directory, so
        // two concurrent writers (or a writer racing a reader) would stomp each
        // other's files. Reject parallel with any write task — run write work as a
        // single task, or split it into sequential single delegations. (True
        // concurrent writers need git-worktree isolation, a separate feature.)
        if (executionMode === 'parallel' && tasks.length > 1 && tasks.some((t) => t.access === 'write')) {
          return {
            content: [
              {
                type: 'text',
                text: 'delegate: parallel write is unsafe — children share one working directory. Run the write task on its own (executionMode "single"), or sequence the writes as separate delegate calls. Parallel read/review fan-out is fine.',
              },
            ],
            isError: true,
          };
        }
        const text =
          executionMode === 'parallel'
            ? await supervisor.runParallel(tasks, signal)
            : await supervisor.runSingle(tasks[0], signal);
        return { content: [{ type: 'text', text }] };
      },
    });
  };
}
