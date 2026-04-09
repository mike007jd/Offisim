import type { RuntimeEvent } from '@offisim/shared-types';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { EventFilterType } from '../../components/events/EventFilters';
import { getDisplayLabel } from '../../components/events/EventItem';
import type { EventDisplayLevel } from '../../components/events/EventLog';
import { getEventLevel } from '../../components/events/EventLog';
import { TYPE_PREFIX_MAP } from '../../components/events/EventLog';
import { filterEvents } from '../../components/events/activity-log-filter';
import {
  type FilteredEvent,
  groupEventsByTime,
} from '../../components/events/activity-log-grouping';
import { matchesActorFilters } from '../../components/events/workspace/activity-log-utils';
import { getDateCutoff } from '../../components/events/workspace/activity-log-utils';

// ---------------------------------------------------------------------------
// Shared arbitraries
// ---------------------------------------------------------------------------

const ENTITY_TYPES = [
  'employee',
  'task',
  'meeting',
  'install',
  'report',
  'runtime',
  'llm',
  'graph',
  'plan',
  'mcp',
  'company',
  'prefab',
] as const;

const LEVELS: EventDisplayLevel[] = ['Info', 'Warning', 'Error'];

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

/** Arbitrary for a RuntimeEvent with a timestamp in the past 60 days */
function runtimeEventArb(opts?: { timestampRange?: number }): fc.Arbitrary<RuntimeEvent> {
  const range = opts?.timestampRange ?? SIXTY_DAYS_MS;
  const now = Date.now();
  return fc.record({
    type: fc.string({ minLength: 1, maxLength: 30 }),
    entityId: fc.string({ minLength: 1, maxLength: 20 }),
    entityType: fc.constantFrom(...ENTITY_TYPES),
    companyId: fc.string({ minLength: 1, maxLength: 10 }),
    timestamp: fc.integer({ min: now - range, max: now }),
    payload: fc.constant({} as Readonly<Record<string, unknown>>),
  });
}

/** Arbitrary for a FilteredEvent */
function filteredEventArb(): fc.Arbitrary<FilteredEvent> {
  return fc.record({
    event: runtimeEventArb(),
    level: fc.constantFrom<EventDisplayLevel>(...LEVELS),
  });
}

// ---------------------------------------------------------------------------
// Property 1: Time grouping preserves event count
// ---------------------------------------------------------------------------

describe('Feature: activity-log-rebuild, Property 1: Time grouping preserves event count', () => {
  /**
   * Validates: Requirements 7.2
   *
   * For any FilteredEvent array, the sum of all TimeGroup event counts
   * returned by groupEventsByTime must equal the input array length.
   */
  it('sum of all group event counts equals input length', () => {
    fc.assert(
      fc.property(fc.array(filteredEventArb(), { maxLength: 100 }), (events) => {
        const groups = groupEventsByTime(events);
        const totalInGroups = groups.reduce((sum, g) => sum + g.events.length, 0);
        expect(totalInGroups).toBe(events.length);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Within-group descending order
// ---------------------------------------------------------------------------

describe('Feature: activity-log-rebuild, Property 2: Within-group descending order', () => {
  /**
   * Validates: Requirements 7.4
   *
   * For each TimeGroup returned by groupEventsByTime, events must be
   * sorted descending by timestamp (newest first).
   */
  it('events within each group are sorted descending by timestamp', () => {
    fc.assert(
      fc.property(fc.array(filteredEventArb(), { maxLength: 100 }), (events) => {
        const groups = groupEventsByTime(events);
        for (const group of groups) {
          for (let i = 0; i < group.events.length - 1; i++) {
            expect(group.events[i].event.timestamp).toBeGreaterThanOrEqual(
              group.events[i + 1].event.timestamp,
            );
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: getEventLevel returns valid level
// ---------------------------------------------------------------------------

describe('Feature: activity-log-rebuild, Property 3: getEventLevel returns valid level', () => {
  /**
   * Validates: Requirements 8.1
   *
   * For any RuntimeEvent (with any type string, including keywords like
   * 'failed', 'error', 'blocked', 'warning'), getEventLevel must return
   * one of 'Info', 'Warning', or 'Error'.
   */
  it('always returns Info, Warning, or Error for arbitrary event types', () => {
    // Mix random strings with keyword-containing strings
    const typeArb = fc.oneof(
      fc.string({ minLength: 0, maxLength: 50 }),
      fc.constantFrom(
        'failed',
        'error',
        'blocked',
        'warning',
        'task.failed',
        'mcp.error.occurred',
        'employee.blocked',
        'plan.warning.issued',
        'rolled_back',
        'rejected',
        'employee.created',
        'plan.completed',
      ),
      // Random strings that may contain keywords
      fc
        .tuple(
          fc.constantFrom('', 'task.', 'mcp.', 'employee.', 'plan.'),
          fc.constantFrom(
            'failed',
            'error',
            'blocked',
            'warning',
            'rejected',
            'rolled_back',
            'created',
            'completed',
            'started',
          ),
        )
        .map(([prefix, suffix]) => `${prefix}${suffix}`),
    );

    fc.assert(
      fc.property(typeArb, (type) => {
        const event: RuntimeEvent = {
          type,
          entityId: 'test-id',
          entityType: 'employee',
          companyId: 'test-company',
          timestamp: Date.now(),
          payload: {},
        };
        const level = getEventLevel(event);
        expect(LEVELS).toContain(level);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: Empty actor filters pass all events
// ---------------------------------------------------------------------------

describe('Feature: activity-log-rebuild, Property 4: Empty actor filters pass all events', () => {
  /**
   * Validates: Requirements 9.1
   *
   * matchesActorFilters(event, []) must return true for any RuntimeEvent.
   */
  it('empty actor filter array always returns true', () => {
    const eventWithPayloadArb = fc.record({
      type: fc.string({ minLength: 1, maxLength: 30 }),
      entityId: fc.string({ minLength: 1, maxLength: 20 }),
      entityType: fc.constantFrom(...ENTITY_TYPES),
      companyId: fc.string({ minLength: 1, maxLength: 10 }),
      timestamp: fc.integer({ min: 0, max: Date.now() }),
      payload: fc.oneof(
        fc.constant({} as Readonly<Record<string, unknown>>),
        fc
          .record({
            employeeName: fc.string({ minLength: 0, maxLength: 20 }),
          })
          .map((p) => p as Readonly<Record<string, unknown>>),
        fc
          .record({
            name: fc.string({ minLength: 0, maxLength: 20 }),
          })
          .map((p) => p as Readonly<Record<string, unknown>>),
      ),
    });

    fc.assert(
      fc.property(eventWithPayloadArb, (event) => {
        expect(matchesActorFilters(event as RuntimeEvent, [])).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: Combined filter pipeline correctness
// ---------------------------------------------------------------------------

describe('Feature: activity-log-rebuild, Property 5: Combined filter pipeline correctness', () => {
  /**
   * Validates: Requirements 2.7
   *
   * For any event array and FilterOptions, every event returned by
   * filterEvents must satisfy ALL active filter conditions:
   * - timestamp >= getDateCutoff(datePreset)
   * - type prefix matches (if eventTypes non-empty)
   * - matchesActorFilters returns true
   * - search term found in type + label + entityType (if search non-empty)
   */

  // Use known event type prefixes from TYPE_PREFIX_MAP for realistic type generation
  const knownPrefixes = [
    'graph.node.',
    'plan.',
    'task.',
    'deliverable.',
    'employee.',
    'install.',
    'llm.',
    'interaction.',
    'error.',
    'mcp.',
    'knowledge.',
    'meeting.',
    'direct.chat.',
    'hr.',
    'memory.',
    'rack.',
    'slot.',
    'binding.',
    'cost.',
    'git.',
  ];

  const knownFilterTypes: EventFilterType[] = [
    'Node',
    'Plan',
    'Task',
    'Deliverable',
    'Employee',
    'Install',
    'LLM',
    'Interaction',
    'Error',
    'MCP',
    'Knowledge',
    'Meeting',
    'HR',
    'Memory',
    'Infrastructure',
    'Git',
  ];

  const eventTypeArb = fc.oneof(
    // Events with known prefixes (more likely to pass type filter)
    fc
      .tuple(
        fc.constantFrom(...knownPrefixes),
        fc.constantFrom('created', 'completed', 'failed', 'started', 'changed'),
      )
      .map(([prefix, suffix]) => `${prefix}${suffix}`),
    // Random event types
    fc.string({ minLength: 1, maxLength: 30 }),
  );

  const realisticEventArb: fc.Arbitrary<RuntimeEvent> = fc.record({
    type: eventTypeArb,
    entityId: fc.string({ minLength: 1, maxLength: 20 }),
    entityType: fc.constantFrom(...ENTITY_TYPES),
    companyId: fc.string({ minLength: 1, maxLength: 10 }),
    timestamp: fc.integer({ min: Date.now() - SIXTY_DAYS_MS, max: Date.now() }),
    payload: fc.oneof(
      fc.constant({} as Readonly<Record<string, unknown>>),
      fc
        .record({
          employeeName: fc.string({ minLength: 1, maxLength: 15 }),
        })
        .map((p) => p as Readonly<Record<string, unknown>>),
      fc
        .record({
          name: fc.string({ minLength: 1, maxLength: 15 }),
        })
        .map((p) => p as Readonly<Record<string, unknown>>),
    ),
  });

  const filterOptionsArb = fc.record({
    datePreset: fc.constantFrom<'today' | '7d' | '30d' | 'custom'>('today', '7d', '30d', 'custom'),
    eventTypes: fc.subarray(knownFilterTypes, { maxLength: 4 }).map((arr) => arr as string[]),
    actorFilters: fc.array(fc.string({ minLength: 1, maxLength: 15 }), { maxLength: 3 }),
    search: fc.oneof(fc.constant(''), fc.string({ minLength: 1, maxLength: 10 })),
  });

  it('every returned event satisfies all active filter conditions', () => {
    fc.assert(
      fc.property(
        fc.array(realisticEventArb, { minLength: 0, maxLength: 30 }),
        filterOptionsArb,
        (events, filters) => {
          const result = filterEvents(events, filters);
          const cutoff = getDateCutoff(filters.datePreset);

          // Collect prefixes for type filter verification
          const prefixes: string[] = [];
          if (filters.eventTypes.length > 0) {
            for (const type of filters.eventTypes) {
              const p = TYPE_PREFIX_MAP[type as EventFilterType];
              if (p) prefixes.push(...p);
            }
          }

          const searchLower = filters.search.toLowerCase();

          for (const { event } of result) {
            // 1. Date filter: timestamp >= cutoff
            expect(event.timestamp).toBeGreaterThanOrEqual(cutoff);

            // 2. Type filter: if eventTypes non-empty, type must match a prefix
            if (prefixes.length > 0) {
              const matchesPrefix = prefixes.some((p) => event.type.startsWith(p));
              expect(matchesPrefix).toBe(true);
            }

            // 3. Actor filter: matchesActorFilters must return true
            expect(matchesActorFilters(event, filters.actorFilters)).toBe(true);

            // 4. Search filter: if search non-empty, haystack must contain search
            if (searchLower) {
              const haystack =
                `${event.type} ${getDisplayLabel(event)} ${event.entityType ?? ''}`.toLowerCase();
              expect(haystack).toContain(searchLower);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
