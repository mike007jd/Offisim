import { describe, expect, it } from 'vitest';
import type { LlmResponse } from '../../llm/gateway.js';
import { LlmMiddlewareChain } from '../../middleware/chain.js';
import type { LlmCallContext } from '../../middleware/types.js';

function makeCtx(overrides?: Partial<LlmCallContext>): LlmCallContext {
  return {
    request: {
      messages: [{ role: 'user', content: 'hello' }],
      model: 'test-model',
    },
    runtimeCtx: {} as LlmCallContext['runtimeCtx'],
    meta: { nodeName: 'boss', provider: 'test', model: 'test-model' },
    extras: {},
    ...overrides,
  };
}

function makeResponse(content = 'ok'): LlmResponse {
  return {
    content,
    toolCalls: [],
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

describe('LlmMiddlewareChain', () => {
  it('runs before hooks in priority order (low → high)', async () => {
    const chain = new LlmMiddlewareChain();
    const order: string[] = [];

    chain.register({
      name: 'b',
      priority: 20,
      async before(ctx) {
        order.push('b');
        return ctx;
      },
    });
    chain.register({
      name: 'a',
      priority: 10,
      async before(ctx) {
        order.push('a');
        return ctx;
      },
    });

    await chain.runBefore(makeCtx());
    expect(order).toEqual(['a', 'b']);
  });

  it('runs after hooks in reverse priority order (high → low)', async () => {
    const chain = new LlmMiddlewareChain();
    const order: string[] = [];

    chain.register({
      name: 'a',
      priority: 10,
      async after(_ctx, res) {
        order.push('a');
        return res;
      },
    });
    chain.register({
      name: 'b',
      priority: 20,
      async after(_ctx, res) {
        order.push('b');
        return res;
      },
    });

    await chain.runAfter(makeCtx(), makeResponse());
    expect(order).toEqual(['b', 'a']);
  });

  it('before hooks can modify request', async () => {
    const chain = new LlmMiddlewareChain();

    chain.register({
      name: 'injector',
      priority: 10,
      async before(ctx) {
        return {
          ...ctx,
          request: {
            ...ctx.request,
            messages: [{ role: 'system', content: 'injected' }, ...ctx.request.messages],
          },
        };
      },
    });

    const result = await chain.runBefore(makeCtx());
    expect(result.request.messages).toHaveLength(2);
    expect(result.request.messages[0]).toEqual({ role: 'system', content: 'injected' });
  });

  it('after hooks can modify response', async () => {
    const chain = new LlmMiddlewareChain();

    chain.register({
      name: 'transformer',
      priority: 10,
      async after(_ctx, res) {
        return { ...res, content: `${res.content} [transformed]` };
      },
    });

    const result = await chain.runAfter(makeCtx(), makeResponse('hello'));
    expect(result.content).toBe('hello [transformed]');
  });

  it('ignores duplicate registrations (same name)', () => {
    const chain = new LlmMiddlewareChain();

    chain.register({ name: 'a', priority: 10 });
    chain.register({ name: 'a', priority: 20 });

    expect(chain.size).toBe(1);
  });

  it('unregister removes middleware by name', () => {
    const chain = new LlmMiddlewareChain();

    chain.register({ name: 'a', priority: 10 });
    chain.register({ name: 'b', priority: 20 });
    expect(chain.size).toBe(2);

    chain.unregister('a');
    expect(chain.size).toBe(1);
  });

  it('survives middleware errors — does not abort the chain', async () => {
    const chain = new LlmMiddlewareChain();
    const order: string[] = [];

    chain.register({
      name: 'failing',
      priority: 10,
      async before() {
        throw new Error('boom');
      },
    });
    chain.register({
      name: 'surviving',
      priority: 20,
      async before(ctx) {
        order.push('surviving');
        return ctx;
      },
    });

    const result = await chain.runBefore(makeCtx());
    expect(order).toEqual(['surviving']);
    expect(result).toBeDefined();
  });

  it('works with empty chain', async () => {
    const chain = new LlmMiddlewareChain();
    const ctx = makeCtx();
    const res = makeResponse();

    const beforeResult = await chain.runBefore(ctx);
    expect(beforeResult).toBe(ctx);

    const afterResult = await chain.runAfter(ctx, res);
    expect(afterResult).toBe(res);
  });

  it('middleware can use extras for cross-hook state', async () => {
    const chain = new LlmMiddlewareChain();

    chain.register({
      name: 'stateful',
      priority: 10,
      async before(ctx) {
        ctx.extras.startTime = Date.now();
        return ctx;
      },
      async after(ctx, res) {
        expect(typeof ctx.extras.startTime).toBe('number');
        return res;
      },
    });

    const ctx = makeCtx();
    const updatedCtx = await chain.runBefore(ctx);
    await chain.runAfter(updatedCtx, makeResponse());
  });
});
