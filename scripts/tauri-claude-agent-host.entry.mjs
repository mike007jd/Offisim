#!/usr/bin/env node

import { ClaudeAgentSdkAdapter } from '../packages/core/src/llm/claude-agent-sdk-adapter.ts';

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

function injectedApiKey() {
  const apiKey =
    asNonEmptyString(process.env.ANTHROPIC_API_KEY) ??
    asNonEmptyString(process.env.ANTHROPIC_AUTH_TOKEN);
  if (!apiKey) {
    throw Object.assign(
      new Error('No Anthropic credential was injected into the trusted Claude lane host.'),
      { code: 'no-credential' },
    );
  }
  return apiKey;
}

async function main() {
  const raw = await readStdin();
  const payload = raw.trim() ? JSON.parse(raw) : {};
  if (!payload || typeof payload !== 'object' || !payload.request) {
    throw Object.assign(new Error('Trusted host payload is missing request JSON.'), {
      code: 'invalid-request',
    });
  }

  const adapter = new ClaudeAgentSdkAdapter(injectedApiKey(), {
    baseURL: asNonEmptyString(process.env.ANTHROPIC_BASE_URL),
    cwd: asNonEmptyString(payload.cwd) ?? process.cwd(),
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
