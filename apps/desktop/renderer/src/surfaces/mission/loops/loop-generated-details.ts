/**
 * Generated details summary (PR-08) — a PURE projection of a {@link LoopIR} into a
 * READ-ONLY, human-readable advanced drawer. The user changes these by editing the
 * prompt and recompiling; this is NEVER a form and NEVER surfaces raw evaluator
 * JSON or schema. Kept React-free so the harness can assert the mapping.
 */

import type { LoopIR, LoopParameter } from '@offisim/shared-types';

interface GeneratedDetailRow {
  label: string;
  value: string;
}

export interface GeneratedDetailSection {
  key: string;
  title: string;
  rows: GeneratedDetailRow[];
}

/** Parse a serialized IR safely; a malformed/empty `{}` returns null. */
export function parseLoopIr(compiledIrJson: string): LoopIR | null {
  try {
    const parsed = JSON.parse(compiledIrJson) as Partial<LoopIR>;
    if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== '1') return null;
    return parsed as LoopIR;
  } catch {
    return null;
  }
}

function paramValue(p: LoopParameter): string {
  return `${p.label}: ${String(p.defaultValue)}`;
}

/**
 * Build the read-only advanced-drawer sections from a compiled IR. Returns an empty
 * array when there is no legal IR (needs_input / invalid) so the drawer shows its
 * own "compile to see details" hint rather than blank cards.
 */
export function buildGeneratedDetails(ir: LoopIR | null): GeneratedDetailSection[] {
  if (!ir) return [];
  const sections: GeneratedDetailSection[] = [];

  // Outcome
  sections.push({
    key: 'outcome',
    title: 'Outcome',
    rows: [{ label: 'Goal', value: ir.outcome || ir.completion.outcome || '—' }],
  });

  // Inputs / outputs
  const ioRows: GeneratedDetailRow[] = [];
  if (ir.inputs.length > 0) {
    ioRows.push({
      label: 'Inputs',
      value: ir.inputs.map((p) => `${p.label}${p.required ? '' : ' (optional)'}`).join(', '),
    });
  }
  if (ir.outputs.length > 0) {
    ioRows.push({ label: 'Outputs', value: ir.outputs.map((p) => p.label).join(', ') });
  }
  if (ir.parameters.length > 0) {
    ioRows.push({ label: 'Parameters', value: ir.parameters.map(paramValue).join(', ') });
  }
  if (ioRows.length > 0) {
    sections.push({ key: 'io', title: 'Inputs & outputs', rows: ioRows });
  }

  // Completion / exit states + oracles (acceptance items, read-only)
  const completionRows: GeneratedDetailRow[] = [];
  if (ir.completion.exitStates.length > 0) {
    completionRows.push({ label: 'Exit states', value: ir.completion.exitStates.join(', ') });
  }
  for (const item of ir.completion.acceptance) {
    completionRows.push({
      label: item.required ? 'Must pass' : 'Should pass',
      value: `${item.description} — verified by ${oracleWord(item.oracle)}`,
    });
  }
  if (completionRows.length > 0) {
    sections.push({ key: 'completion', title: 'Completion & oracles', rows: completionRows });
  }

  // Budget
  if (ir.budget) {
    const b = ir.budget;
    const rows: GeneratedDetailRow[] = [
      { label: 'Tier', value: b.tier },
      { label: 'Agents', value: `${b.maxConcurrentAgents} concurrent / ${b.maxTotalAgents} total` },
      { label: 'Fix waves per gate', value: String(b.maxFixWavesPerGate) },
    ];
    if (b.wallClockMinutes) rows.push({ label: 'Wall clock', value: `${b.wallClockMinutes} min` });
    if (b.tokenCeiling)
      rows.push({ label: 'Token ceiling', value: b.tokenCeiling.toLocaleString() });
    sections.push({ key: 'budget', title: 'Budget', rows });
  }

  // Human gates
  if (ir.humanGates.length > 0) {
    sections.push({
      key: 'gates',
      title: 'Human gates',
      rows: ir.humanGates.map((g) => ({ label: g.prompt, value: g.reason })),
    });
  }

  // Skills
  if (ir.skillBindings.length > 0) {
    sections.push({
      key: 'skills',
      title: 'Skills',
      rows: ir.skillBindings.map((s) => ({
        label: s.skillId,
        value: `v${s.skillVersion}`,
      })),
    });
  }

  return sections;
}

function oracleWord(oracle: 'deterministic' | 'review' | 'human'): string {
  switch (oracle) {
    case 'deterministic':
      return 'an automated check';
    case 'review':
      return 'a review';
    case 'human':
      return 'a person';
    default: {
      const exhaustive: never = oracle;
      return String(exhaustive);
    }
  }
}
