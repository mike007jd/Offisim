// Publish-artifact extension — registers the `publish_artifact` tool on the root
// Pi session.
//
// This is the live writer for the `deliverables` table. The agent calls
// `publish_artifact` with a workspace-relative path; the host emits a neutral
// `artifact.created` agentRun line (a payload.type within the existing `agentRun`
// wire kind — NOT a new wire kind). The renderer is the sole DB writer: it reads
// the file through the sandboxed `project_read_file` Tauri command, hashes it, and
// inserts the deliverable row, then refetches the Outputs panel. The extension
// itself never touches SQLite — it only emits an event, exactly like the
// delegation run-tree events.
//
// Registered alongside the permission gate and delegation tool in
// resourceLoader.extensionFactories. Enabled whenever there is a root run id +
// thread id (the scope fields the renderer needs to persist and route the row).

import { Type } from 'typebox';
import { agentRunLine } from './pi-agent-host-wire.mjs';
import { randomUUID } from 'node:crypto';
import { resolve as resolvePath } from 'node:path';

const PublishArtifactParams = Type.Object({
  path: Type.String({
    description: 'Workspace-relative path to the file you produced (e.g. report.md)',
  }),
  title: Type.String({ description: 'Human-readable artifact title' }),
  kind: Type.Optional(Type.String({ description: "'document' (default) or 'file'" })),
  mimeType: Type.Optional(Type.String()),
});

/**
 * Build the extension factory that registers `publish_artifact`, closing over the
 * host's raw wire emitter and this run's scope fields.
 * @param {{ emit: (line: object) => void, threadId: string, rootRunId: string, employeeId?: string, cwd?: string }} ctx
 */
export function createPublishArtifactExtensionFactory({ emit, threadId, rootRunId, employeeId, cwd }) {
  return (pi) => {
    pi.registerTool({
      name: 'publish_artifact',
      label: 'Publish Artifact',
      description:
        'Register a file you created in the workspace as a versioned, hashed deliverable visible in the Outputs panel. Pass a workspace-relative path.',
      parameters: PublishArtifactParams,

      async execute(_toolCallId, params, _signal) {
        const path = typeof params.path === 'string' ? params.path.trim() : '';
        const title = typeof params.title === 'string' ? params.title.trim() : '';
        if (!path || !title) {
          return {
            content: [
              {
                type: 'text',
                text: 'publish_artifact: both a non-empty workspace-relative path and a title are required.',
              },
            ],
            isError: true,
          };
        }
        const kind = typeof params.kind === 'string' && params.kind.trim() ? params.kind.trim() : 'document';
        const mimeType =
          typeof params.mimeType === 'string' && params.mimeType.trim()
            ? params.mimeType.trim()
            : undefined;
        const deliverableId = randomUUID();
        // Resolve to an absolute path against the Pi session cwd (the workspace
        // root). The renderer reads it via `project_read_file`, whose
        // relative-path resolution needs a cwd that the wire does not carry; an
        // absolute path takes the command's `is_absolute` branch and stays
        // workspace-jail-checked regardless of how many projects are bound.
        const absolutePath = cwd ? resolvePath(cwd, path) : path;
        emit(
          agentRunLine({
            threadId,
            rootRunId,
            runId: rootRunId,
            ...(employeeId ? { employeeId } : {}),
            runType: 'artifact.created',
            payload: {
              deliverableId,
              title,
              path: absolutePath,
              kind,
              ...(mimeType ? { mimeType } : {}),
            },
          }),
        );
        return {
          content: [{ type: 'text', text: `Published artifact "${title}" (ref ${deliverableId})` }],
        };
      },
    });
  };
}
