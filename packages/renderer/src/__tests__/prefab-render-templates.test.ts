import { describe, expect, it, vi } from 'vitest';

// ── Mock pixi.js — GraphicsContext with chained drawing methods ──

vi.mock('pixi.js', () => {
  class MockGraphicsContext {
    /** Track method calls for assertion. */
    _calls: Array<{ method: string; args: unknown[] }> = [];

    roundRect(...args: unknown[]) {
      this._calls.push({ method: 'roundRect', args });
      return this;
    }
    rect(...args: unknown[]) {
      this._calls.push({ method: 'rect', args });
      return this;
    }
    circle(...args: unknown[]) {
      this._calls.push({ method: 'circle', args });
      return this;
    }
    ellipse(...args: unknown[]) {
      this._calls.push({ method: 'ellipse', args });
      return this;
    }
    fill(...args: unknown[]) {
      this._calls.push({ method: 'fill', args });
      return this;
    }
    stroke(...args: unknown[]) {
      this._calls.push({ method: 'stroke', args });
      return this;
    }
  }

  return { GraphicsContext: MockGraphicsContext };
});

// Import after mock
const {
  registerTemplate,
  getTemplate,
  getAllTemplateNames,
  buildStateContexts,
} = await import('../prefab/render-templates.js');

const { GraphicsContext } = await import('pixi.js');

// ── Tests ───────────────────────────────────────────────────────

describe('render-templates registry', () => {
  // Built-in templates are registered at module load.
  // We test registry operations via a custom template so we don't
  // interfere with built-ins.

  it('registerTemplate stores and getTemplate retrieves', () => {
    const fn = vi.fn((_p, _s) => new GraphicsContext());
    registerTemplate('test-widget', fn);
    expect(getTemplate('test-widget')).toBe(fn);
  });

  it('unknown template returns undefined', () => {
    expect(getTemplate('nonexistent-template-xyz')).toBeUndefined();
  });

  it('built-in templates include all required names', () => {
    const names = getAllTemplateNames();
    const required = [
      // workspace
      'desk',
      'monitor',
      'chair',
      // compute
      'server-rack',
      // knowledge
      'bookshelf',
      // collaboration
      'meeting-table',
      'sofa',
      // infrastructure
      'network-switch',
      'cable-tray',
      // decorative
      'plant',
      'coffee-table',
      'vending-machine',
      'reading-table',
    ];
    for (const name of required) {
      expect(names).toContain(name);
    }
  });

  it('getAllTemplateNames returns at least the required count', () => {
    // 13 built-in + possibly the test-widget registered above
    expect(getAllTemplateNames().length).toBeGreaterThanOrEqual(13);
  });
});

describe('buildStateContexts', () => {
  it('returns Map with one entry per state', () => {
    const fn = getTemplate('desk')!;
    expect(fn).toBeDefined();

    const states = ['empty', 'occupied', 'working'];
    const contexts = buildStateContexts(fn, {}, states);

    expect(contexts.size).toBe(3);
    for (const state of states) {
      expect(contexts.has(state)).toBe(true);
    }
  });

  it('each entry is a GraphicsContext instance', () => {
    const fn = getTemplate('monitor')!;
    const states = ['working', 'idle', 'blocked'];
    const contexts = buildStateContexts(fn, {}, states);

    for (const state of states) {
      const ctx = contexts.get(state);
      expect(ctx).toBeInstanceOf(GraphicsContext);
    }
  });

  it('empty states array returns empty Map', () => {
    const fn = getTemplate('chair')!;
    const contexts = buildStateContexts(fn, {}, []);
    expect(contexts.size).toBe(0);
  });
});

describe('each template function returns a GraphicsContext', () => {
  const allNames = [
    'desk',
    'monitor',
    'chair',
    'server-rack',
    'bookshelf',
    'meeting-table',
    'sofa',
    'network-switch',
    'cable-tray',
    'plant',
    'coffee-table',
    'vending-machine',
    'reading-table',
  ];

  for (const name of allNames) {
    it(`"${name}" returns GraphicsContext`, () => {
      const fn = getTemplate(name)!;
      expect(fn).toBeDefined();
      const ctx = fn({}, 'idle');
      expect(ctx).toBeInstanceOf(GraphicsContext);
    });
  }
});

describe('state-aware templates produce different contexts per state', () => {
  it('monitor: different screen color for working vs blocked', () => {
    const fn = getTemplate('monitor')!;
    const working = fn({}, 'working') as unknown as { _calls: Array<{ method: string; args: unknown[] }> };
    const blocked = fn({}, 'blocked') as unknown as { _calls: Array<{ method: string; args: unknown[] }> };

    // Both should have fill calls, but with different colors for the screen
    const workingFills = working._calls.filter((c) => c.method === 'fill');
    const blockedFills = blocked._calls.filter((c) => c.method === 'fill');
    expect(workingFills.length).toBe(blockedFills.length);

    // The second fill is the screen content — different color per state
    expect(workingFills[1]!.args[0]).not.toBe(blockedFills[1]!.args[0]);
  });

  it('server-rack: different LED color for idle vs error', () => {
    const fn = getTemplate('server-rack')!;
    const idle = fn({}, 'idle') as unknown as { _calls: Array<{ method: string; args: unknown[] }> };
    const error = fn({}, 'error') as unknown as { _calls: Array<{ method: string; args: unknown[] }> };

    const idleFills = idle._calls.filter((c) => c.method === 'fill');
    const errorFills = error._calls.filter((c) => c.method === 'fill');

    // LED fills differ — pick one of the LED fill positions (after bezel+panel fills)
    // Both contexts have the same structure, so same-index fills should differ for LEDs
    expect(idleFills.length).toBe(errorFills.length);
    // At least one fill arg should differ (the LED color)
    const differ = idleFills.some(
      (f, i) => JSON.stringify(f.args) !== JSON.stringify(errorFills[i]!.args),
    );
    expect(differ).toBe(true);
  });

  it('bookshelf: frame color varies by state', () => {
    const fn = getTemplate('bookshelf')!;
    const ready = fn({}, 'ready') as unknown as { _calls: Array<{ method: string; args: unknown[] }> };
    const error = fn({}, 'error') as unknown as { _calls: Array<{ method: string; args: unknown[] }> };

    const readyFills = ready._calls.filter((c) => c.method === 'fill');
    const errorFills = error._calls.filter((c) => c.method === 'fill');

    // First fill is the frame — should differ between ready(green) and error(red)
    expect(readyFills[0]!.args[0]).not.toBe(errorFills[0]!.args[0]);
  });
});

describe('template params are respected', () => {
  it('desk accepts custom width/height/color', () => {
    const fn = getTemplate('desk')!;
    const ctx = fn({ width: 80, height: 40, color: 0xff0000 }, 'idle') as unknown as {
      _calls: Array<{ method: string; args: unknown[] }>;
    };
    // First roundRect should use the custom width
    const firstRoundRect = ctx._calls.find((c) => c.method === 'roundRect');
    expect(firstRoundRect).toBeDefined();
    // x = -w/2 = -40
    expect(firstRoundRect!.args[0]).toBe(-40);
  });

  it('chair uses default dimensions when no params given', () => {
    const fn = getTemplate('chair')!;
    const ctx = fn({}, 'idle') as unknown as {
      _calls: Array<{ method: string; args: unknown[] }>;
    };
    // First roundRect: x = -w/2 = -10 (default w=20)
    const firstRoundRect = ctx._calls.find((c) => c.method === 'roundRect');
    expect(firstRoundRect).toBeDefined();
    expect(firstRoundRect!.args[0]).toBe(-10);
  });
});
