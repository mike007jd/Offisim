import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HumanMessage } from '@langchain/core/messages';
import type { ModelPolicyConfig } from '@offisim/shared-types';
import { describe } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { buildOffisimGraph } from '../../graph/main-graph.js';
import { createGateway } from '../../llm/gateway-factory.js';
import { ModelResolver } from '../../llm/model-resolver.js';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import { makeEmployee } from '../helpers/fixtures.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadDotEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  const file = readFileSync(filePath, 'utf8');
  for (const rawLine of file.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
      continue;
    }

    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/gu, '');
    process.env[key] = value;
  }
}

loadDotEnvFile(path.resolve(__dirname, '../../../../../.env.local'));

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY?.trim() ?? '';
const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/anthropic';
const MINIMAX_MODEL = process.env.MINIMAX_MODEL ?? 'MiniMax-M2.7-highspeed';

if (!MINIMAX_API_KEY) {
  console.warn(
    '[ai-tests] Skipping packages/core AI behavior tests because MINIMAX_API_KEY is missing in .env.local.',
  );
}

export const describeIfMinimax = describe.skipIf(!MINIMAX_API_KEY);

export function requireMinimaxKey(): string {
  return MINIMAX_API_KEY;
}

export function createAiRuntime() {
  const companyId = 'c-ai-runtime-smoke';
  const threadId = `t-ai-runtime-smoke-${Date.now()}`;
  const policy: ModelPolicyConfig = {
    default: {
      profileName: 'ai-smoke',
      provider: 'anthropic',
      model: MINIMAX_MODEL,
      temperature: 0.2,
      maxTokens: 4096,
    },
  };

  const repos = createMemoryRepositories();
  const eventBus = new InMemoryEventBus();
  const toolExecutor = new MockToolExecutor();
  const llmGateway = createGateway({
    provider: 'anthropic',
    apiKey: MINIMAX_API_KEY,
    baseURL: MINIMAX_BASE_URL,
  });

  repos.seed.companies([
    {
      company_id: companyId,
      name: 'AI Runtime Smoke Co',
      status: 'active',
      workspace_root: null,
      default_model_policy_json: JSON.stringify(policy),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]);
  repos.seed.employees([
    makeEmployee({
      company_id: companyId,
      employee_id: 'e-ai-dev-1',
      name: 'Runtime Smoke Dev',
      role_slug: 'developer',
      persona_json: JSON.stringify({
        expertise: 'runtime smoke testing',
        tone: 'brief and direct',
      }),
    }),
  ]);

  const runtimeCtx = createRuntimeContext({
    repos,
    eventBus,
    llmGateway,
    modelResolver: new ModelResolver(policy),
    toolExecutor,
    companyId,
    threadId,
  });
  const graph = buildOffisimGraph();

  return {
    companyId,
    threadId,
    async runSmokeTask(prompt: string): Promise<string> {
      const result = await graph.invoke(
        {
          threadId,
          companyId,
          entryMode: 'direct_chat',
          targetEmployeeId: 'e-ai-dev-1',
          messages: [new HumanMessage(prompt)],
        },
        { configurable: { thread_id: threadId, runtimeCtx } },
      );

      const reply = result.messages
        .filter((message) => message._getType() === 'ai')
        .map((message) => (typeof message.content === 'string' ? message.content : ''))
        .find((message) => message.trim().length > 0);

      if (!reply) {
        throw new Error('Runtime smoke test completed without a non-empty AI reply.');
      }

      return reply;
    },
  };
}
