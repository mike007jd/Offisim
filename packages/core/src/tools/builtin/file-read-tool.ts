import { type BuiltinTool, type BuiltinToolConfig, fsAdapterOptions } from './types.js';

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
          offset: { type: 'integer', description: '1-based line offset to start reading' },
          limit: { type: 'integer', description: 'Maximum number of lines to return' },
          raw: {
            type: 'boolean',
            description:
              'Return exact file content without line numbers. Use this before write_file expectedPreviousContent.',
          },
        },
        required: ['path'],
      },
      maxResultSizeChars: 30_000,
    },
    async execute(args, context) {
      const path = args.path as string;
      const offset = typeof args.offset === 'number' ? Math.max(1, Math.floor(args.offset)) : 1;
      const limit =
        typeof args.limit === 'number' ? Math.max(1, Math.floor(args.limit)) : undefined;
      const baseOptions = fsAdapterOptions(context);
      if (args.raw === true || !fs.readFileLines) {
        const text = await fs.readFile(path, baseOptions);
        if (args.raw === true) return text;
        const lines = text.split(/\r?\n/u);
        const selected = lines.slice(offset - 1, limit ? offset - 1 + limit : undefined);
        return selected.map((line, index) => `${offset + index}\t${line}`).join('\n');
      }
      const text = await fs.readFileLines(path, {
        ...baseOptions,
        offset,
        ...(limit ? { limit } : {}),
      });
      const selected = text.length > 0 && text.endsWith('\n') ? text.slice(0, -1).split(/\n/u) : [];
      return selected.map((line, index) => `${offset + index}\t${line}`).join('\n');
    },
  };
}
