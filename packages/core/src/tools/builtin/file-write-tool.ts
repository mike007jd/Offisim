import {
  type BuiltinTool,
  type BuiltinToolConfig,
  fsAdapterOptions,
  isBuiltinToolReadOnly,
} from './types.js';

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
            description:
              'Required when overwriting an existing file; pass the exact current file content read before writing',
          },
        },
        required: ['path', 'content'],
      },
    },
    async execute(args, context) {
      if (isBuiltinToolReadOnly(config, context)) {
        throw new Error('[READ_ONLY_MODE] write_file is disabled for this run.');
      }
      const path = args.path as string;
      const content = args.content as string;
      const options = fsAdapterOptions(context);
      if (await fs.exists(path, options)) {
        const current = await fs.readFile(path, options);
        if (args.expectedPreviousContent !== current) {
          throw new Error(
            '[WRITE_REQUIRES_READ_BEFORE_WRITE] Existing file content does not match expectedPreviousContent.',
          );
        }
      }
      await fs.writeFile(path, content, options);
      return `Successfully wrote ${content.length} bytes to ${path}`;
    },
  };
}
