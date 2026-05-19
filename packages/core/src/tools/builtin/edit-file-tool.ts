import type { BuiltinTool, BuiltinToolConfig } from './types.js';

export function createEditFileTool(config: BuiltinToolConfig): BuiltinTool | null {
  if (config.executionMode === 'browser-limited' || !config.fs) return null;
  const fs = config.fs;
  return {
    def: {
      name: 'edit_file',
      description:
        'Replace an exact string in a file. Refuses ambiguous matches unless replaceAll is true.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          oldString: { type: 'string' },
          newString: { type: 'string' },
          replaceAll: { type: 'boolean' },
        },
        required: ['path', 'oldString', 'newString'],
      },
    },
    async execute(args, context) {
      if (config.readOnly) throw new Error('[READ_ONLY_MODE] edit_file is disabled for this run.');
      const path = args.path as string;
      const oldString = args.oldString as string;
      const newString = args.newString as string;
      const replaceAll = args.replaceAll === true;
      const options = context?.threadId ? { threadId: context.threadId } : undefined;
      const current = await fs.readFile(path, options);
      const matches = countMatches(current, oldString);
      if (matches === 0) throw new Error('[EDIT_TARGET_NOT_FOUND] oldString was not found.');
      if (matches > 1 && !replaceAll) {
        throw new Error(`[EDIT_TARGET_AMBIGUOUS] oldString matched ${matches} times.`);
      }
      const next = replaceAll
        ? current.split(oldString).join(newString)
        : current.replace(oldString, newString);
      await fs.writeFile(path, next, options);
      return `Edited ${path}: replaced ${replaceAll ? matches : 1} occurrence(s).`;
    },
  };
}

function countMatches(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = 0;
  index = text.indexOf(needle, index);
  while (index >= 0) {
    count += 1;
    index += needle.length;
    index = text.indexOf(needle, index);
  }
  return count;
}
