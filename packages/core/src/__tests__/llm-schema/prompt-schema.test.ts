/**
 * LLM Prompt Schema Validation Tests
 *
 * These tests call a REAL LLM to verify that critical prompts produce
 * correctly structured output. They are SKIPPED by default unless the
 * LLM_TEST_API_KEY environment variable is set.
 *
 * Usage:
 *   LLM_TEST_API_KEY=sk-xxx pnpm vitest run src/__tests__/llm-schema/
 *   LLM_TEST_API_KEY=sk-xxx LLM_TEST_PROVIDER=anthropic LLM_TEST_MODEL=claude-haiku-4-5 pnpm vitest run src/__tests__/llm-schema/
 *
 * Cost target: < $0.01 per full suite run (uses small inputs + low maxTokens)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { BOSS_SYSTEM_PROMPT } from '../../agents/boss-node.js';
import { MANAGER_SYSTEM_PROMPT } from '../../agents/manager-node.js';
import { PM_SYSTEM_PROMPT } from '../../agents/pm-planner-node.js';
import { createGateway } from '../../llm/gateway-factory.js';
import type { LlmGateway } from '../../llm/gateway.js';
import { extractJsonFromLlm } from '../../utils/extract-json.js';

// ---------------------------------------------------------------------------
// Environment-gated suite — skipped unless LLM_TEST_API_KEY is set
// ---------------------------------------------------------------------------
const API_KEY = process.env.LLM_TEST_API_KEY;
const PROVIDER = (process.env.LLM_TEST_PROVIDER ?? 'openai') as
  | 'openai'
  | 'anthropic'
  | 'openai-compat';
const MODEL = process.env.LLM_TEST_MODEL ?? 'gpt-4o-mini';

const describeWithLlm = API_KEY ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Shared gateway instance
// ---------------------------------------------------------------------------
let gateway: LlmGateway;

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal employees list for PM/manager tests */
const TEST_EMPLOYEES = [
  { id: 'e-dev-1', name: 'Alex', role: 'developer', skills: ['TypeScript', 'React'] },
  { id: 'e-des-1', name: 'Maya', role: 'designer', skills: ['UI', 'Figma'] },
];

/** Employee list formatted the way the actual nodes format it */
const TEST_EMPLOYEE_LIST = TEST_EMPLOYEES.map((e) => `- ${e.id}: ${e.name} (${e.role})`).join('\n');

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describeWithLlm('LLM Prompt Schema Validation (real LLM)', () => {
  beforeAll(() => {
    if (!API_KEY) throw new Error('LLM_TEST_API_KEY not set — this should have been skipped');
    gateway = createGateway({
      provider: PROVIDER,
      apiKey: API_KEY,
      dangerouslyAllowBrowser: false,
      // No retries in tests — fail fast
      retryConfig: { maxRetries: 0, baseDelayMs: 0, maxDelayMs: 0 },
    });
  });

  // -------------------------------------------------------------------------
  // 1. Boss Node — Decision Schema
  // -------------------------------------------------------------------------
  describe('Boss Node', () => {
    it('returns valid decision JSON for a work request', async () => {
      const response = await gateway.chat({
        messages: [
          { role: 'system', content: BOSS_SYSTEM_PROMPT },
          { role: 'user', content: 'Build a mobile app for our product' },
        ],
        model: MODEL,
        temperature: 0,
        maxTokens: 200,
      });

      const parsed = extractJsonFromLlm<Record<string, unknown>>(response.content);
      expect(parsed).not.toBeNull();

      expect(parsed).toHaveProperty('action');
      expect(['delegate', 'direct_reply', 'meeting', 'hire_or_assess']).toContain(parsed?.action);

      // reason is present for all non-direct_reply actions in practice
      if (parsed?.action !== 'direct_reply') {
        expect(typeof parsed?.reason).toBe('string');
      }

      // reply only makes sense for direct_reply
      if (parsed?.action === 'direct_reply') {
        expect(typeof parsed?.reply).toBe('string');
      }
    });

    it('returns valid decision JSON for a simple greeting', async () => {
      const response = await gateway.chat({
        messages: [
          { role: 'system', content: BOSS_SYSTEM_PROMPT },
          { role: 'user', content: 'Hello!' },
        ],
        model: MODEL,
        temperature: 0,
        maxTokens: 150,
      });

      const parsed = extractJsonFromLlm<Record<string, unknown>>(response.content);
      expect(parsed).not.toBeNull();
      expect(['delegate', 'direct_reply', 'meeting', 'hire_or_assess']).toContain(parsed?.action);
    });

    it('detects project intent for complex multi-phase requests', async () => {
      const response = await gateway.chat({
        messages: [
          { role: 'system', content: BOSS_SYSTEM_PROMPT },
          {
            role: 'user',
            content: '我想做一个完整的电商平台，包括商品管理、订单系统、支付集成和用户中心',
          },
        ],
        model: MODEL,
        temperature: 0,
        maxTokens: 300,
      });

      const parsed = extractJsonFromLlm<Record<string, unknown>>(response.content);
      expect(parsed).not.toBeNull();
      expect(parsed?.action).toBe('delegate');
      if (!parsed) {
        throw new Error('Expected valid JSON payload from boss-node response');
      }

      // isNewProject field — if present it must be boolean
      if ('isNewProject' in parsed) {
        expect(typeof parsed?.isNewProject).toBe('boolean');
      }

      // projectName field — if present it must be a non-empty string
      if ('projectName' in parsed) {
        expect(typeof parsed?.projectName).toBe('string');
        expect((parsed?.projectName as string).length).toBeGreaterThan(0);
      }
    });

    it('returns hire_or_assess action for a hiring request', async () => {
      const response = await gateway.chat({
        messages: [
          { role: 'system', content: BOSS_SYSTEM_PROMPT },
          { role: 'user', content: 'We need to hire a senior designer' },
        ],
        model: MODEL,
        temperature: 0,
        maxTokens: 150,
      });

      const parsed = extractJsonFromLlm<Record<string, unknown>>(response.content);
      expect(parsed).not.toBeNull();
      expect(['hire_or_assess', 'delegate']).toContain(parsed?.action);
    });
  });

  // -------------------------------------------------------------------------
  // 2. PM Planner — Plan Schema
  // -------------------------------------------------------------------------
  describe('PM Planner Node', () => {
    it('returns valid plan JSON for a simple landing page request', async () => {
      const systemContent = `${PM_SYSTEM_PROMPT}\n\nAvailable employees:\n${TEST_EMPLOYEE_LIST}`;
      const userContent = `Intent: Build a landing page\nEmployees: ${JSON.stringify(TEST_EMPLOYEES)}`;

      const response = await gateway.chat({
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent },
        ],
        model: MODEL,
        temperature: 0,
        maxTokens: 500,
      });

      const parsed = extractJsonFromLlm<Record<string, unknown>>(response.content);
      expect(parsed).not.toBeNull();

      // Top-level fields
      expect(typeof parsed?.summary).toBe('string');
      expect(Array.isArray(parsed?.steps)).toBe(true);

      const steps = parsed?.steps as unknown[];
      expect(steps.length).toBeGreaterThan(0);

      // Validate each step
      for (const rawStep of steps) {
        const step = rawStep as Record<string, unknown>;
        expect(typeof step.stepIndex).toBe('number');
        expect(typeof step.description).toBe('string');
        expect(Array.isArray(step.tasks)).toBe(true);

        const tasks = step.tasks as unknown[];
        expect(tasks.length).toBeGreaterThan(0);

        // Validate each task
        for (const rawTask of tasks) {
          const task = rawTask as Record<string, unknown>;
          expect(typeof task.taskType).toBe('string');
          expect(typeof task.employeeId).toBe('string');
          expect(typeof task.description).toBe('string');
          expect(typeof task.dependsOnStepOutput).toBe('boolean');
        }
      }
    });

    it('produces phase and dependsOnSteps fields for complex projects', async () => {
      const systemContent = `${PM_SYSTEM_PROMPT}\n\nAvailable employees:\n${TEST_EMPLOYEE_LIST}`;
      const userContent =
        'Intent: Build complete e-commerce platform with research, design, implementation, and testing phases';

      const response = await gateway.chat({
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent },
        ],
        model: MODEL,
        temperature: 0,
        maxTokens: 800,
      });

      const parsed = extractJsonFromLlm<Record<string, unknown>>(response.content);
      expect(parsed).not.toBeNull();
      expect(typeof parsed?.summary).toBe('string');
      expect(Array.isArray(parsed?.steps)).toBe(true);

      const steps = parsed?.steps as Array<Record<string, unknown>>;
      expect(steps.length).toBeGreaterThan(0);

      // Validate optional phase + dependsOnSteps types when present
      for (const step of steps) {
        if (step.phase !== undefined) {
          expect(typeof step.phase).toBe('string');
        }
        if (step.dependsOnSteps !== undefined) {
          expect(Array.isArray(step.dependsOnSteps)).toBe(true);
          for (const dependency of step.dependsOnSteps as unknown[]) {
            expect(typeof dependency).toBe('number');
          }
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // 3. Manager Node — Directive Schema
  // -------------------------------------------------------------------------
  describe('Manager Node', () => {
    it('returns valid directive JSON with assignments array for work request', async () => {
      const systemContent = `${MANAGER_SYSTEM_PROMPT}\n\nAvailable employees:\n${TEST_EMPLOYEE_LIST}`;

      const response = await gateway.chat({
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: 'Write a technical blog post about TypeScript generics' },
        ],
        model: MODEL,
        temperature: 0,
        maxTokens: 300,
      });

      const parsed = extractJsonFromLlm<Record<string, unknown>>(response.content);
      expect(parsed).not.toBeNull();

      // intent field
      expect(typeof parsed?.intent).toBe('string');
      expect(['work', 'hire', 'assess_team']).toContain(parsed?.intent);

      // assignments array
      expect(Array.isArray(parsed?.assignments)).toBe(true);

      // For 'work' intent, there must be at least one assignment
      if (parsed?.intent === 'work') {
        const assignments = parsed?.assignments as unknown[];
        expect(assignments.length).toBeGreaterThan(0);

        for (const rawAssignment of assignments) {
          const assignment = rawAssignment as Record<string, unknown>;
          expect(typeof assignment.taskType).toBe('string');
          expect(typeof assignment.employeeId).toBe('string');
          expect(typeof assignment.description).toBe('string');
        }
      }
    });

    it('returns hire intent for a recruitment request', async () => {
      const systemContent = `${MANAGER_SYSTEM_PROMPT}\n\nAvailable employees:\n${TEST_EMPLOYEE_LIST}`;

      const response = await gateway.chat({
        messages: [
          { role: 'system', content: systemContent },
          { role: 'user', content: 'We need to recruit a backend developer' },
        ],
        model: MODEL,
        temperature: 0,
        maxTokens: 150,
      });

      const parsed = extractJsonFromLlm<Record<string, unknown>>(response.content);
      expect(parsed).not.toBeNull();
      expect(['hire', 'assess_team', 'work']).toContain(parsed?.intent);
      expect(Array.isArray(parsed?.assignments)).toBe(true);
    });
  });
});
