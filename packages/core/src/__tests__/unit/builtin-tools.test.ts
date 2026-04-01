import { describe, expect, it, vi } from 'vitest';
import { createBashTool } from '../../tools/builtin/bash-tool.js';
import { createFileReadTool } from '../../tools/builtin/file-read-tool.js';
import { createFileWriteTool } from '../../tools/builtin/file-write-tool.js';
import { createBuiltinTools } from '../../tools/builtin/index.js';
import type { BuiltinToolConfig, FsAdapter, ShellExec } from '../../tools/builtin/types.js';
import { createWebSearchTool } from '../../tools/builtin/web-search-tool.js';

// ---- Helpers ----

function mockShellExec(overrides?: Partial<Awaited<ReturnType<ShellExec>>>): ShellExec {
  return vi.fn().mockResolvedValue({
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    ...overrides,
  });
}

function mockFs(overrides?: Partial<FsAdapter>): FsAdapter {
  return {
    readFile: vi.fn().mockResolvedValue('file contents'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function desktopConfig(shellExec?: ShellExec, fs?: FsAdapter): BuiltinToolConfig {
  return {
    executionMode: 'desktop-trusted',
    shellExec: shellExec ?? mockShellExec(),
    fs: fs ?? mockFs(),
  };
}

function browserConfig(): BuiltinToolConfig {
  return { executionMode: 'browser-limited' };
}

function requireTool<T>(tool: T | null): T {
  if (!tool) throw new Error('Expected tool to be created');
  return tool;
}

// ---- Tests ----

describe('createBashTool', () => {
  it('returns null in browser-limited mode', () => {
    expect(createBashTool(browserConfig())).toBeNull();
  });

  it('returns null when shellExec is not provided', () => {
    expect(createBashTool({ executionMode: 'desktop-trusted' })).toBeNull();
  });

  it('executes command via shellExec', async () => {
    const shell = mockShellExec({ stdout: 'hello world' });
    const tool = requireTool(createBashTool(desktopConfig(shell)));
    const result = await tool.execute({ command: 'echo hello' });
    expect(result).toBe('hello world');
    expect(shell).toHaveBeenCalledWith(
      'echo hello',
      expect.objectContaining({ timeoutMs: 30_000 }),
    );
  });

  it('passes cwd to shellExec', async () => {
    const shell = mockShellExec({ stdout: 'ok' });
    const tool = requireTool(createBashTool(desktopConfig(shell)));
    await tool.execute({ command: 'ls', cwd: '/tmp' });
    expect(shell).toHaveBeenCalledWith('ls', expect.objectContaining({ cwd: '/tmp' }));
  });

  it('includes stderr in output', async () => {
    const shell = mockShellExec({ stdout: 'out', stderr: 'warn' });
    const tool = requireTool(createBashTool(desktopConfig(shell)));
    const result = await tool.execute({ command: 'cmd' });
    expect(result).toContain('out');
    expect(result).toContain('STDERR:\nwarn');
  });

  it('reports timeout', async () => {
    const shell = mockShellExec({ stdout: '', timedOut: true });
    const tool = requireTool(createBashTool(desktopConfig(shell)));
    const result = await tool.execute({ command: 'sleep 999' });
    expect(result).toContain('[TIMEOUT: command exceeded time limit]');
  });

  it('reports non-zero exit code', async () => {
    const shell = mockShellExec({ stdout: '', exitCode: 1 });
    const tool = requireTool(createBashTool(desktopConfig(shell)));
    const result = await tool.execute({ command: 'false' });
    expect(result).toContain('[Exit code: 1]');
  });

  it('truncates long output', async () => {
    const longOutput = 'x'.repeat(200);
    const shell = mockShellExec({ stdout: longOutput });
    const tool = requireTool(
      createBashTool({
        executionMode: 'desktop-trusted',
        shellExec: shell,
        maxOutputBytes: 100,
      }),
    );
    const result = (await tool.execute({ command: 'big' })) as string;
    expect(result).toContain('[OUTPUT TRUNCATED]');
    // Result length = 100 chars + '\n[OUTPUT TRUNCATED]'
    expect(result.length).toBeLessThan(longOutput.length);
  });

  it('returns "(no output)" for empty output', async () => {
    const shell = mockShellExec({ stdout: '' });
    const tool = requireTool(createBashTool(desktopConfig(shell)));
    const result = await tool.execute({ command: 'true' });
    expect(result).toBe('(no output)');
  });
});

describe('createFileReadTool', () => {
  it('returns null in browser-limited mode', () => {
    expect(createFileReadTool(browserConfig())).toBeNull();
  });

  it('returns null when fs is not provided', () => {
    expect(createFileReadTool({ executionMode: 'desktop-trusted' })).toBeNull();
  });

  it('reads file via fs adapter', async () => {
    const fs = mockFs({ readFile: vi.fn().mockResolvedValue('hello file') });
    const tool = requireTool(createFileReadTool(desktopConfig(undefined, fs)));
    const result = await tool.execute({ path: '/tmp/test.txt' });
    expect(result).toBe('hello file');
    expect(fs.readFile).toHaveBeenCalledWith('/tmp/test.txt');
  });

  it('returns error message on failure', async () => {
    const fs = mockFs({ readFile: vi.fn().mockRejectedValue(new Error('not found')) });
    const tool = requireTool(createFileReadTool(desktopConfig(undefined, fs)));
    const result = await tool.execute({ path: '/nope' });
    expect(result).toContain('Error reading file');
    expect(result).toContain('not found');
  });
});

describe('createFileWriteTool', () => {
  it('returns null in browser-limited mode', () => {
    expect(createFileWriteTool(browserConfig())).toBeNull();
  });

  it('writes file via fs adapter', async () => {
    const fs = mockFs();
    const tool = requireTool(createFileWriteTool(desktopConfig(undefined, fs)));
    const result = await tool.execute({ path: '/tmp/out.txt', content: 'abc' });
    expect(result).toContain('Successfully wrote');
    expect(result).toContain('3 bytes');
    expect(fs.writeFile).toHaveBeenCalledWith('/tmp/out.txt', 'abc');
  });

  it('returns error message on write failure', async () => {
    const fs = mockFs({ writeFile: vi.fn().mockRejectedValue(new Error('permission denied')) });
    const tool = requireTool(createFileWriteTool(desktopConfig(undefined, fs)));
    const result = await tool.execute({ path: '/root/secret', content: 'x' });
    expect(result).toContain('Error writing file');
    expect(result).toContain('permission denied');
  });
});

describe('createWebSearchTool', () => {
  it('is always created (even in browser mode)', () => {
    const tool = createWebSearchTool();
    expect(tool).not.toBeNull();
    expect(tool.def.name).toBe('web_search');
  });
});

describe('createBuiltinTools', () => {
  it('creates all tools in desktop mode', () => {
    const tools = createBuiltinTools(desktopConfig());
    expect(tools.has('bash')).toBe(true);
    expect(tools.has('read_file')).toBe(true);
    expect(tools.has('write_file')).toBe(true);
    expect(tools.has('web_search')).toBe(true);
    expect(tools.size).toBe(4);
  });

  it('only creates web_search in browser mode', () => {
    const tools = createBuiltinTools(browserConfig());
    expect(tools.has('bash')).toBe(false);
    expect(tools.has('read_file')).toBe(false);
    expect(tools.has('write_file')).toBe(false);
    expect(tools.has('web_search')).toBe(true);
    expect(tools.size).toBe(1);
  });
});
