import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { SopDefinition, SopStep } from '@offisim/shared-types';
import {
  DAG_LAYOUT,
  getExecutionBatches,
  computeDagLayout,
} from '../../components/sop/sop-dag-layout';
import {
  formatRunCommand,
  formatModifyCommand,
  formatStepClickPrefill,
} from '../../components/sop/sop-commands';
import { parseSopDefinition } from '../../lib/sop-utils';

// ---------------------------------------------------------------------------
// Shared generators
// ---------------------------------------------------------------------------

const ROLE_SLUGS = [
  'developer', 'designer', 'pm', 'qa', 'devops', 'engineer',
  'frontend', 'backend', 'fullstack', 'writer', 'marketer',
] as const;

const roleSlugArb = fc.constantFrom(...ROLE_SLUGS);

/**
 * Generate a valid DAG as a SopDefinition.
 * Steps are created in order; each step's dependencies only reference
 * earlier step_ids, guaranteeing no cycles.
 */
const validDagArb = fc
  .integer({ min: 1, max: 15 })
  .chain((stepCount) =>
    fc.tuple(
      fc.string({ minLength: 1, maxLength: 10 }),
      fc.array(
        fc.record({
          label: fc.string({ minLength: 1, maxLength: 20 }),
          role_slug: roleSlugArb,
          instruction: fc.string({ maxLength: 40 }),
          output_key: fc.string({ minLength: 1, maxLength: 10 }),
        }),
        { minLength: stepCount, maxLength: stepCount },
      ),
    )
    .chain(([name, stepInfos]) => {
      const stepIds = stepInfos.map((_, i) => `step-${i}`);
      // For each step, pick a random subset of earlier step ids as deps
      const depsArbs = stepInfos.map((_, i) => {
        if (i === 0) return fc.constant([] as string[]);
        const earlier = stepIds.slice(0, i);
        return fc.subarray(earlier, { minLength: 0, maxLength: earlier.length });
      });
      return fc.tuple(fc.constant(name), fc.constant(stepInfos), fc.tuple(...depsArbs));
    })
    .map(([name, stepInfos, allDeps]) => {
      const steps: SopStep[] = stepInfos.map((info, i) => ({
        step_id: `step-${i}`,
        label: info.label,
        role_slug: info.role_slug as SopStep['role_slug'],
        instruction: info.instruction,
        dependencies: allDeps[i] ?? [],
        output_key: info.output_key,
      }));
      return {
        sop_id: 'sop-test',
        name,
        description: '',
        steps,
        created_at: new Date().toISOString(),
      } as SopDefinition;
    }),
  );

// ---------------------------------------------------------------------------
// Property 1: DAG topological sort batch invariant
// ---------------------------------------------------------------------------

describe('Feature: sop-view-rebuild, Property 1: DAG topological sort batch invariant', () => {
  /**
   * Validates: Requirements 4.1, 4.2, 4.3
   *
   * For any valid SopDefinition (DAG), getExecutionBatches returns batches
   * where: all steps appear exactly once, no intra-batch dependencies,
   * and all deps appear in earlier batches.
   */
  it('all steps appear exactly once across batches', () => {
    fc.assert(
      fc.property(validDagArb, (def) => {
        const batches = getExecutionBatches(def);
        const allIds = batches.flat().map((s) => s.step_id);
        const expectedIds = def.steps.map((s) => s.step_id);
        expect(allIds.sort()).toEqual(expectedIds.sort());
        // No duplicates
        expect(new Set(allIds).size).toBe(allIds.length);
      }),
      { numRuns: 100 },
    );
  });

  it('no intra-batch dependencies', () => {
    fc.assert(
      fc.property(validDagArb, (def) => {
        const batches = getExecutionBatches(def);
        for (const batch of batches) {
          const batchIds = new Set(batch.map((s) => s.step_id));
          for (const step of batch) {
            for (const dep of step.dependencies) {
              expect(batchIds.has(dep)).toBe(false);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('all dependencies appear in earlier batches', () => {
    fc.assert(
      fc.property(validDagArb, (def) => {
        const batches = getExecutionBatches(def);
        const seen = new Set<string>();
        for (const batch of batches) {
          for (const step of batch) {
            for (const dep of step.dependencies) {
              expect(seen.has(dep)).toBe(true);
            }
          }
          for (const step of batch) {
            seen.add(step.step_id);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: SOP definition serialization round-trip
// ---------------------------------------------------------------------------

describe('Feature: sop-view-rebuild, Property 2: SOP definition serialization round-trip', () => {
  /**
   * Validates: Requirements 5.3
   *
   * For any valid SopDefinition, JSON.stringify → parseSopDefinition
   * round-trip preserves steps count and each step's key fields.
   */
  it('round-trip preserves steps count and step fields', () => {
    fc.assert(
      fc.property(validDagArb, (def) => {
        const json = JSON.stringify(def);
        const parsed = parseSopDefinition(json);
        expect(parsed).not.toBeNull();
        expect(parsed!.steps.length).toBe(def.steps.length);
        for (let i = 0; i < def.steps.length; i++) {
          const original = def.steps[i]!;
          const restored = parsed!.steps[i]!;
          expect(restored.step_id).toBe(original.step_id);
          expect(restored.label).toBe(original.label);
          expect(restored.role_slug).toBe(original.role_slug);
          expect([...restored.dependencies]).toEqual([...original.dependencies]);
        }
      }),
      { numRuns: 100 },
    );
  });
});


// ---------------------------------------------------------------------------
// Property 3: SOP command message formatting
// ---------------------------------------------------------------------------

describe('Feature: sop-view-rebuild, Property 3: SOP command message formatting', () => {
  /**
   * Validates: Requirements 6.1, 6.2, 6.3
   *
   * For any random strings, the formatting functions produce the expected
   * message patterns.
   */
  it('formatRunCommand matches "Run the SOP: {name}"', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), (name) => {
        expect(formatRunCommand(name)).toBe(`Run the SOP: ${name}`);
      }),
      { numRuns: 100 },
    );
  });

  it('formatModifyCommand matches expected pattern', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (name, text) => {
          expect(formatModifyCommand(name, text)).toBe(
            `Modify the SOP "${name}": ${text}`,
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('formatStepClickPrefill matches expected pattern', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 30 }),
        (label, role) => {
          expect(formatStepClickPrefill(label, role)).toBe(
            `For step "${label}" (${role}): `,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: DAG layout node completeness
// ---------------------------------------------------------------------------

describe('Feature: sop-view-rebuild, Property 4: DAG layout node completeness', () => {
  /**
   * Validates: Requirements 8.2
   *
   * For any valid SopDefinition, computeDagLayout returns nodes.length
   * equal to steps.length and stepIds match.
   */
  it('nodes count equals steps count and stepIds match', () => {
    fc.assert(
      fc.property(validDagArb, (def) => {
        const layout = computeDagLayout(def);
        expect(layout.nodes.length).toBe(def.steps.length);
        const layoutIds = layout.nodes.map((n) => n.stepId).sort();
        const stepIds = def.steps.map((s) => s.step_id).sort();
        expect(layoutIds).toEqual(stepIds);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: DAG layout batch column alignment
// ---------------------------------------------------------------------------

describe('Feature: sop-view-rebuild, Property 5: DAG layout batch column alignment', () => {
  /**
   * Validates: Requirements 8.3
   *
   * For any valid SopDefinition, nodes with the same batchIndex have
   * the same x coordinate.
   */
  it('same batchIndex implies same x coordinate', () => {
    fc.assert(
      fc.property(validDagArb, (def) => {
        const layout = computeDagLayout(def);
        const batchXMap = new Map<number, number>();
        for (const node of layout.nodes) {
          const existing = batchXMap.get(node.batchIndex);
          if (existing !== undefined) {
            expect(node.x).toBe(existing);
          } else {
            batchXMap.set(node.batchIndex, node.x);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: DAG layout edge endpoint correctness
// ---------------------------------------------------------------------------

describe('Feature: sop-view-rebuild, Property 6: DAG layout edge endpoint correctness', () => {
  /**
   * Validates: Requirements 8.4
   *
   * For any valid SopDefinition, each edge's fromPoint is at the source
   * node's right-center and toPoint is at the target node's left-center.
   */
  it('edge endpoints match node positions', () => {
    fc.assert(
      fc.property(validDagArb, (def) => {
        const layout = computeDagLayout(def);
        const nodeMap = new Map(layout.nodes.map((n) => [n.stepId, n]));
        for (const edge of layout.edges) {
          const source = nodeMap.get(edge.fromStepId)!;
          const target = nodeMap.get(edge.toStepId)!;
          expect(source).toBeDefined();
          expect(target).toBeDefined();
          // fromPoint = right-center of source
          expect(edge.fromPoint.x).toBe(source.x + source.width);
          expect(edge.fromPoint.y).toBe(source.y + source.height / 2);
          // toPoint = left-center of target
          expect(edge.toPoint.x).toBe(target.x);
          expect(edge.toPoint.y).toBe(target.y + target.height / 2);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// 2.7 Boundary test: cyclic dependency
// ---------------------------------------------------------------------------

describe('Feature: sop-view-rebuild, Boundary: cyclic dependency handling', () => {
  it('getExecutionBatches terminates and returns partial batches for cyclic input', () => {
    const cyclicDef: SopDefinition = {
      sop_id: 'sop-cycle',
      name: 'Cyclic SOP',
      description: '',
      steps: [
        {
          step_id: 'A',
          label: 'Step A',
          role_slug: 'developer',
          instruction: 'Do A',
          dependencies: ['B'],
          output_key: 'a',
        },
        {
          step_id: 'B',
          label: 'Step B',
          role_slug: 'designer',
          instruction: 'Do B',
          dependencies: ['A'],
          output_key: 'b',
        },
      ],
      created_at: new Date().toISOString(),
    };

    const batches = getExecutionBatches(cyclicDef);
    // Both steps are in a cycle — neither can be scheduled
    const allScheduled = batches.flat().map((s) => s.step_id);
    expect(allScheduled.length).toBeLessThan(cyclicDef.steps.length);
    // Specifically, no steps should be scheduled since both depend on each other
    expect(allScheduled.length).toBe(0);
  });

  it('getExecutionBatches returns partial batches when only some steps form a cycle', () => {
    const partialCycleDef: SopDefinition = {
      sop_id: 'sop-partial-cycle',
      name: 'Partial Cycle SOP',
      description: '',
      steps: [
        {
          step_id: 'X',
          label: 'Step X',
          role_slug: 'pm',
          instruction: 'Do X',
          dependencies: [],
          output_key: 'x',
        },
        {
          step_id: 'A',
          label: 'Step A',
          role_slug: 'developer',
          instruction: 'Do A',
          dependencies: ['X', 'B'],
          output_key: 'a',
        },
        {
          step_id: 'B',
          label: 'Step B',
          role_slug: 'designer',
          instruction: 'Do B',
          dependencies: ['A'],
          output_key: 'b',
        },
      ],
      created_at: new Date().toISOString(),
    };

    const batches = getExecutionBatches(partialCycleDef);
    const allScheduled = batches.flat().map((s) => s.step_id);
    // X has no deps, so it should be scheduled
    expect(allScheduled).toContain('X');
    // A and B form a cycle, so they should NOT be scheduled
    expect(allScheduled).not.toContain('A');
    expect(allScheduled).not.toContain('B');
    // Total scheduled < total steps
    expect(allScheduled.length).toBeLessThan(partialCycleDef.steps.length);
  });
});
