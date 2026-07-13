#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

const tools = [
  {
    name: 'computer_screenshot',
    description: 'Return a scripted desktop screenshot for Offisim Computer Use verification.',
    inputSchema: {
      type: 'object',
      properties: {
        targetApp: { type: 'string' },
        targetWindow: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'computer_click',
    description: 'Record a scripted click action with coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        targetApp: { type: 'string' },
      },
      required: ['x', 'y'],
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: 'computer_type',
    description: 'Record scripted typing and optionally write an artifact file.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        artifactPath: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: false },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
}

function textBlock(text) {
  return { type: 'text', text };
}

function imageBlock() {
  return { type: 'image', mimeType: 'image/png', data: PNG_1X1 };
}

function safeArtifactPath(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const resolved = path.resolve(process.cwd(), raw);
  const relative = path.relative(process.cwd(), resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

function callTool(name, args) {
  if (name === 'computer_screenshot') {
    return {
      content: [
        textBlock(
          JSON.stringify({
            computer: {
              action: 'screenshot',
              targetApp: args.targetApp ?? 'Mock Desktop',
              targetWindow: args.targetWindow ?? 'Verification Window',
              resultState: 'ok',
            },
          }),
        ),
        imageBlock(),
      ],
    };
  }
  if (name === 'computer_click') {
    return {
      content: [
        textBlock(
          JSON.stringify({
            computer: {
              action: 'click',
              targetApp: args.targetApp ?? 'Mock Desktop',
              coordinates: { x: Number(args.x ?? 0), y: Number(args.y ?? 0) },
              resultState: 'ok',
            },
          }),
        ),
        imageBlock(),
      ],
    };
  }
  if (name === 'computer_type') {
    const artifact = safeArtifactPath(args.artifactPath);
    if (artifact) {
      fs.mkdirSync(path.dirname(artifact), { recursive: true });
      fs.writeFileSync(
        artifact,
        `Mock Computer Use artifact\n${String(args.text ?? '')}\n`,
        'utf8',
      );
    }
    return {
      content: [
        textBlock(
          JSON.stringify({
            computer: {
              action: 'type',
              targetApp: args.targetApp ?? 'Mock Desktop',
              textPreview: String(args.text ?? '').slice(0, 160),
              resultState: args.sensitive ? 'pending' : 'ok',
              artifactPaths: artifact ? [artifact] : [],
            },
          }),
        ),
        imageBlock(),
      ],
      isError: Boolean(args.sensitive),
    };
  }
  return {
    content: [textBlock(`Unknown mock computer tool: ${name}`)],
    isError: true,
  };
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

rl.on('line', (line) => {
  if (!line.trim()) return;
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = request;
  if (method === 'initialize') {
    send({
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'offisim-mock-computer-use', version: '1.0.0' },
      },
    });
    return;
  }
  if (method === 'notifications/initialized') return;
  if (method === 'tools/list') {
    send({ id, result: { tools } });
    return;
  }
  if (method === 'tools/call') {
    const result = callTool(params?.name, params?.arguments ?? {});
    send({ id, result });
    return;
  }
  send({ id, error: { code: -32601, message: `Unsupported method: ${method}` } });
});
