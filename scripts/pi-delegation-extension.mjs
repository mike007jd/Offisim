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
    }),
    { description: 'Tasks to delegate. Phase 1 runs the first task (single mode).' },
  ),
  mode: Type.Optional(
    Type.Union([Type.Literal('single'), Type.Literal('parallel')], {
      description: 'single awaits one teammate; parallel (later) fans out. Default: single.',
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
        // Phase 1: single mode. Run the first task and await its summary. (parallel
        // / recursion arrive in Phase 2; extra tasks are ignored for now.)
        const [task] = tasks;
        const summary = await supervisor.runSingle(
          { employeeId: task.employeeId, objective: task.objective, access: task.access },
          signal,
        );
        const note =
          tasks.length > 1
            ? `\n\n(Note: ${tasks.length - 1} additional task(s) ignored — single mode in this build.)`
            : '';
        return { content: [{ type: 'text', text: `${summary}${note}` }] };
      },
    });
  };
}
