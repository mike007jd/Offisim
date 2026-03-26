import type { BuiltinTool, BuiltinToolConfig } from './types.js';

export function createFileReadTool(config: BuiltinToolConfig): BuiltinTool | null {
  if (config.executionMode === 'browser-limited' || !config.fs) return null;

  const fs = config.fs;

  return {
    def: {
      name: 'read_file',
      description: 'Read the contents of a file at the given path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or relative file path to read' },
        },
        required: ['path'],
      },
    },
    async execute(args) {
      const path = args.path as string;
      try {
        return await fs.readFile(path);
      } catch (err) {
        return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
