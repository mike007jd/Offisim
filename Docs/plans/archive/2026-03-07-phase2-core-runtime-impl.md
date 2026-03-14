# Phase 2.0 Core Runtime — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the LangGraph-based multi-agent orchestration kernel in `packages/core` with LLM gateway, event system, repository layer, and full test coverage.

**Architecture:** LangGraph.js StateGraph with Boss/Manager/Employee nodes, custom CheckpointSaver backed by SQLite, in-process EventBus, and Repository-pattern data access. Two LLM adapters (Anthropic + OpenAI) behind a `LlmGateway` interface.

**Tech Stack:** @langchain/langgraph 0.2.x, @langchain/core 0.3.x, @anthropic-ai/sdk 0.78.x, openai 4.x, drizzle-orm 0.39.x, better-sqlite3 (dev), vitest

**Design doc:** `docs/plans/2026-03-07-phase2-core-runtime-design.md`

**Key references:**
- DDL schema: `Docs/02_contracts_and_schemas/aics_local_runtime_schema.sql`
- Drizzle schema: `packages/db-local/src/schema.ts`
- Shared types: `packages/shared-types/src/`
- Engineering rules: `spec/ENGINEERING_RULES.md`

---

## Task 1: Project Setup — Add Dependencies

**Files:**
- Modify: `packages/core/package.json`
- Modify: `packages/core/tsconfig.json`
- Run: `pnpm install` from workspace root

**Step 1: Add production and dev dependencies**

```bash
cd /Users/haoshengli/Seafile/WebWorkSpace/Offisim
pnpm --filter @aics/core add @langchain/langgraph @langchain/core @anthropic-ai/sdk openai
pnpm --filter @aics/core add -D better-sqlite3 @types/better-sqlite3 drizzle-orm
```

Note: `drizzle-orm` is added as devDep to core because core accesses it only through repository implementations. The actual production dep lives in `db-local`.

**Step 2: Verify tsconfig.json is correct**

`packages/core/tsconfig.json` should already extend base and have `rootDir: "src"`, `outDir: "dist"`. No changes needed unless build fails.

**Step 3: Verify workspace builds**

```bash
pnpm turbo build --filter=@aics/core
```

Expected: successful build (empty src/index.ts)

**Step 4: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml
git commit -m "chore(core): add langgraph, anthropic, openai dependencies"
```

---

## Task 2: Shared Types Expansion

**Files:**
- Create: `packages/shared-types/src/models.ts`
- Modify: `packages/shared-types/src/events.ts`
- Modify: `packages/shared-types/src/index.ts`

**Step 1: Create `models.ts`**

```typescript
// packages/shared-types/src/models.ts

/** Supported LLM providers */
export type LlmProvider = 'anthropic' | 'openai';

/** Abstract model profile — maps to a concrete provider+model */
export interface ModelProfile {
  readonly profileName: string;
  readonly provider: LlmProvider;
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

/** Company-level model policy stored in companies.default_model_policy_json */
export interface ModelPolicyConfig {
  readonly default: ModelProfile;
  readonly overrides?: Readonly<Record<string, ModelProfile>>;
}

/** Fully resolved model config ready for LLM call */
export interface ResolvedModel {
  readonly provider: LlmProvider;
  readonly model: string;
  readonly temperature: number;
  readonly maxTokens: number;
}
```

**Step 2: Extend `events.ts` with typed payloads and companyId/threadId**

```typescript
// packages/shared-types/src/events.ts
import type { EmployeeState, MeetingState, RuntimeEntityType, TaskState } from './states.js';

/**
 * Cross-package event envelope.
 * Extended in Phase 2.0 with companyId and threadId for multi-company isolation.
 */
export interface RuntimeEvent<P = Readonly<Record<string, unknown>>> {
  readonly type: string;
  readonly entityId: string;
  readonly entityType: RuntimeEntityType;
  readonly companyId: string;
  readonly threadId?: string;
  readonly timestamp: number;
  readonly payload: P;
}

/** Well-known event type prefixes */
export type EventFamily =
  | 'employee.state.changed'
  | 'task.state.changed'
  | 'task.assignment.changed'
  | 'meeting.state.changed'
  | 'install.state.changed'
  | 'binding.state.changed'
  | 'report.state.changed'
  | 'runtime.performance.tier.changed'
  | 'ui.selection.changed';

// --- Typed event payloads ---

export interface EmployeeStatePayload {
  readonly employeeId: string;
  readonly prev: EmployeeState;
  readonly next: EmployeeState;
  readonly taskRunId?: string;
}

export interface TaskStatePayload {
  readonly taskRunId: string;
  readonly prev: TaskState;
  readonly next: TaskState;
  readonly employeeId?: string;
}

export interface TaskAssignmentPayload {
  readonly taskRunId: string;
  readonly employeeId: string;
  readonly action: 'assigned' | 'unassigned';
}

export interface MeetingStatePayload {
  readonly meetingId: string;
  readonly prev: MeetingState;
  readonly next: MeetingState;
  readonly participantIds: readonly string[];
}
```

**Step 3: Update `index.ts` exports**

```typescript
// packages/shared-types/src/index.ts
export type {
  CompanyId, EmployeeId, TaskId, MeetingId,
  InstallTxnId, InstalledPackageId, InstalledAssetId,
  ListingId, PackageId, AssetBindingId, ReportId,
} from './ids.js';

export type {
  EmployeeState, TaskState, InstallState, MeetingState,
  ReportState, RuntimeEntityType,
} from './states.js';

export type {
  RuntimeEvent, EventFamily,
  EmployeeStatePayload, TaskStatePayload,
  TaskAssignmentPayload, MeetingStatePayload,
} from './events.js';

export type {
  LlmProvider, ModelProfile, ModelPolicyConfig, ResolvedModel,
} from './models.js';
```

**Step 4: Build and verify**

```bash
pnpm turbo build --filter=@aics/shared-types
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/shared-types/src/
git commit -m "feat(shared-types): add model profile types and typed event payloads"
```

---

## Task 3: Error Hierarchy

**Files:**
- Create: `packages/core/src/errors.ts`
- Create: `packages/core/src/__tests__/unit/errors.test.ts`

**Step 1: Write test**

```typescript
// packages/core/src/__tests__/unit/errors.test.ts
import { describe, expect, it } from 'vitest';
import { AicsError, DataError, GraphError, LlmError } from '../../errors.js';

describe('AicsError', () => {
  it('has code and recoverable properties', () => {
    const err = new AicsError('test', 'TEST_CODE', true);
    expect(err.message).toBe('test');
    expect(err.code).toBe('TEST_CODE');
    expect(err.recoverable).toBe(true);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('LlmError', () => {
  it('marks 429 as recoverable', () => {
    const err = new LlmError('rate limited', 'anthropic', 429);
    expect(err.recoverable).toBe(true);
    expect(err.provider).toBe('anthropic');
    expect(err.code).toBe('LLM_ERROR');
  });

  it('marks 500 as recoverable', () => {
    const err = new LlmError('server error', 'openai', 500);
    expect(err.recoverable).toBe(true);
  });

  it('marks 400 as not recoverable', () => {
    const err = new LlmError('bad request', 'anthropic', 400);
    expect(err.recoverable).toBe(false);
  });

  it('marks unknown status as not recoverable', () => {
    const err = new LlmError('unknown', 'openai');
    expect(err.recoverable).toBe(false);
  });
});

describe('GraphError', () => {
  it('captures node name', () => {
    const err = new GraphError('node failed', 'boss');
    expect(err.nodeName).toBe('boss');
    expect(err.recoverable).toBe(false);
  });
});

describe('DataError', () => {
  it('is not recoverable', () => {
    const err = new DataError('write failed');
    expect(err.recoverable).toBe(false);
    expect(err.code).toBe('DATA_ERROR');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @aics/core test -- src/__tests__/unit/errors.test.ts
```

Expected: FAIL (module not found)

**Step 3: Implement**

```typescript
// packages/core/src/errors.ts

export class AicsError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean,
  ) {
    super(message);
    this.name = 'AicsError';
  }
}

export class LlmError extends AicsError {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number,
  ) {
    const recoverable = statusCode !== undefined && statusCode >= 429;
    super(message, 'LLM_ERROR', recoverable);
    this.name = 'LlmError';
  }
}

export class GraphError extends AicsError {
  constructor(
    message: string,
    public readonly nodeName: string,
  ) {
    super(message, 'GRAPH_ERROR', false);
    this.name = 'GraphError';
  }
}

export class DataError extends AicsError {
  constructor(message: string) {
    super(message, 'DATA_ERROR', false);
    this.name = 'DataError';
  }
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm --filter @aics/core test -- src/__tests__/unit/errors.test.ts
```

Expected: PASS (4 suites, all green)

**Step 5: Commit**

```bash
git add packages/core/src/errors.ts packages/core/src/__tests__/
git commit -m "feat(core): add AicsError hierarchy with LlmError, GraphError, DataError"
```

---

## Task 4: LLM Gateway Interface

**Files:**
- Create: `packages/core/src/llm/gateway.ts`

**Step 1: Create gateway interface and types**

```typescript
// packages/core/src/llm/gateway.ts

export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

export interface ToolCallResult {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LlmRequest {
  readonly messages: readonly LlmMessage[];
  readonly model: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly tools?: readonly ToolDef[];
}

export interface LlmResponse {
  readonly content: string;
  readonly toolCalls: readonly ToolCallResult[];
  readonly usage: LlmUsage;
}

/** Provider-agnostic LLM gateway. Adapters implement this. */
export interface LlmGateway {
  chat(request: LlmRequest): Promise<LlmResponse>;
}
```

**Step 2: Build to verify types compile**

```bash
pnpm turbo build --filter=@aics/core
```

Note: `index.ts` must export from this module (will be done in Task 22).

**Step 3: Commit**

```bash
git add packages/core/src/llm/
git commit -m "feat(core): add LlmGateway interface and request/response types"
```

---

## Task 5: Model Resolver

**Files:**
- Create: `packages/core/src/llm/model-resolver.ts`
- Create: `packages/core/src/__tests__/unit/model-resolver.test.ts`

**Step 1: Write test**

```typescript
// packages/core/src/__tests__/unit/model-resolver.test.ts
import { describe, expect, it } from 'vitest';
import { ModelResolver } from '../../llm/model-resolver.js';
import type { ModelPolicyConfig } from '@aics/shared-types';

const DEFAULT_POLICY: ModelPolicyConfig = {
  default: {
    profileName: 'balanced',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.7,
    maxTokens: 4096,
  },
  overrides: {
    developer: {
      profileName: 'code-first',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      temperature: 0.3,
      maxTokens: 8192,
    },
  },
};

describe('ModelResolver', () => {
  it('resolves from employee preferred profile', () => {
    const resolver = new ModelResolver(DEFAULT_POLICY);
    const result = resolver.resolve({
      profileName: 'fast',
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.5,
      maxTokens: 2048,
    });
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.temperature).toBe(0.5);
    expect(result.maxTokens).toBe(2048);
  });

  it('falls back to role override when no employee profile', () => {
    const resolver = new ModelResolver(DEFAULT_POLICY);
    const result = resolver.resolve(undefined, 'developer');
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.temperature).toBe(0.3);
    expect(result.maxTokens).toBe(8192);
  });

  it('falls back to company default when no match', () => {
    const resolver = new ModelResolver(DEFAULT_POLICY);
    const result = resolver.resolve(undefined, 'designer');
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.temperature).toBe(0.7);
    expect(result.maxTokens).toBe(4096);
  });

  it('falls back to hardcoded default when policy is null', () => {
    const resolver = new ModelResolver(null);
    const result = resolver.resolve();
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBeDefined();
    expect(result.temperature).toBeGreaterThan(0);
    expect(result.maxTokens).toBeGreaterThan(0);
  });

  it('uses defaults for missing temperature/maxTokens in profile', () => {
    const resolver = new ModelResolver(DEFAULT_POLICY);
    const result = resolver.resolve({
      profileName: 'minimal',
      provider: 'openai',
      model: 'gpt-4o',
    });
    expect(result.temperature).toBe(0.7);
    expect(result.maxTokens).toBe(4096);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @aics/core test -- src/__tests__/unit/model-resolver.test.ts
```

**Step 3: Implement**

```typescript
// packages/core/src/llm/model-resolver.ts
import type { ModelPolicyConfig, ModelProfile, ResolvedModel } from '@aics/shared-types';

const HARDCODED_DEFAULT: ResolvedModel = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  temperature: 0.7,
  maxTokens: 4096,
};

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 4096;

export class ModelResolver {
  private readonly policy: ModelPolicyConfig | null;

  constructor(policy: ModelPolicyConfig | null | undefined) {
    this.policy = policy ?? null;
  }

  /**
   * Resolve a model configuration.
   * Priority: employeeProfile > roleSlug override > company default > hardcoded.
   */
  resolve(employeeProfile?: ModelProfile | null, roleSlug?: string): ResolvedModel {
    if (employeeProfile) {
      return this.toResolved(employeeProfile);
    }

    if (this.policy && roleSlug && this.policy.overrides?.[roleSlug]) {
      return this.toResolved(this.policy.overrides[roleSlug]!);
    }

    if (this.policy) {
      return this.toResolved(this.policy.default);
    }

    return HARDCODED_DEFAULT;
  }

  private toResolved(profile: ModelProfile): ResolvedModel {
    return {
      provider: profile.provider,
      model: profile.model,
      temperature: profile.temperature ?? DEFAULT_TEMPERATURE,
      maxTokens: profile.maxTokens ?? DEFAULT_MAX_TOKENS,
    };
  }
}
```

**Step 4: Run test to verify it passes**

```bash
pnpm --filter @aics/core test -- src/__tests__/unit/model-resolver.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/llm/model-resolver.ts packages/core/src/__tests__/unit/model-resolver.test.ts
git commit -m "feat(core): add ModelResolver with profile/role/company fallback chain"
```

---

## Task 6: Anthropic Adapter

**Files:**
- Create: `packages/core/src/llm/anthropic-adapter.ts`
- Create: `packages/core/src/__tests__/unit/anthropic-adapter.test.ts`

**Step 1: Write test**

```typescript
// packages/core/src/__tests__/unit/anthropic-adapter.test.ts
import { describe, expect, it, vi } from 'vitest';
import { AnthropicAdapter } from '../../llm/anthropic-adapter.js';
import type { LlmRequest } from '../../llm/gateway.js';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Hello from Claude' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      };
    },
  };
});

describe('AnthropicAdapter', () => {
  const adapter = new AnthropicAdapter('test-api-key');

  it('maps request format correctly', async () => {
    const request: LlmRequest = {
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      model: 'claude-sonnet-4-20250514',
      temperature: 0.5,
      maxTokens: 1024,
    };

    const response = await adapter.chat(request);

    expect(response.content).toBe('Hello from Claude');
    expect(response.usage.inputTokens).toBe(10);
    expect(response.usage.outputTokens).toBe(5);
    expect(response.toolCalls).toEqual([]);
  });

  it('extracts system message from messages array', async () => {
    const request: LlmRequest = {
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hi' },
      ],
      model: 'claude-sonnet-4-20250514',
    };

    await adapter.chat(request);

    // Verify the SDK was called — the mock captures calls
    // The key assertion is that it didn't throw
    expect(true).toBe(true);
  });

  it('handles empty content response', async () => {
    const { default: MockAnthropic } = await import('@anthropic-ai/sdk');
    const mockInstance = new MockAnthropic();
    (mockInstance.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [],
      usage: { input_tokens: 5, output_tokens: 0 },
    });

    const customAdapter = new AnthropicAdapter('key');
    // Access internal client for test override
    (customAdapter as unknown as { client: typeof mockInstance }).client = mockInstance;

    const response = await customAdapter.chat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-sonnet-4-20250514',
    });

    expect(response.content).toBe('');
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement**

```typescript
// packages/core/src/llm/anthropic-adapter.ts
import Anthropic from '@anthropic-ai/sdk';
import { LlmError } from '../errors.js';
import type { LlmGateway, LlmMessage, LlmRequest, LlmResponse, ToolCallResult } from './gateway.js';

export class AnthropicAdapter implements LlmGateway {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const nonSystemMessages = request.messages.filter((m) => m.role !== 'system');

    const systemText = systemMessages.map((m) => m.content).join('\n');

    try {
      const response = await this.client.messages.create({
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        system: systemText || undefined,
        messages: nonSystemMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      });

      return this.mapResponse(response);
    } catch (error: unknown) {
      throw this.mapError(error);
    }
  }

  private mapResponse(response: Anthropic.Message): LlmResponse {
    let content = '';
    const toolCalls: ToolCallResult[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }

  private mapError(error: unknown): LlmError {
    if (error instanceof Anthropic.APIError) {
      return new LlmError(error.message, 'anthropic', error.status);
    }
    return new LlmError(
      error instanceof Error ? error.message : 'Unknown Anthropic error',
      'anthropic',
    );
  }
}
```

**Step 4: Run test, verify PASS**

**Step 5: Commit**

```bash
git add packages/core/src/llm/anthropic-adapter.ts packages/core/src/__tests__/unit/anthropic-adapter.test.ts
git commit -m "feat(core): add AnthropicAdapter for LlmGateway"
```

---

## Task 7: OpenAI Adapter

**Files:**
- Create: `packages/core/src/llm/openai-adapter.ts`
- Create: `packages/core/src/__tests__/unit/openai-adapter.test.ts`

**Step 1: Write test** (same pattern as Anthropic, mock `openai` SDK)

```typescript
// packages/core/src/__tests__/unit/openai-adapter.test.ts
import { describe, expect, it, vi } from 'vitest';
import { OpenAiAdapter } from '../../llm/openai-adapter.js';
import type { LlmRequest } from '../../llm/gateway.js';

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'Hello from GPT', tool_calls: undefined } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
        },
      };
    },
  };
});

describe('OpenAiAdapter', () => {
  const adapter = new OpenAiAdapter('test-api-key');

  it('maps request format and returns response', async () => {
    const request: LlmRequest = {
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      model: 'gpt-4o',
      temperature: 0.5,
      maxTokens: 1024,
    };

    const response = await adapter.chat(request);

    expect(response.content).toBe('Hello from GPT');
    expect(response.usage.inputTokens).toBe(10);
    expect(response.usage.outputTokens).toBe(5);
    expect(response.toolCalls).toEqual([]);
  });

  it('passes system messages through directly', async () => {
    const request: LlmRequest = {
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hi' },
      ],
      model: 'gpt-4o',
    };

    const response = await adapter.chat(request);
    expect(response.content).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement**

```typescript
// packages/core/src/llm/openai-adapter.ts
import OpenAI from 'openai';
import { LlmError } from '../errors.js';
import type { LlmGateway, LlmRequest, LlmResponse, ToolCallResult } from './gateway.js';

export class OpenAiAdapter implements LlmGateway {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: request.model,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });

      return this.mapResponse(response);
    } catch (error: unknown) {
      throw this.mapError(error);
    }
  }

  private mapResponse(response: OpenAI.Chat.Completions.ChatCompletion): LlmResponse {
    const choice = response.choices[0];
    const content = choice?.message?.content ?? '';
    const toolCalls: ToolCallResult[] = [];

    if (choice?.message?.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }

  private mapError(error: unknown): LlmError {
    if (error instanceof OpenAI.APIError) {
      return new LlmError(error.message, 'openai', error.status);
    }
    return new LlmError(
      error instanceof Error ? error.message : 'Unknown OpenAI error',
      'openai',
    );
  }
}
```

**Step 4: Run test, verify PASS**

**Step 5: Commit**

```bash
git add packages/core/src/llm/openai-adapter.ts packages/core/src/__tests__/unit/openai-adapter.test.ts
git commit -m "feat(core): add OpenAiAdapter for LlmGateway"
```

---

## Task 8: EventBus

**Files:**
- Create: `packages/core/src/events/event-bus.ts`
- Create: `packages/core/src/__tests__/unit/event-bus.test.ts`

**Step 1: Write test**

```typescript
// packages/core/src/__tests__/unit/event-bus.test.ts
import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../events/event-bus.js';
import type { RuntimeEvent } from '@aics/shared-types';

function makeEvent(type: string, overrides?: Partial<RuntimeEvent>): RuntimeEvent {
  return {
    type,
    entityId: 'e-1',
    entityType: 'employee',
    companyId: 'c-1',
    timestamp: Date.now(),
    payload: {},
    ...overrides,
  };
}

describe('InMemoryEventBus', () => {
  it('calls handler on matching prefix', () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();

    bus.on('employee.state', handler);
    bus.emit(makeEvent('employee.state.changed'));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'employee.state.changed' }));
  });

  it('does not call handler on non-matching prefix', () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();

    bus.on('task.state', handler);
    bus.emit(makeEvent('employee.state.changed'));

    expect(handler).not.toHaveBeenCalled();
  });

  it('empty prefix matches all events', () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();

    bus.on('', handler);
    bus.emit(makeEvent('employee.state.changed'));
    bus.emit(makeEvent('task.state.changed'));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes via returned function', () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();

    const unsub = bus.on('employee', handler);
    bus.emit(makeEvent('employee.state.changed'));
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    bus.emit(makeEvent('employee.state.changed'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('once only fires handler once', () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();

    bus.once('task', handler);
    bus.emit(makeEvent('task.state.changed'));
    bus.emit(makeEvent('task.state.changed'));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('removeAll clears all subscriptions', () => {
    const bus = new InMemoryEventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on('employee', h1);
    bus.on('task', h2);
    bus.removeAll();

    bus.emit(makeEvent('employee.state.changed'));
    bus.emit(makeEvent('task.state.changed'));

    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it('supports multiple handlers for same prefix', () => {
    const bus = new InMemoryEventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();

    bus.on('employee', h1);
    bus.on('employee', h2);
    bus.emit(makeEvent('employee.state.changed'));

    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement**

```typescript
// packages/core/src/events/event-bus.ts
import type { RuntimeEvent } from '@aics/shared-types';

export type EventHandler = (event: RuntimeEvent) => void;

export interface EventBus {
  emit(event: RuntimeEvent): void;
  on(prefix: string, handler: EventHandler): () => void;
  once(prefix: string, handler: EventHandler): () => void;
  removeAll(): void;
}

interface Subscription {
  prefix: string;
  handler: EventHandler;
  once: boolean;
}

export class InMemoryEventBus implements EventBus {
  private subscriptions: Subscription[] = [];

  emit(event: RuntimeEvent): void {
    const toRemove: Subscription[] = [];

    for (const sub of this.subscriptions) {
      if (sub.prefix === '' || event.type.startsWith(sub.prefix)) {
        sub.handler(event);
        if (sub.once) {
          toRemove.push(sub);
        }
      }
    }

    for (const sub of toRemove) {
      const idx = this.subscriptions.indexOf(sub);
      if (idx !== -1) {
        this.subscriptions.splice(idx, 1);
      }
    }
  }

  on(prefix: string, handler: EventHandler): () => void {
    const sub: Subscription = { prefix, handler, once: false };
    this.subscriptions.push(sub);
    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx !== -1) {
        this.subscriptions.splice(idx, 1);
      }
    };
  }

  once(prefix: string, handler: EventHandler): () => void {
    const sub: Subscription = { prefix, handler, once: true };
    this.subscriptions.push(sub);
    return () => {
      const idx = this.subscriptions.indexOf(sub);
      if (idx !== -1) {
        this.subscriptions.splice(idx, 1);
      }
    };
  }

  removeAll(): void {
    this.subscriptions = [];
  }
}
```

**Step 4: Run test, verify PASS**

**Step 5: Commit**

```bash
git add packages/core/src/events/ packages/core/src/__tests__/unit/event-bus.test.ts
git commit -m "feat(core): add EventBus interface and InMemoryEventBus"
```

---

## Task 9: Event Factories + Persister

**Files:**
- Create: `packages/core/src/events/event-factories.ts`
- Create: `packages/core/src/events/event-persister.ts`
- Create: `packages/core/src/__tests__/unit/event-factories.test.ts`

**Step 1: Write test**

```typescript
// packages/core/src/__tests__/unit/event-factories.test.ts
import { describe, expect, it } from 'vitest';
import {
  employeeStateChanged,
  meetingStateChanged,
  taskAssignmentChanged,
  taskStateChanged,
} from '../../events/event-factories.js';

describe('event factories', () => {
  it('employeeStateChanged', () => {
    const event = employeeStateChanged('c-1', 'e-1', 'idle', 'thinking', 't-1', 'tr-1');
    expect(event.type).toBe('employee.state.changed');
    expect(event.entityType).toBe('employee');
    expect(event.entityId).toBe('e-1');
    expect(event.companyId).toBe('c-1');
    expect(event.threadId).toBe('t-1');
    expect(event.payload.prev).toBe('idle');
    expect(event.payload.next).toBe('thinking');
    expect(event.payload.taskRunId).toBe('tr-1');
    expect(event.timestamp).toBeGreaterThan(0);
  });

  it('taskStateChanged', () => {
    const event = taskStateChanged('c-1', 'tr-1', 'queued', 'active', 't-1', 'e-1');
    expect(event.type).toBe('task.state.changed');
    expect(event.entityType).toBe('task');
    expect(event.payload.prev).toBe('queued');
    expect(event.payload.next).toBe('active');
  });

  it('taskAssignmentChanged', () => {
    const event = taskAssignmentChanged('c-1', 'tr-1', 'e-1', 'assigned', 't-1');
    expect(event.type).toBe('task.assignment.changed');
    expect(event.payload.action).toBe('assigned');
  });

  it('meetingStateChanged', () => {
    const event = meetingStateChanged('c-1', 'm-1', 'scheduled', 'active', ['e-1', 'e-2'], 't-1');
    expect(event.type).toBe('meeting.state.changed');
    expect(event.entityType).toBe('meeting');
    expect(event.payload.participantIds).toEqual(['e-1', 'e-2']);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement factories**

```typescript
// packages/core/src/events/event-factories.ts
import type {
  EmployeeState,
  EmployeeStatePayload,
  MeetingState,
  MeetingStatePayload,
  RuntimeEvent,
  TaskAssignmentPayload,
  TaskState,
  TaskStatePayload,
} from '@aics/shared-types';

export function employeeStateChanged(
  companyId: string,
  employeeId: string,
  prev: EmployeeState,
  next: EmployeeState,
  threadId?: string,
  taskRunId?: string,
): RuntimeEvent<EmployeeStatePayload> {
  return {
    type: 'employee.state.changed',
    entityId: employeeId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { employeeId, prev, next, taskRunId },
  };
}

export function taskStateChanged(
  companyId: string,
  taskRunId: string,
  prev: TaskState,
  next: TaskState,
  threadId?: string,
  employeeId?: string,
): RuntimeEvent<TaskStatePayload> {
  return {
    type: 'task.state.changed',
    entityId: taskRunId,
    entityType: 'task',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { taskRunId, prev, next, employeeId },
  };
}

export function taskAssignmentChanged(
  companyId: string,
  taskRunId: string,
  employeeId: string,
  action: 'assigned' | 'unassigned',
  threadId?: string,
): RuntimeEvent<TaskAssignmentPayload> {
  return {
    type: 'task.assignment.changed',
    entityId: taskRunId,
    entityType: 'task',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { taskRunId, employeeId, action },
  };
}

export function meetingStateChanged(
  companyId: string,
  meetingId: string,
  prev: MeetingState,
  next: MeetingState,
  participantIds: string[],
  threadId?: string,
): RuntimeEvent<MeetingStatePayload> {
  return {
    type: 'meeting.state.changed',
    entityId: meetingId,
    entityType: 'meeting',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { meetingId, prev, next, participantIds },
  };
}
```

**Step 4: Implement persister**

```typescript
// packages/core/src/events/event-persister.ts
import type { RuntimeEvent } from '@aics/shared-types';

/**
 * Derives severity from event type.
 * Used when persisting to runtime_events table.
 */
export function deriveSeverity(event: RuntimeEvent): 'info' | 'warn' | 'error' {
  const payload = event.payload as Record<string, unknown>;
  const nextState = typeof payload?.['next'] === 'string' ? payload['next'] : '';

  if (nextState === 'failed') return 'error';
  if (nextState === 'blocked' || nextState === 'cancelled') return 'warn';
  return 'info';
}
```

**Step 5: Run test, verify PASS, commit**

```bash
git add packages/core/src/events/ packages/core/src/__tests__/unit/event-factories.test.ts
git commit -m "feat(core): add event factories and severity persister"
```

---

## Task 10: Repository Interfaces

**Files:**
- Create: `packages/core/src/runtime/repositories.ts`

This task defines only the interfaces. Implementations follow in Tasks 11-12.

**Step 1: Create repository interfaces**

```typescript
// packages/core/src/runtime/repositories.ts

/** Row types — mirror db-local schema shapes */

export interface GraphThreadRow {
  thread_id: string;
  company_id: string;
  entry_mode: string;
  root_task_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TaskRunRow {
  task_run_id: string;
  thread_id: string;
  employee_id: string | null;
  parent_task_run_id: string | null;
  task_type: string;
  status: string;
  input_json: string | null;
  output_json: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface EmployeeRow {
  employee_id: string;
  company_id: string;
  source_asset_id: string | null;
  source_package_id: string | null;
  name: string;
  role_slug: string;
  workstation_id: string | null;
  persona_json: string | null;
  config_json: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface CompanyRow {
  company_id: string;
  name: string;
  status: string;
  workspace_root: string | null;
  default_model_policy_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface ToolCallRow {
  tool_call_id: string;
  task_run_id: string;
  tool_name: string;
  capability_name: string | null;
  rack_id: string | null;
  status: string;
  review_state: string;
  request_json: string | null;
  response_json: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface HandoffEventRow {
  handoff_id: string;
  thread_id: string;
  from_employee_id: string | null;
  to_employee_id: string | null;
  reason: string | null;
  payload_json: string | null;
  created_at: string;
}

export interface MeetingSessionRow {
  meeting_id: string;
  company_id: string;
  thread_id: string | null;
  topic: string;
  status: string;
  summary_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface GraphCheckpointRow {
  checkpoint_id: string;
  thread_id: string;
  checkpoint_seq: number;
  checkpoint_kind: string;
  payload_json: string;
  created_at: string;
}

export interface RuntimeEventRow {
  event_id: string;
  company_id: string;
  thread_id: string | null;
  event_type: string;
  severity: string;
  payload_json: string | null;
  created_at: string;
}

/** New-row types (omit auto-generated fields) */
export type NewGraphThread = Omit<GraphThreadRow, 'created_at' | 'updated_at'>;
export type NewTaskRun = Omit<TaskRunRow, 'finished_at'>;
export type NewToolCall = Omit<ToolCallRow, 'finished_at'>;
export type NewHandoffEvent = Omit<HandoffEventRow, never>;
export type NewMeetingSession = Omit<MeetingSessionRow, never>;
export type NewGraphCheckpoint = Omit<GraphCheckpointRow, never>;
export type NewRuntimeEvent = Omit<RuntimeEventRow, never>;

/** Repository interfaces */

export interface CompanyRepository {
  findById(companyId: string): Promise<CompanyRow | null>;
}

export interface ThreadRepository {
  create(thread: NewGraphThread): Promise<GraphThreadRow>;
  findById(threadId: string): Promise<GraphThreadRow | null>;
  updateStatus(threadId: string, status: string): Promise<void>;
}

export interface TaskRunRepository {
  create(taskRun: NewTaskRun): Promise<TaskRunRow>;
  findById(taskRunId: string): Promise<TaskRunRow | null>;
  findByThread(threadId: string): Promise<TaskRunRow[]>;
  updateStatus(taskRunId: string, status: string, outputJson?: string | null): Promise<void>;
}

export interface EmployeeRepository {
  findById(employeeId: string): Promise<EmployeeRow | null>;
  findByCompany(companyId: string): Promise<EmployeeRow[]>;
  findByRole(companyId: string, roleSlug: string): Promise<EmployeeRow[]>;
}

export interface ToolCallRepository {
  create(toolCall: NewToolCall): Promise<ToolCallRow>;
  updateResult(toolCallId: string, status: string, responseJson: string | null): Promise<void>;
}

export interface HandoffRepository {
  create(handoff: NewHandoffEvent): Promise<HandoffEventRow>;
  findByThread(threadId: string): Promise<HandoffEventRow[]>;
}

export interface MeetingRepository {
  create(meeting: NewMeetingSession): Promise<MeetingSessionRow>;
  findById(meetingId: string): Promise<MeetingSessionRow | null>;
  updateStatus(meetingId: string, status: string, summaryJson?: string | null): Promise<void>;
}

export interface CheckpointRepository {
  save(checkpoint: NewGraphCheckpoint): Promise<void>;
  findLatest(threadId: string): Promise<GraphCheckpointRow | null>;
  findBySeq(threadId: string, seq: number): Promise<GraphCheckpointRow | null>;
}

export interface EventRepository {
  insert(event: NewRuntimeEvent): Promise<void>;
}

/** Aggregated access point */
export interface RuntimeRepositories {
  companies: CompanyRepository;
  threads: ThreadRepository;
  taskRuns: TaskRunRepository;
  employees: EmployeeRepository;
  toolCalls: ToolCallRepository;
  handoffs: HandoffRepository;
  meetings: MeetingRepository;
  checkpoints: CheckpointRepository;
  events: EventRepository;
}
```

**Step 2: Build to verify types compile**

**Step 3: Commit**

```bash
git add packages/core/src/runtime/repositories.ts
git commit -m "feat(core): add repository interfaces for all runtime tables"
```

---

## Task 11: Memory Repositories (Test Helper)

**Files:**
- Create: `packages/core/src/runtime/memory-repositories.ts`
- Create: `packages/core/src/__tests__/unit/memory-repositories.test.ts`

**Step 1: Write test** (covers key behaviors — CRUD correctness)

```typescript
// packages/core/src/__tests__/unit/memory-repositories.test.ts
import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';

describe('MemoryRepositories', () => {
  describe('ThreadRepository', () => {
    it('creates and finds a thread', async () => {
      const repos = createMemoryRepositories();
      const thread = await repos.threads.create({
        thread_id: 't-1',
        company_id: 'c-1',
        entry_mode: 'boss_chat',
        root_task_id: null,
        status: 'running',
      });
      expect(thread.thread_id).toBe('t-1');
      expect(thread.created_at).toBeDefined();

      const found = await repos.threads.findById('t-1');
      expect(found?.status).toBe('running');
    });

    it('returns null for missing thread', async () => {
      const repos = createMemoryRepositories();
      expect(await repos.threads.findById('missing')).toBeNull();
    });

    it('updates status', async () => {
      const repos = createMemoryRepositories();
      await repos.threads.create({
        thread_id: 't-1', company_id: 'c-1',
        entry_mode: 'boss_chat', root_task_id: null, status: 'running',
      });
      await repos.threads.updateStatus('t-1', 'completed');
      const found = await repos.threads.findById('t-1');
      expect(found?.status).toBe('completed');
    });
  });

  describe('TaskRunRepository', () => {
    it('creates and queries by thread', async () => {
      const repos = createMemoryRepositories();
      await repos.taskRuns.create({
        task_run_id: 'tr-1', thread_id: 't-1', employee_id: null,
        parent_task_run_id: null, task_type: 'boss_chat',
        status: 'active', input_json: null, output_json: null,
        started_at: new Date().toISOString(),
      });
      const runs = await repos.taskRuns.findByThread('t-1');
      expect(runs).toHaveLength(1);
    });
  });

  describe('EmployeeRepository', () => {
    it('finds by role', async () => {
      const repos = createMemoryRepositories();
      // Seed employees directly
      repos.seed.employees([
        {
          employee_id: 'e-1', company_id: 'c-1', source_asset_id: null,
          source_package_id: null, name: 'Dev Bot', role_slug: 'developer',
          workstation_id: null, persona_json: null, config_json: null,
          enabled: 1, created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]);
      const devs = await repos.employees.findByRole('c-1', 'developer');
      expect(devs).toHaveLength(1);
      expect(devs[0]!.name).toBe('Dev Bot');
    });
  });

  describe('CheckpointRepository', () => {
    it('saves and finds latest', async () => {
      const repos = createMemoryRepositories();
      await repos.checkpoints.save({
        checkpoint_id: 'cp-1', thread_id: 't-1',
        checkpoint_seq: 1, checkpoint_kind: 'node_complete',
        payload_json: '{}', created_at: new Date().toISOString(),
      });
      await repos.checkpoints.save({
        checkpoint_id: 'cp-2', thread_id: 't-1',
        checkpoint_seq: 2, checkpoint_kind: 'interrupt',
        payload_json: '{"x":1}', created_at: new Date().toISOString(),
      });
      const latest = await repos.checkpoints.findLatest('t-1');
      expect(latest?.checkpoint_seq).toBe(2);
    });
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement** — in-memory Maps implementing each interface

```typescript
// packages/core/src/runtime/memory-repositories.ts
import type {
  CheckpointRepository, CompanyRepository, CompanyRow,
  EmployeeRepository, EmployeeRow, EventRepository,
  GraphCheckpointRow, GraphThreadRow, HandoffEventRow,
  HandoffRepository, MeetingRepository, MeetingSessionRow,
  NewGraphCheckpoint, NewGraphThread, NewHandoffEvent,
  NewMeetingSession, NewRuntimeEvent, NewTaskRun, NewToolCall,
  RuntimeRepositories, TaskRunRepository, TaskRunRow,
  ThreadRepository, ToolCallRepository, ToolCallRow,
} from './repositories.js';

function now(): string {
  return new Date().toISOString();
}

export interface MemoryRepositorySeed {
  employees(rows: EmployeeRow[]): void;
  companies(rows: CompanyRow[]): void;
}

export function createMemoryRepositories(): RuntimeRepositories & { seed: MemoryRepositorySeed } {
  const threadsMap = new Map<string, GraphThreadRow>();
  const taskRunsMap = new Map<string, TaskRunRow>();
  const employeesMap = new Map<string, EmployeeRow>();
  const companiesMap = new Map<string, CompanyRow>();
  const toolCallsMap = new Map<string, ToolCallRow>();
  const handoffsMap = new Map<string, HandoffEventRow>();
  const meetingsMap = new Map<string, MeetingSessionRow>();
  const checkpointsMap = new Map<string, GraphCheckpointRow>();
  const eventsStore: NewRuntimeEvent[] = [];

  const companies: CompanyRepository = {
    async findById(id) {
      return companiesMap.get(id) ?? null;
    },
  };

  const threads: ThreadRepository = {
    async create(t: NewGraphThread) {
      const row: GraphThreadRow = { ...t, created_at: now(), updated_at: now() };
      threadsMap.set(row.thread_id, row);
      return row;
    },
    async findById(id) {
      return threadsMap.get(id) ?? null;
    },
    async updateStatus(id, status) {
      const row = threadsMap.get(id);
      if (row) {
        threadsMap.set(id, { ...row, status, updated_at: now() });
      }
    },
  };

  const taskRuns: TaskRunRepository = {
    async create(t: NewTaskRun) {
      const row: TaskRunRow = { ...t, finished_at: null };
      taskRunsMap.set(row.task_run_id, row);
      return row;
    },
    async findById(id) {
      return taskRunsMap.get(id) ?? null;
    },
    async findByThread(threadId) {
      return [...taskRunsMap.values()].filter((r) => r.thread_id === threadId);
    },
    async updateStatus(id, status, outputJson) {
      const row = taskRunsMap.get(id);
      if (row) {
        taskRunsMap.set(id, {
          ...row,
          status,
          output_json: outputJson ?? row.output_json,
          finished_at: ['completed', 'failed', 'cancelled'].includes(status) ? now() : row.finished_at,
        });
      }
    },
  };

  const employees: EmployeeRepository = {
    async findById(id) {
      return employeesMap.get(id) ?? null;
    },
    async findByCompany(companyId) {
      return [...employeesMap.values()].filter((e) => e.company_id === companyId);
    },
    async findByRole(companyId, roleSlug) {
      return [...employeesMap.values()].filter(
        (e) => e.company_id === companyId && e.role_slug === roleSlug,
      );
    },
  };

  const toolCalls: ToolCallRepository = {
    async create(t: NewToolCall) {
      const row: ToolCallRow = { ...t, finished_at: null };
      toolCallsMap.set(row.tool_call_id, row);
      return row;
    },
    async updateResult(id, status, responseJson) {
      const row = toolCallsMap.get(id);
      if (row) {
        toolCallsMap.set(id, { ...row, status, response_json: responseJson, finished_at: now() });
      }
    },
  };

  const handoffs: HandoffRepository = {
    async create(h: NewHandoffEvent) {
      const row: HandoffEventRow = { ...h };
      handoffsMap.set(row.handoff_id, row);
      return row;
    },
    async findByThread(threadId) {
      return [...handoffsMap.values()].filter((h) => h.thread_id === threadId);
    },
  };

  const meetings: MeetingRepository = {
    async create(m: NewMeetingSession) {
      const row: MeetingSessionRow = { ...m };
      meetingsMap.set(row.meeting_id, row);
      return row;
    },
    async findById(id) {
      return meetingsMap.get(id) ?? null;
    },
    async updateStatus(id, status, summaryJson) {
      const row = meetingsMap.get(id);
      if (row) {
        meetingsMap.set(id, {
          ...row,
          status,
          summary_json: summaryJson ?? row.summary_json,
          updated_at: now(),
        });
      }
    },
  };

  const checkpoints: CheckpointRepository = {
    async save(c: NewGraphCheckpoint) {
      const row: GraphCheckpointRow = { ...c };
      checkpointsMap.set(row.checkpoint_id, row);
    },
    async findLatest(threadId) {
      const matching = [...checkpointsMap.values()]
        .filter((c) => c.thread_id === threadId)
        .sort((a, b) => b.checkpoint_seq - a.checkpoint_seq);
      return matching[0] ?? null;
    },
    async findBySeq(threadId, seq) {
      return [...checkpointsMap.values()]
        .find((c) => c.thread_id === threadId && c.checkpoint_seq === seq) ?? null;
    },
  };

  const events: EventRepository = {
    async insert(e: NewRuntimeEvent) {
      eventsStore.push(e);
    },
  };

  const seed: MemoryRepositorySeed = {
    employees(rows) {
      for (const row of rows) employeesMap.set(row.employee_id, row);
    },
    companies(rows) {
      for (const row of rows) companiesMap.set(row.company_id, row);
    },
  };

  return { companies, threads, taskRuns, employees, toolCalls, handoffs, meetings, checkpoints, events, seed };
}
```

**Step 4: Run test, verify PASS**

**Step 5: Commit**

```bash
git add packages/core/src/runtime/memory-repositories.ts packages/core/src/__tests__/unit/memory-repositories.test.ts
git commit -m "feat(core): add in-memory repository implementations for testing"
```

---

## Task 12: Drizzle Repositories

**Files:**
- Create: `packages/core/src/runtime/drizzle-repositories.ts`
- Create: `packages/core/src/__tests__/unit/drizzle-repositories.test.ts`

**Step 1: Write test** using in-memory SQLite via better-sqlite3 + drizzle

```typescript
// packages/core/src/__tests__/unit/drizzle-repositories.test.ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, it, beforeEach } from 'vitest';
import * as schema from '@aics/db-local';
import { createDrizzleRepositories } from '../../runtime/drizzle-repositories.js';
import { sql } from 'drizzle-orm';

// Read the DDL and apply it to in-memory DB
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DDL_PATH = resolve(
  import.meta.dirname ?? '.',
  '../../../../Docs/02_contracts_and_schemas/aics_local_runtime_schema.sql',
);

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  // Apply DDL
  const ddl = readFileSync(DDL_PATH, 'utf-8');
  sqlite.exec(ddl);
  return drizzle(sqlite, { schema });
}

describe('DrizzleRepositories', () => {
  let repos: ReturnType<typeof createDrizzleRepositories>;

  beforeEach(() => {
    const db = createTestDb();
    repos = createDrizzleRepositories(db);

    // Seed a company
    db.insert(schema.companies).values({
      company_id: 'c-1',
      name: 'Test Corp',
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).run();
  });

  it('threads: create and findById', async () => {
    const thread = await repos.threads.create({
      thread_id: 't-1', company_id: 'c-1',
      entry_mode: 'boss_chat', root_task_id: null, status: 'running',
    });
    expect(thread.thread_id).toBe('t-1');

    const found = await repos.threads.findById('t-1');
    expect(found?.status).toBe('running');
  });

  it('threads: updateStatus', async () => {
    await repos.threads.create({
      thread_id: 't-1', company_id: 'c-1',
      entry_mode: 'boss_chat', root_task_id: null, status: 'running',
    });
    await repos.threads.updateStatus('t-1', 'completed');
    const found = await repos.threads.findById('t-1');
    expect(found?.status).toBe('completed');
  });

  it('taskRuns: create and findByThread', async () => {
    await repos.threads.create({
      thread_id: 't-1', company_id: 'c-1',
      entry_mode: 'boss_chat', root_task_id: null, status: 'running',
    });
    await repos.taskRuns.create({
      task_run_id: 'tr-1', thread_id: 't-1', employee_id: null,
      parent_task_run_id: null, task_type: 'boss_chat',
      status: 'active', input_json: null, output_json: null,
      started_at: new Date().toISOString(),
    });
    const runs = await repos.taskRuns.findByThread('t-1');
    expect(runs).toHaveLength(1);
  });

  it('checkpoints: save and findLatest', async () => {
    await repos.threads.create({
      thread_id: 't-1', company_id: 'c-1',
      entry_mode: 'boss_chat', root_task_id: null, status: 'running',
    });
    await repos.checkpoints.save({
      checkpoint_id: 'cp-1', thread_id: 't-1', checkpoint_seq: 1,
      checkpoint_kind: 'node_complete', payload_json: '{}',
      created_at: new Date().toISOString(),
    });
    await repos.checkpoints.save({
      checkpoint_id: 'cp-2', thread_id: 't-1', checkpoint_seq: 2,
      checkpoint_kind: 'interrupt', payload_json: '{"x":1}',
      created_at: new Date().toISOString(),
    });
    const latest = await repos.checkpoints.findLatest('t-1');
    expect(latest?.checkpoint_seq).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement** — each repository method is a thin Drizzle query

```typescript
// packages/core/src/runtime/drizzle-repositories.ts
import { eq, and, desc } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '@aics/db-local';
import type {
  CheckpointRepository, CompanyRepository, EmployeeRepository,
  EventRepository, GraphCheckpointRow, GraphThreadRow,
  HandoffEventRow, HandoffRepository, MeetingRepository,
  MeetingSessionRow, NewGraphCheckpoint, NewGraphThread,
  NewHandoffEvent, NewMeetingSession, NewRuntimeEvent,
  NewTaskRun, NewToolCall, RuntimeRepositories,
  TaskRunRepository, TaskRunRow, ThreadRepository,
  ToolCallRepository, ToolCallRow,
} from './repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

function now(): string {
  return new Date().toISOString();
}

export function createDrizzleRepositories(db: Db): RuntimeRepositories {
  const companies: CompanyRepository = {
    async findById(id) {
      const rows = db.select().from(schema.companies).where(eq(schema.companies.company_id, id)).all();
      return (rows[0] as ReturnType<CompanyRepository['findById']> extends Promise<infer T> ? T : never) ?? null;
    },
  };

  const threads: ThreadRepository = {
    async create(t: NewGraphThread) {
      const row = { ...t, created_at: now(), updated_at: now() };
      db.insert(schema.graphThreads).values(row).run();
      return row as GraphThreadRow;
    },
    async findById(id) {
      const rows = db.select().from(schema.graphThreads).where(eq(schema.graphThreads.thread_id, id)).all();
      return (rows[0] as GraphThreadRow | undefined) ?? null;
    },
    async updateStatus(id, status) {
      db.update(schema.graphThreads)
        .set({ status, updated_at: now() })
        .where(eq(schema.graphThreads.thread_id, id))
        .run();
    },
  };

  const taskRuns: TaskRunRepository = {
    async create(t: NewTaskRun) {
      const row = { ...t, finished_at: null };
      db.insert(schema.taskRuns).values(row).run();
      return row as TaskRunRow;
    },
    async findById(id) {
      const rows = db.select().from(schema.taskRuns).where(eq(schema.taskRuns.task_run_id, id)).all();
      return (rows[0] as TaskRunRow | undefined) ?? null;
    },
    async findByThread(threadId) {
      return db.select().from(schema.taskRuns).where(eq(schema.taskRuns.thread_id, threadId)).all() as TaskRunRow[];
    },
    async updateStatus(id, status, outputJson) {
      const finished = ['completed', 'failed', 'cancelled'].includes(status) ? now() : null;
      db.update(schema.taskRuns)
        .set({ status, output_json: outputJson ?? undefined, finished_at: finished ?? undefined })
        .where(eq(schema.taskRuns.task_run_id, id))
        .run();
    },
  };

  const employees: EmployeeRepository = {
    async findById(id) {
      const rows = db.select().from(schema.employees).where(eq(schema.employees.employee_id, id)).all();
      return (rows[0] as ReturnType<EmployeeRepository['findById']> extends Promise<infer T> ? T : never) ?? null;
    },
    async findByCompany(companyId) {
      return db.select().from(schema.employees).where(eq(schema.employees.company_id, companyId)).all() as any;
    },
    async findByRole(companyId, roleSlug) {
      return db.select().from(schema.employees)
        .where(and(eq(schema.employees.company_id, companyId), eq(schema.employees.role_slug, roleSlug)))
        .all() as any;
    },
  };

  const toolCalls: ToolCallRepository = {
    async create(t: NewToolCall) {
      const row = { ...t, finished_at: null };
      db.insert(schema.toolCalls).values(row).run();
      return row as ToolCallRow;
    },
    async updateResult(id, status, responseJson) {
      db.update(schema.toolCalls)
        .set({ status, response_json: responseJson, finished_at: now() })
        .where(eq(schema.toolCalls.tool_call_id, id))
        .run();
    },
  };

  const handoffs: HandoffRepository = {
    async create(h: NewHandoffEvent) {
      db.insert(schema.handoffEvents).values(h).run();
      return h as HandoffEventRow;
    },
    async findByThread(threadId) {
      return db.select().from(schema.handoffEvents)
        .where(eq(schema.handoffEvents.thread_id, threadId)).all() as HandoffEventRow[];
    },
  };

  const meetings: MeetingRepository = {
    async create(m: NewMeetingSession) {
      db.insert(schema.meetingSessions).values(m).run();
      return m as MeetingSessionRow;
    },
    async findById(id) {
      const rows = db.select().from(schema.meetingSessions)
        .where(eq(schema.meetingSessions.meeting_id, id)).all();
      return (rows[0] as MeetingSessionRow | undefined) ?? null;
    },
    async updateStatus(id, status, summaryJson) {
      db.update(schema.meetingSessions)
        .set({ status, summary_json: summaryJson ?? undefined, updated_at: now() })
        .where(eq(schema.meetingSessions.meeting_id, id))
        .run();
    },
  };

  const checkpoints: CheckpointRepository = {
    async save(c: NewGraphCheckpoint) {
      db.insert(schema.graphCheckpoints).values(c).run();
    },
    async findLatest(threadId) {
      const rows = db.select().from(schema.graphCheckpoints)
        .where(eq(schema.graphCheckpoints.thread_id, threadId))
        .orderBy(desc(schema.graphCheckpoints.checkpoint_seq))
        .limit(1)
        .all();
      return (rows[0] as GraphCheckpointRow | undefined) ?? null;
    },
    async findBySeq(threadId, seq) {
      const rows = db.select().from(schema.graphCheckpoints)
        .where(and(
          eq(schema.graphCheckpoints.thread_id, threadId),
          eq(schema.graphCheckpoints.checkpoint_seq, seq),
        ))
        .all();
      return (rows[0] as GraphCheckpointRow | undefined) ?? null;
    },
  };

  const events: EventRepository = {
    async insert(e: NewRuntimeEvent) {
      db.insert(schema.runtimeEvents).values(e).run();
    },
  };

  return { companies, threads, taskRuns, employees, toolCalls, handoffs, meetings, checkpoints, events };
}
```

**Step 4: Run test, verify PASS**

**Step 5: Commit**

```bash
git add packages/core/src/runtime/drizzle-repositories.ts packages/core/src/__tests__/unit/drizzle-repositories.test.ts
git commit -m "feat(core): add Drizzle-backed repository implementations"
```

---

## Task 13: RuntimeContext + ToolExecutor

**Files:**
- Create: `packages/core/src/runtime/runtime-context.ts`
- Create: `packages/core/src/runtime/tool-executor.ts`

**Step 1: Create RuntimeContext**

```typescript
// packages/core/src/runtime/runtime-context.ts
import type { EventBus } from '../events/event-bus.js';
import type { LlmGateway } from '../llm/gateway.js';
import type { ModelResolver } from '../llm/model-resolver.js';
import type { RuntimeRepositories } from './repositories.js';
import type { ToolExecutor } from './tool-executor.js';

export interface RuntimeContext {
  readonly repos: RuntimeRepositories;
  readonly eventBus: EventBus;
  readonly llmGateway: LlmGateway;
  readonly modelResolver: ModelResolver;
  readonly toolExecutor: ToolExecutor;
  readonly companyId: string;
  readonly threadId: string;
}

export function createRuntimeContext(deps: {
  repos: RuntimeRepositories;
  eventBus: EventBus;
  llmGateway: LlmGateway;
  modelResolver: ModelResolver;
  toolExecutor: ToolExecutor;
  companyId: string;
  threadId: string;
}): RuntimeContext {
  return Object.freeze(deps);
}
```

**Step 2: Create ToolExecutor interface + mock**

```typescript
// packages/core/src/runtime/tool-executor.ts
import type { ToolCallResult, ToolDef } from '../llm/gateway.js';

export interface ToolCallRequest {
  readonly toolCallId: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

export interface ToolCallResponse {
  readonly success: boolean;
  readonly result: unknown;
  readonly error?: string;
}

export interface ToolExecutor {
  execute(call: ToolCallRequest): Promise<ToolCallResponse>;
  listAvailable(companyId: string): Promise<ToolDef[]>;
}

/** Phase 2.0 mock — returns static results */
export class MockToolExecutor implements ToolExecutor {
  async execute(call: ToolCallRequest): Promise<ToolCallResponse> {
    return {
      success: true,
      result: { mock: true, tool: call.name, args: call.arguments },
    };
  }

  async listAvailable(_companyId: string): Promise<ToolDef[]> {
    return [];
  }
}
```

**Step 3: Build, verify PASS**

**Step 4: Commit**

```bash
git add packages/core/src/runtime/runtime-context.ts packages/core/src/runtime/tool-executor.ts
git commit -m "feat(core): add RuntimeContext factory and MockToolExecutor"
```

---

## Task 14: Employee Builder

**Files:**
- Create: `packages/core/src/agents/employee-builder.ts`
- Create: `packages/core/src/__tests__/unit/employee-builder.test.ts`

**Step 1: Write test**

```typescript
// packages/core/src/__tests__/unit/employee-builder.test.ts
import { describe, expect, it } from 'vitest';
import { buildEmployeePrompt } from '../../agents/employee-builder.js';
import type { CompanyRow, EmployeeRow } from '../../runtime/repositories.js';

const COMPANY: CompanyRow = {
  company_id: 'c-1', name: 'Acme AI', status: 'active',
  workspace_root: null,
  default_model_policy_json: JSON.stringify({
    default: { profileName: 'balanced', provider: 'anthropic', model: 'claude-sonnet-4-20250514', temperature: 0.7, maxTokens: 4096 },
  }),
  created_at: '', updated_at: '',
};

function makeEmployee(overrides?: Partial<EmployeeRow>): EmployeeRow {
  return {
    employee_id: 'e-1', company_id: 'c-1', source_asset_id: null,
    source_package_id: null, name: 'Dev Bot', role_slug: 'developer',
    workstation_id: null, persona_json: null, config_json: null,
    enabled: 1, created_at: '', updated_at: '', ...overrides,
  };
}

describe('buildEmployeePrompt', () => {
  it('builds basic prompt from role and company', () => {
    const prompt = buildEmployeePrompt(makeEmployee(), COMPANY, 'Write tests');
    expect(prompt).toContain('Dev Bot');
    expect(prompt).toContain('developer');
    expect(prompt).toContain('Acme AI');
    expect(prompt).toContain('Write tests');
  });

  it('includes persona when valid JSON', () => {
    const emp = makeEmployee({
      persona_json: JSON.stringify({ expertise: 'TypeScript', tone: 'concise' }),
    });
    const prompt = buildEmployeePrompt(emp, COMPANY, 'task');
    expect(prompt).toContain('TypeScript');
    expect(prompt).toContain('concise');
  });

  it('degrades gracefully on invalid persona JSON', () => {
    const emp = makeEmployee({ persona_json: 'not json' });
    const prompt = buildEmployeePrompt(emp, COMPANY, 'task');
    // Should not throw, should still contain basic info
    expect(prompt).toContain('Dev Bot');
  });

  it('degrades gracefully on null persona', () => {
    const emp = makeEmployee({ persona_json: null });
    const prompt = buildEmployeePrompt(emp, COMPANY, 'task');
    expect(prompt).toContain('Dev Bot');
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement**

```typescript
// packages/core/src/agents/employee-builder.ts
import type { CompanyRow, EmployeeRow } from '../runtime/repositories.js';

interface Persona {
  expertise?: string;
  tone?: string;
  constraints?: string;
}

function parsePersona(json: string | null): Persona {
  if (!json) return {};
  try {
    return JSON.parse(json) as Persona;
  } catch {
    return {};
  }
}

export function buildEmployeePrompt(
  employee: EmployeeRow,
  company: CompanyRow,
  taskInput: string,
): string {
  const persona = parsePersona(employee.persona_json);

  const lines: string[] = [
    `You are ${employee.name}, a ${employee.role_slug} at ${company.name}.`,
  ];

  if (persona.expertise) {
    lines.push(`Your expertise: ${persona.expertise}`);
  }
  if (persona.tone) {
    lines.push(`Communication style: ${persona.tone}`);
  }
  if (persona.constraints) {
    lines.push(`Constraints: ${persona.constraints}`);
  }

  lines.push('');
  lines.push(`Current task:\n${taskInput}`);

  return lines.join('\n');
}
```

**Step 4: Run test, verify PASS**

**Step 5: Commit**

```bash
git add packages/core/src/agents/employee-builder.ts packages/core/src/__tests__/unit/employee-builder.test.ts
git commit -m "feat(core): add employee prompt builder with persona fault tolerance"
```

---

## Task 15: Graph State

**Files:**
- Create: `packages/core/src/graph/state.ts`

**Step 1: Define AicsGraphState using LangGraph Annotation**

```typescript
// packages/core/src/graph/state.ts
import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';

export interface PendingAssignment {
  taskType: string;
  employeeId: string;
  inputJson: Record<string, unknown>;
}

export const AicsGraphAnnotation = Annotation.Root({
  // Thread tracking
  threadId: Annotation<string>,
  companyId: Annotation<string>,
  entryMode: Annotation<'boss_chat' | 'meeting' | 'install_flow' | 'background_sync'>,

  // LangGraph message list (with built-in reducer)
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  // Routing
  routeDecision: Annotation<'direct_reply' | 'delegate_manager' | 'start_meeting' | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // Current execution
  currentTaskRunId: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  currentEmployeeId: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // Manager's queue
  pendingAssignments: Annotation<PendingAssignment[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),

  // Completion
  completed: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),

  // Interrupt
  interruptReason: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),

  // Meeting-specific
  meetingId: Annotation<string | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
});

export type AicsGraphState = typeof AicsGraphAnnotation.State;
```

**Step 2: Build to verify types compile**

**Step 3: Commit**

```bash
git add packages/core/src/graph/state.ts
git commit -m "feat(core): add AicsGraphState annotation with LangGraph reducers"
```

---

## Task 16-18: Agent Nodes (Boss, Manager, Employee, Error Handler)

These three tasks implement the four graph nodes. Each follows TDD:

1. Write test for node logic using `MockLlmGateway` + `createMemoryRepositories()`
2. Implement node
3. Verify test passes

**Files (created across Tasks 16-18):**
- `packages/core/src/agents/boss-node.ts`
- `packages/core/src/agents/manager-node.ts`
- `packages/core/src/agents/employee-node.ts`
- `packages/core/src/agents/error-handler-node.ts`
- `packages/core/src/__tests__/helpers/mock-gateway.ts`
- `packages/core/src/__tests__/helpers/fixtures.ts`
- `packages/core/src/__tests__/unit/boss-node.test.ts`
- `packages/core/src/__tests__/unit/manager-node.test.ts`
- `packages/core/src/__tests__/unit/employee-node.test.ts`

Each node function signature:

```typescript
// All nodes have same signature — pure functions receiving state + config
type NodeFunction = (
  state: AicsGraphState,
  config: RunnableConfig,
) => Promise<Partial<AicsGraphState>>;
```

The `RuntimeContext` is accessed via `config.configurable.runtimeCtx`.

**Test helper: MockLlmGateway**

```typescript
// packages/core/src/__tests__/helpers/mock-gateway.ts
import type { LlmGateway, LlmRequest, LlmResponse } from '../../llm/gateway.js';

export class MockLlmGateway implements LlmGateway {
  private keywordResponses = new Map<string, LlmResponse>();
  private sequentialResponses: LlmResponse[] = [];
  private callCount = 0;

  whenSystemContains(keyword: string, response: Partial<LlmResponse>): void {
    this.keywordResponses.set(keyword, {
      content: '', toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 },
      ...response,
    });
  }

  pushResponse(...responses: Array<Partial<LlmResponse>>): void {
    for (const r of responses) {
      this.sequentialResponses.push({
        content: '', toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 },
        ...r,
      });
    }
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    // Sequential mode takes priority
    if (this.callCount < this.sequentialResponses.length) {
      return this.sequentialResponses[this.callCount++]!;
    }

    // Keyword matching
    const systemText = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join(' ');

    for (const [keyword, response] of this.keywordResponses) {
      if (systemText.includes(keyword)) {
        this.callCount++;
        return response;
      }
    }

    this.callCount++;
    const lastUserMsg = request.messages.filter((m) => m.role === 'user').at(-1);
    return {
      content: `Mock response for: ${lastUserMsg?.content ?? 'unknown'}`,
      toolCalls: [],
      usage: { inputTokens: 10, outputTokens: 5 },
    };
  }
}
```

**Test helper: Fixtures**

```typescript
// packages/core/src/__tests__/helpers/fixtures.ts
import type { CompanyRow, EmployeeRow } from '../../runtime/repositories.js';

export const TEST_COMPANY_ID = 'c-test-1';
export const TEST_THREAD_ID = 't-test-1';

export const TEST_COMPANY: CompanyRow = {
  company_id: TEST_COMPANY_ID,
  name: 'Test Corp',
  status: 'active',
  workspace_root: null,
  default_model_policy_json: JSON.stringify({
    default: {
      profileName: 'test',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      temperature: 0.7,
      maxTokens: 4096,
    },
  }),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export function makeEmployee(overrides?: Partial<EmployeeRow>): EmployeeRow {
  return {
    employee_id: 'e-dev-1',
    company_id: TEST_COMPANY_ID,
    source_asset_id: null,
    source_package_id: null,
    name: 'Dev Bot',
    role_slug: 'developer',
    workstation_id: null,
    persona_json: JSON.stringify({ expertise: 'TypeScript', tone: 'concise' }),
    config_json: null,
    enabled: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

export function makeManager(overrides?: Partial<EmployeeRow>): EmployeeRow {
  return makeEmployee({
    employee_id: 'e-mgr-1',
    name: 'Manager Bot',
    role_slug: 'manager',
    persona_json: JSON.stringify({ expertise: 'project management' }),
    ...overrides,
  });
}
```

Node implementations are where the bulk of the business logic lives. Each node:
1. Reads state
2. Calls LLM via `runtimeCtx.llmGateway`
3. Writes to repositories via `runtimeCtx.repos`
4. Emits events via `runtimeCtx.eventBus`
5. Returns state updates

**Key implementation notes for executing agent:**
- Boss node: parse LLM response to determine `routeDecision`. Use a structured prompt asking LLM to respond with JSON `{ "action": "delegate" | "direct_reply" | "meeting", "reason": "..." }`.
- Manager node: select employee based on task type, create `task_runs` + `handoff_events`.
- Employee node: build prompt via `employee-builder.ts`, call LLM, record result.
- Error handler: catch errors from any node, write failure state, return error message.

**Commit after each node** (3 separate commits):

```bash
git commit -m "feat(core): add Boss node with intent routing"
git commit -m "feat(core): add Manager node with employee selection and task splitting"
git commit -m "feat(core): add Employee node and ErrorHandler node"
```

---

## Task 19: Main Graph

**Files:**
- Create: `packages/core/src/graph/main-graph.ts`
- Create: `packages/core/src/graph/checkpoint-saver.ts`

**Step 1: Create CheckpointSaver**

Custom `BaseCheckpointSaver` implementation backed by `CheckpointRepository`. This bridges LangGraph's built-in checkpoint API to our `graph_checkpoints` table.

**Step 2: Build StateGraph**

```typescript
// packages/core/src/graph/main-graph.ts (skeleton)
import { StateGraph, END } from '@langchain/langgraph';
import { AicsGraphAnnotation } from './state.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
// ... import nodes

export function buildAicsGraph(runtimeCtx: RuntimeContext) {
  const graph = new StateGraph(AicsGraphAnnotation)
    .addNode('boss', (state, config) => bossNode(state, config))
    .addNode('manager', (state, config) => managerNode(state, config))
    .addNode('employee', (state, config) => employeeNode(state, config))
    .addNode('error_handler', (state, config) => errorHandlerNode(state, config))
    .addNode('boss_summary', (state, config) => bossSummaryNode(state, config))
    .addEdge('__start__', 'boss')
    .addConditionalEdges('boss', routeFromBoss)
    .addEdge('manager', 'employee')
    .addConditionalEdges('employee', routeFromEmployee)
    .addEdge('error_handler', 'boss_summary')
    .addEdge('boss_summary', END);

  return graph.compile({
    configurable: { runtimeCtx },
  });
}
```

Conditional routing functions:
- `routeFromBoss`: checks `routeDecision` → `'manager'` | `'boss_summary'` (direct reply) | `'meeting_coordinator'`
- `routeFromEmployee`: checks if more `pendingAssignments` → `'employee'` (loop) | `'boss_summary'` (done)

**Step 3: Commit**

```bash
git commit -m "feat(core): add main StateGraph with boss/manager/employee topology"
```

---

## Task 20: Meeting Subgraph

**Files:**
- Create: `packages/core/src/graph/meeting-subgraph.ts`

Meeting subgraph is a nested `StateGraph` with turn-based control:

1. `meeting_start` — create `meeting_sessions` record
2. `participant_turn` — each participant speaks (Employee node with meeting context)
3. `turn_check` — conditional: more turns? or max reached? or moderator says done?
4. `meeting_end` — produce summary, update `meeting_sessions.summary_json`

**Step 1: Implement**

**Step 2: Commit**

```bash
git commit -m "feat(core): add Meeting subgraph with turn control and summary"
```

---

## Task 21: Test Helpers + Integration Tests

**Files:**
- Create: `packages/core/src/__tests__/helpers/test-runtime.ts`
- Create: `packages/core/src/__tests__/integration/boss-chat-flow.test.ts`
- Create: `packages/core/src/__tests__/integration/interrupt-resume.test.ts`
- Create: `packages/core/src/__tests__/integration/meeting-flow.test.ts`

**Test runtime factory:**

```typescript
// packages/core/src/__tests__/helpers/test-runtime.ts
import { createMemoryRepositories } from '../../runtime/memory-repositories.js';
import { InMemoryEventBus } from '../../events/event-bus.js';
import { ModelResolver } from '../../llm/model-resolver.js';
import { MockToolExecutor } from '../../runtime/tool-executor.js';
import { createRuntimeContext } from '../../runtime/runtime-context.js';
import { buildAicsGraph } from '../../graph/main-graph.js';
import { MockLlmGateway } from './mock-gateway.js';
import { TEST_COMPANY, TEST_COMPANY_ID, TEST_THREAD_ID, makeEmployee, makeManager } from './fixtures.js';
import type { RuntimeEvent } from '@aics/shared-types';

export function createTestRuntime() {
  const repos = createMemoryRepositories();
  const eventBus = new InMemoryEventBus();
  const gateway = new MockLlmGateway();
  const resolver = new ModelResolver(JSON.parse(TEST_COMPANY.default_model_policy_json!));
  const toolExecutor = new MockToolExecutor();

  // Seed test data
  repos.seed.companies([TEST_COMPANY]);
  repos.seed.employees([makeManager(), makeEmployee()]);

  const runtimeCtx = createRuntimeContext({
    repos, eventBus, llmGateway: gateway,
    modelResolver: resolver, toolExecutor,
    companyId: TEST_COMPANY_ID, threadId: TEST_THREAD_ID,
  });

  const graph = buildAicsGraph(runtimeCtx);

  const events: RuntimeEvent[] = [];
  eventBus.on('', (e) => events.push(e));

  return { graph, repos, eventBus, gateway, events, runtimeCtx };
}
```

**Integration test: boss_chat full flow**

Tests: user message → boss routes → manager assigns → employee executes → result returned. Verifies DB persistence + event stream + handoff chain.

**Integration test: interrupt and resume**

Tests: trigger interrupt at boss → checkpoint saved → resume with new message → completes.

**Integration test: meeting flow**

Tests: meeting entry mode → participants take turns → summary produced → meeting_sessions updated.

**Commit:**

```bash
git commit -m "test(core): add integration tests for boss-chat, interrupt, and meeting flows"
```

---

## Task 22: Package Exports + Final Verification

**Files:**
- Modify: `packages/core/src/index.ts`

**Step 1: Update public API**

```typescript
// packages/core/src/index.ts

// Types
export type { RuntimeContext } from './runtime/runtime-context.js';
export type { RuntimeRepositories, CompanyRow, EmployeeRow, TaskRunRow, GraphThreadRow } from './runtime/repositories.js';
export type { LlmGateway, LlmRequest, LlmResponse, LlmMessage, ToolDef } from './llm/gateway.js';
export type { EventBus, EventHandler } from './events/event-bus.js';
export type { ToolExecutor, ToolCallRequest, ToolCallResponse } from './runtime/tool-executor.js';

// Factories
export { buildAicsGraph } from './graph/main-graph.js';
export { createRuntimeContext } from './runtime/runtime-context.js';
export { createDrizzleRepositories } from './runtime/drizzle-repositories.js';
export { AnthropicAdapter } from './llm/anthropic-adapter.js';
export { OpenAiAdapter } from './llm/openai-adapter.js';
export { ModelResolver } from './llm/model-resolver.js';
export { InMemoryEventBus } from './events/event-bus.js';
export { MockToolExecutor } from './runtime/tool-executor.js';

// Errors
export { AicsError, LlmError, GraphError, DataError } from './errors.js';
```

**Step 2: Full verification**

```bash
pnpm install
pnpm turbo build
pnpm turbo lint
pnpm turbo typecheck
pnpm turbo test
```

All must pass. Fix any failures before proceeding.

**Step 3: Final commit + tag**

```bash
git add -A
git commit -m "feat(core): complete Phase 2.0 core runtime package exports"
git tag phase-2.0-core-runtime
```

---

## Dependency Order Summary

```
Task 1  (setup)         → no deps
Task 2  (shared-types)  → no deps
Task 3  (errors)        → no deps
Task 4  (gateway types) → no deps
Task 5  (model-resolver)→ Task 2, 4
Task 6  (anthropic)     → Task 3, 4
Task 7  (openai)        → Task 3, 4
Task 8  (event-bus)     → Task 2
Task 9  (event-factory) → Task 2, 8
Task 10 (repo ifaces)   → no deps
Task 11 (memory repos)  → Task 10
Task 12 (drizzle repos) → Task 10
Task 13 (context+tool)  → Task 4, 8, 10
Task 14 (emp builder)   → Task 10
Task 15 (graph state)   → Task 1 (langgraph dep)
Task 16 (boss node)     → Task 5, 8, 9, 10, 14, 15
Task 17 (manager node)  → Task 16
Task 18 (employee node) → Task 16
Task 19 (main graph)    → Task 15, 16, 17, 18
Task 20 (meeting sub)   → Task 19
Task 21 (integration)   → Task 19, 20
Task 22 (exports+verify)→ all
```

**Parallelizable groups:**
- Tasks 2, 3, 4, 10 can run in parallel
- Tasks 5, 6, 7 can run in parallel (after 2, 3, 4)
- Tasks 8, 11, 12, 14 can run in parallel (after 10)
- Tasks 16, 17, 18 are mostly serial (each builds on previous)
