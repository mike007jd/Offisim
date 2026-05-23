import { classifyShellCommand } from './shell-command-classifier.js';
import { isBuiltinToolReadOnly, type BuiltinTool, type BuiltinToolConfig } from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT = 100 * 1024; // 100KB
export const BASH_DESTRUCTIVE_APPROVED_ARG = '__offisimDestructiveApproved';

export function createBashTool(config: BuiltinToolConfig): BuiltinTool | null {
  if (config.executionMode === 'browser-limited' || !config.shellExec) return null;

  const shellExec = config.shellExec;
  const timeoutMs = config.bashTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutput = config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

  return {
    def: {
      name: 'bash',
      description:
        'Execute a shell command and return its output. Use for running scripts, installing packages, compiling code, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute' },
          cwd: { type: 'string', description: 'Working directory (optional)' },
        },
        required: ['command'],
      },
    },
    async execute(args, context) {
      const command = args.command as string;
      const cwd = args.cwd as string | undefined;
      const classification = classifyShellCommand(command, {
        readOnly: isBuiltinToolReadOnly(config, context),
      });
      if (classification.decision === 'deny') {
        throw new Error(`[SHELL_COMMAND_DENIED] ${classification.reason}`);
      }
      if (classification.decision === 'ask' && args[BASH_DESTRUCTIVE_APPROVED_ARG] !== true) {
        throw new Error(`[TOOL_PERMISSION_REQUIRED] ${classification.reason}`);
      }
      const result = await shellExec(command, {
        cwd,
        ...(context?.threadId ? { threadId: context.threadId } : {}),
        ...(context?.employeeId ? { employeeId: context.employeeId } : {}),
        timeoutMs,
        maxOutputBytes: maxOutput,
      });

      let output = result.stdout;
      if (result.stderr) {
        output += `${output ? '\n' : ''}STDERR:\n${result.stderr}`;
      }
      if (result.timedOut) {
        output += '\n[TIMEOUT: command exceeded time limit]';
      }
      if (result.exitCode !== 0) {
        output += `\n[Exit code: ${result.exitCode}]`;
      }
      // Truncate if needed
      if (output.length > maxOutput) {
        output = `${output.slice(0, maxOutput)}\n[OUTPUT TRUNCATED]`;
      }
      if (result.timedOut || result.exitCode !== 0) {
        throw new Error(output || `Command failed with exit code ${result.exitCode}`);
      }
      return output || '(no output)';
    },
  };
}
