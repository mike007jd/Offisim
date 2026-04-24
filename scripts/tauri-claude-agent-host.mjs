#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function asNonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function workspaceRootFromEnv() {
  const workspaceRoot = asNonEmptyString(process.env.OFFISIM_WORKSPACE_ROOT);
  if (!workspaceRoot) {
    throw Object.assign(new Error('OFFISIM_WORKSPACE_ROOT is not set for the trusted host.'), {
      code: 'host-unavailable',
    });
  }
  return workspaceRoot;
}

function injectedApiKeyOrUndefined() {
  return (
    asNonEmptyString(process.env.ANTHROPIC_API_KEY) ??
    asNonEmptyString(process.env.ANTHROPIC_AUTH_TOKEN)
  );
}

async function loadClaudeAdapter(workspaceRoot) {
  const adapterUrl = pathToFileURL(
    resolve(workspaceRoot, 'packages/core/dist/llm/claude-agent-sdk-adapter.js'),
  ).href;
  const module = await import(adapterUrl);
  return module.ClaudeAgentSdkAdapter;
}

async function main() {
  const workspaceRoot = workspaceRootFromEnv();
  const raw = await readStdin();
  const payload = raw.trim() ? JSON.parse(raw) : {};
  if (!payload || typeof payload !== 'object' || !payload.request) {
    throw Object.assign(new Error('Trusted host payload is missing request JSON.'), {
      code: 'invalid-request',
    });
  }

  const ClaudeAgentSdkAdapter = await loadClaudeAdapter(workspaceRoot);
  const adapter = new ClaudeAgentSdkAdapter(injectedApiKeyOrUndefined(), {
    baseURL: asNonEmptyString(process.env.ANTHROPIC_BASE_URL),
    cwd: asNonEmptyString(payload.cwd) ?? workspaceRoot,
    pathToClaudeCodeExecutable: asNonEmptyString(process.env.OFFISIM_CLAUDE_CODE_EXECUTABLE),
  });

  try {
    const response = await adapter.chat(payload.request);
    process.stdout.write(JSON.stringify({ ok: true, response }));
  } finally {
    adapter.dispose();
  }
}

main().catch((error) => {
  const status =
    typeof error === 'object' && error && 'status' in error && typeof error.status === 'number'
      ? error.status
      : undefined;
  const source =
    typeof error === 'object' && error && 'source' in error && typeof error.source === 'string'
      ? error.source
      : undefined;
  const code =
    typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'unknown';
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  process.stdout.write(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message,
        ...(typeof status === 'number' ? { status } : {}),
        ...(source ? { source } : {}),
      },
    }),
  );
  process.exit(1);
});
