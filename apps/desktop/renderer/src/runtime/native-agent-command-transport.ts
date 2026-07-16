import { type CommandArgs, type CommandResult, invokeCommand } from '@/lib/tauri-commands.js';

type NativeCommandName =
  | 'agent_runtime_execute'
  | 'agent_runtime_resume'
  | 'agent_runtime_enhance'
  | 'agent_runtime_abort'
  | 'agent_runtime_answer'
  | 'agent_runtime_control'
  | 'agent_runtime_stream_snapshot'
  | 'agent_runtime_release_stream'
  | 'agent_runtime_reattach'
  | 'codex_agent_execute'
  | 'codex_agent_resume'
  | 'codex_agent_enhance'
  | 'codex_agent_abort'
  | 'codex_agent_answer'
  | 'codex_agent_stream_snapshot'
  | 'codex_agent_release_stream'
  | 'codex_agent_reattach'
  | 'claude_agent_execute'
  | 'claude_agent_resume'
  | 'claude_agent_enhance'
  | 'claude_agent_abort'
  | 'claude_agent_answer'
  | 'claude_agent_stream_snapshot'
  | 'claude_agent_release_stream'
  | 'claude_agent_reattach';

export type NativeCommandInvoke = <K extends NativeCommandName>(
  command: K,
  args: CommandArgs<K>,
) => Promise<CommandResult<K>>;

export type NativeEngineId = 'api' | 'codex' | 'claude';

/**
 * Closed, injectable native command bridge used by the production adapter.
 * Codex and API execute/resume stay separate methods so a Pi-shaped request can
 * never accidentally typecheck at the strict Codex serde boundary.
 */
export function createNativeAgentCommandTransport(
  call: NativeCommandInvoke = invokeCommand as NativeCommandInvoke,
) {
  return {
    executeApi: (args: CommandArgs<'agent_runtime_execute'>) => call('agent_runtime_execute', args),
    resumeApi: (args: CommandArgs<'agent_runtime_resume'>) => call('agent_runtime_resume', args),
    executeCodex: (args: CommandArgs<'codex_agent_execute'>) => call('codex_agent_execute', args),
    resumeCodex: (args: CommandArgs<'codex_agent_resume'>) => call('codex_agent_resume', args),
    executeClaude: (args: CommandArgs<'claude_agent_execute'>) =>
      call('claude_agent_execute', args),
    resumeClaude: (args: CommandArgs<'claude_agent_resume'>) => call('claude_agent_resume', args),
    enhanceApi: (args: CommandArgs<'agent_runtime_enhance'>) => call('agent_runtime_enhance', args),
    enhanceCodex: (args: CommandArgs<'codex_agent_enhance'>) => call('codex_agent_enhance', args),
    enhanceClaude: (args: CommandArgs<'claude_agent_enhance'>) =>
      call('claude_agent_enhance', args),
    abort: (engineId: NativeEngineId, args: CommandArgs<'agent_runtime_abort'>) =>
      engineId === 'codex'
        ? call('codex_agent_abort', args)
        : engineId === 'claude'
          ? call('claude_agent_abort', args)
          : call('agent_runtime_abort', args),
    answer: (engineId: NativeEngineId, args: CommandArgs<'agent_runtime_answer'>) =>
      engineId === 'codex'
        ? call('codex_agent_answer', args)
        : engineId === 'claude'
          ? call('claude_agent_answer', args)
          : call('agent_runtime_answer', args),
    streamSnapshot: (
      engineId: NativeEngineId,
      args: CommandArgs<'agent_runtime_stream_snapshot'>,
    ) =>
      engineId === 'codex'
        ? call('codex_agent_stream_snapshot', args)
        : engineId === 'claude'
          ? call('claude_agent_stream_snapshot', args)
          : call('agent_runtime_stream_snapshot', args),
    releaseStream: (engineId: NativeEngineId, args: CommandArgs<'agent_runtime_release_stream'>) =>
      engineId === 'codex'
        ? call('codex_agent_release_stream', args)
        : engineId === 'claude'
          ? call('claude_agent_release_stream', args)
          : call('agent_runtime_release_stream', args),
    reattach: (engineId: NativeEngineId, args: CommandArgs<'agent_runtime_reattach'>) =>
      engineId === 'codex'
        ? call('codex_agent_reattach', args)
        : engineId === 'claude'
          ? call('claude_agent_reattach', args)
          : call('agent_runtime_reattach', args),
    stopChild: (args: CommandArgs<'agent_runtime_control'>) => call('agent_runtime_control', args),
    control: (args: CommandArgs<'agent_runtime_control'>) => call('agent_runtime_control', args),
  };
}

export type NativeAgentCommandTransport = ReturnType<typeof createNativeAgentCommandTransport>;
