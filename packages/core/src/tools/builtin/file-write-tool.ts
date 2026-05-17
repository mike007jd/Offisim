import type { BuiltinTool, BuiltinToolConfig } from './types.js';

export function createFileWriteTool(config: BuiltinToolConfig): BuiltinTool | null {
  if (config.executionMode === 'browser-limited' || !config.fs) return null;

  const fs = config.fs;

  return {
    def: {
      name: 'write_file',
      description:
        'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative file path to write' },
          content: { type: 'string', description: 'Content to write to the file' },
          expectedPreviousContent: {
            type: 'string',
            description: 'Required when overwriting an existing file; pass the exact current file content read before writing',
          },
        },
        required: ['path', 'content'],
      },
    },
    async execute(args, context) {
      if (config.readOnly) {
        throw new Error('[READ_ONLY_MODE] write_file is disabled for this run.');
      }
      const path = args.path as string;
      const content = args.content as string;
      if (await fs.exists(path, context?.threadId ? { threadId: context.threadId } : undefined)) {
        const current = await fs.readFile(
          path,
          context?.threadId ? { threadId: context.threadId } : undefined,
        );
        if (args.expectedPreviousContent !== current) {
          throw new Error(
            '[WRITE_REQUIRES_READ_BEFORE_WRITE] Existing file content does not match expectedPreviousContent.',
          );
        }
      }
      await fs.writeFile(
        path,
        content,
        context?.threadId ? { threadId: context.threadId } : undefined,
      );
      return `Successfully wrote ${content.length} bytes to ${path}`;
    },
  };
}
