/**
 * The software-development compiler profile (PR-07). The first built-in profile;
 * its instruction + reference assets are the bundled, versioned, checksummed
 * fleet-development-loop. It compiles a rough software request into a generic
 * {@link LoopIR} with a fan-out → verify → integrate → cleanup topology, feedback
 * and retry edges, exit states, and a tier-derived budget.
 *
 * Hard boundary: this profile defines METHOD only. It must NOT emit a custom
 * controller / scheduler / lease-DB. The compiler REJECTS generated contract text
 * that introduces scheduler/controller/lease/heartbeat language (the harness
 * proves it). Repository facts are referenced only when the context says the repo
 * was inspected; otherwise the IR marks evidence pending rather than fabricating.
 */

import type {
  LoopAcceptanceItem,
  LoopBudgetContract,
  LoopEdge,
  LoopIR,
  LoopNode,
} from '@offisim/shared-types';
import { defaultBudgetForTier, repairOrReject } from '../../repair.js';
import type {
  LoopCompileInput,
  LoopCompileModel,
  LoopCompileResult,
  LoopCompilerProfile,
  LoopModelOutput,
  ValidationFinding,
} from '../../types.js';
import { LOOP_COMPILER_VERSION } from '../../types.js';
import { validateLoopIR } from '../../validate.js';
import { FLEET_DEVELOPMENT_LOOP_ASSETS, FLEET_DEVELOPMENT_LOOP_VERSION } from './assets.js';

export const SOFTWARE_DEVELOPMENT_PROFILE_ID = 'software-development' as const;

/**
 * Forbidden infrastructure language. The fleet skill's architectural boundary
 * forbids generating a controller/scheduler/lease/heartbeat/daemon; if the model
 * draft sneaks any of these into the contract text (scope/profileData/outcome),
 * the compile is INVALID. This is the deterministic enforcement the harness asserts.
 */
const FORBIDDEN_INFRA = [
  'scheduler',
  'controller',
  'lease',
  'heartbeat',
  'daemon',
  'fleetctl',
  'worker daemon',
  'lifecycle database',
  'orchestration script',
];

const SYSTEM_INSTRUCTION = [
  'You are the software-development loop compiler. Turn a rough request into a',
  'repository-specific, evidence-gated, budget-aware parallel development loop.',
  'Infer scope and acceptance; propose a consumption tier (light/standard/aggressive).',
  'Define METHOD only — never a custom controller, scheduler, lease DB, or daemon.',
  'Reference real repository facts only when the repo was inspected; otherwise mark',
  'evidence pending. Ask at most three questions, each with a recommended default.',
].join(' ');

/** Pull a string field out of the model hints, trimmed; '' when absent/blank. */
function hintString(hints: Record<string, unknown> | undefined, key: string): string {
  const v = hints?.[key];
  return typeof v === 'string' ? v.trim() : '';
}

function hintArray(hints: Record<string, unknown> | undefined, key: string): unknown[] {
  const v = hints?.[key];
  return Array.isArray(v) ? v : [];
}

/** Scan a blob of generated text for forbidden infrastructure language. */
function scanForForbiddenInfra(...texts: string[]): ValidationFinding[] {
  const haystack = texts.join('\n').toLowerCase();
  const findings: ValidationFinding[] = [];
  for (const term of FORBIDDEN_INFRA) {
    if (haystack.includes(term)) {
      findings.push({
        code: 'profile.forbidden_infra',
        message: `generated contract introduces forbidden infrastructure language: "${term}" (this profile defines method only, never a custom ${term})`,
        severity: 'error',
      });
    }
  }
  return findings;
}

/**
 * Build the software-development IR from the (repaired) model draft. The topology
 * is fixed by the profile's METHOD — discover → freeze → implement → verify →
 * integrate → cleanup — with feedback/retry edges and a finish. Profile-specific
 * detail rides in `profileData`; the generic graph is what the validator checks.
 */
function buildIR(
  input: LoopCompileInput,
  hints: Record<string, unknown> | undefined,
  budget: LoopBudgetContract,
): LoopIR {
  const title = hintString(hints, 'title') || deriveTitle(input.sourcePrompt);
  const outcome = hintString(hints, 'outcome') || input.sourcePrompt.trim();

  // Acceptance: prefer the model's items; else a single deterministic gate so the
  // IR always has at least one REQUIRED criterion (validator requirement).
  const acceptance = buildAcceptance(hints);

  const inspected = input.context.repository?.inspected === true;

  // Fixed METHOD topology (start → discover → freeze → implement → verify →
  // integrate → cleanup → finish), with a verify→implement feedback edge and a
  // bounded retry on implement.
  const nodes: LoopNode[] = [
    { id: 'n_start', kind: 'start', label: 'Request' },
    { id: 'n_discover', kind: 'action', label: 'Parallel discovery' },
    { id: 'n_freeze', kind: 'action', label: 'Freeze contracts & oracles' },
    { id: 'n_implement', kind: 'action', label: 'Implement in waves' },
    { id: 'n_verify', kind: 'verify', label: 'Independent verification' },
    { id: 'n_decide', kind: 'decision', label: 'All gates pass?' },
    { id: 'n_integrate', kind: 'action', label: 'Integrate by wave' },
    { id: 'n_cleanup', kind: 'action', label: 'Native lifecycle cleanup' },
    { id: 'n_finish', kind: 'finish', label: 'Done' },
  ];

  const edges: LoopEdge[] = [
    { id: 'e1', from: 'n_start', to: 'n_discover', kind: 'next' },
    { id: 'e2', from: 'n_discover', to: 'n_freeze', kind: 'next' },
    { id: 'e3', from: 'n_freeze', to: 'n_implement', kind: 'next' },
    { id: 'e4', from: 'n_implement', to: 'n_verify', kind: 'next' },
    { id: 'e5', from: 'n_verify', to: 'n_decide', kind: 'next' },
    { id: 'e6', from: 'n_decide', to: 'n_integrate', kind: 'next', label: 'pass' },
    // Feedback + bounded retry: a failing gate loops back to implement, capped at
    // the budget's fix-waves per gate (never unbounded).
    { id: 'e7', from: 'n_decide', to: 'n_implement', kind: 'feedback', label: 'fail' },
    {
      id: 'e8',
      from: 'n_implement',
      to: 'n_implement',
      kind: 'retry',
      label: 'repair wave',
      maxRetries: budget.maxFixWavesPerGate,
    },
    { id: 'e9', from: 'n_integrate', to: 'n_cleanup', kind: 'next' },
    { id: 'e10', from: 'n_cleanup', to: 'n_finish', kind: 'next' },
  ];

  const profileData: Record<string, unknown> = {
    scope: hintString(hints, 'scope'),
    nonGoals: hintArray(hints, 'nonGoals'),
    authority:
      hintString(hints, 'authority') || 'local-only; push/PR/deploy require explicit authority',
    consumptionTier: budget.tier,
    exitStates: ['success', 'budget-exhausted', 'blocked-handoff'],
    repositoryEvidence: inspected
      ? hintString(hints, 'repositoryEvidence')
      : 'evidence pending — repository was not inspected at compile time',
    evidencePending: !inspected,
  };

  return {
    schemaVersion: '1',
    title,
    outcome,
    inputs: [{ id: 'in_request', label: 'Requirement', type: 'text', required: true }],
    outputs: [{ id: 'out_change', label: 'Integrated change', type: 'change', required: true }],
    parameters: [],
    nodes,
    edges,
    completion: {
      outcome,
      acceptance,
      exitStates: ['success', 'budget-exhausted', 'blocked-handoff'],
    },
    budget,
    humanGates: [],
    skillBindings: [],
    profileData,
    metadata: {
      profileId: SOFTWARE_DEVELOPMENT_PROFILE_ID,
      profileVersion: FLEET_DEVELOPMENT_LOOP_VERSION,
      compilerVersion: LOOP_COMPILER_VERSION,
    },
  };
}

function deriveTitle(prompt: string): string {
  const firstLine = prompt.trim().split('\n')[0]?.trim() ?? '';
  if (firstLine.length === 0) return 'Software loop';
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
}

function buildAcceptance(hints: Record<string, unknown> | undefined): LoopAcceptanceItem[] {
  const raw = hintArray(hints, 'acceptance');
  const items: LoopAcceptanceItem[] = [];
  raw.forEach((entry, idx) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      const e = entry as Record<string, unknown>;
      const description = typeof e.description === 'string' ? e.description.trim() : '';
      if (description.length === 0) return;
      const oracleRaw = typeof e.oracle === 'string' ? e.oracle : 'review';
      const oracle: LoopAcceptanceItem['oracle'] =
        oracleRaw === 'deterministic' || oracleRaw === 'human' ? oracleRaw : 'review';
      const item: LoopAcceptanceItem = {
        id: typeof e.id === 'string' && e.id.length > 0 ? e.id : `acc_${idx}`,
        description,
        oracle,
        required: e.required !== false,
      };
      if (
        oracle === 'deterministic' &&
        typeof e.evaluatorId === 'string' &&
        e.evaluatorId.length > 0
      ) {
        item.evaluatorId = e.evaluatorId;
      }
      items.push(item);
    } else if (typeof entry === 'string' && entry.trim().length > 0) {
      items.push({ id: `acc_${idx}`, description: entry.trim(), oracle: 'review', required: true });
    }
  });
  if (items.length === 0) {
    // Always gate on at least one required, deterministic acceptance: the full
    // test/build/type matrix passes on the integrated revision.
    items.push({
      id: 'acc_matrix',
      description:
        'Project verification matrix (tests, build, types) passes on the integrated revision',
      oracle: 'deterministic',
      evaluatorId: 'command_exit_zero',
      required: true,
    });
  } else if (!items.some((i) => i.required)) {
    // Guarantee a required item (validator + mission engine both require one).
    items[0]!.required = true;
  }
  return items;
}

export const softwareDevelopmentProfile: LoopCompilerProfile = {
  id: SOFTWARE_DEVELOPMENT_PROFILE_ID,
  version: FLEET_DEVELOPMENT_LOOP_VERSION,
  displayName: 'Software Development',
  description:
    'Compile a rough software request into a repository-specific, evidence-gated, budget-aware parallel development loop.',
  systemInstruction: SYSTEM_INSTRUCTION,
  referenceAssets: FLEET_DEVELOPMENT_LOOP_ASSETS,
  defaultBudget: defaultBudgetForTier('standard'),
  enhanceProfile: 'loop_design',

  async compile(input: LoopCompileInput, model: LoopCompileModel): Promise<LoopCompileResult> {
    // 1. Call the injected model. Bad/throwing model output must not crash —
    //    repairOrReject turns any failure into a deterministic invalid/needs_input.
    let modelOutput: LoopModelOutput;
    try {
      modelOutput = await model(input);
    } catch (error) {
      return {
        status: 'invalid',
        questions: [],
        validation: {
          ok: false,
          findings: [
            {
              code: 'model.failed',
              message: `model call failed: ${error instanceof Error ? error.message : String(error)}`,
              severity: 'error',
            },
          ],
        },
      };
    }

    // 2. Deterministic repair/needs_input from the (untrusted) model draft. This
    //    decides: do we have enough to build an IR, or must we ask ≤3 questions?
    const repair = repairOrReject(input, modelOutput);
    if (repair.kind === 'needs_input') {
      return {
        status: 'needs_input',
        questions: repair.questions,
        validation: { ok: false, findings: repair.findings },
        ...(modelOutput.enhancedPrompt ? { enhancedPrompt: modelOutput.enhancedPrompt } : {}),
      };
    }
    if (repair.kind === 'reject') {
      return {
        status: 'invalid',
        questions: [],
        validation: { ok: false, findings: repair.findings },
        ...(modelOutput.enhancedPrompt ? { enhancedPrompt: modelOutput.enhancedPrompt } : {}),
      };
    }

    // 3. Forbidden-infrastructure scope gate (scheduler/controller/lease/…).
    const hints = modelOutput.structuredHints;
    const infra = scanForForbiddenInfra(
      hintString(hints, 'scope'),
      hintString(hints, 'outcome'),
      hintString(hints, 'repositoryEvidence'),
      hintString(hints, 'topology'),
      hintString(hints, 'contracts'),
      input.sourcePrompt,
      input.enhancedPrompt ?? '',
      modelOutput.enhancedPrompt ?? '',
    );

    // 4. Build the IR, then validate generically + per-profile.
    const budget = repair.budget;
    const ir = buildIR(input, hints, budget);

    // 4a. Catch-all forbidden-infra scan over the FULLY-BUILT IR. The step-3 scan
    //     only covers specific hint fields; a model can still smuggle forbidden
    //     language into ir.title or any acceptance[].description (both flow into
    //     the IR and the mission criteria). Scanning JSON.stringify(ir) catches
    //     every string field — title, outcome, node labels, acceptance text, and
    //     profileData — closing the bypass. Deduped against the step-3 findings.
    const irInfra = scanForForbiddenInfra(JSON.stringify(ir));
    const seenInfra = new Set(infra.map((f) => f.message));
    const dedupedIrInfra = irInfra.filter((f) => !seenInfra.has(f.message));
    const allInfra = [...infra, ...dedupedIrInfra];

    const generic = validateLoopIR(ir);
    const profileFindings = this.validateProfileData ? this.validateProfileData(ir) : [];

    const allFindings = [...generic.findings, ...allInfra, ...profileFindings];
    const ok =
      generic.ok && allInfra.length === 0 && !profileFindings.some((f) => f.severity === 'error');

    if (!ok) {
      return {
        status: 'invalid',
        questions: [],
        validation: { ok: false, findings: allFindings },
        ...(modelOutput.enhancedPrompt ? { enhancedPrompt: modelOutput.enhancedPrompt } : {}),
      };
    }

    return {
      status: 'ready',
      ir,
      questions: [],
      validation: { ok: true, findings: allFindings },
      ...(modelOutput.enhancedPrompt ? { enhancedPrompt: modelOutput.enhancedPrompt } : {}),
    };
  },

  validateProfileData(ir: LoopIR): ValidationFinding[] {
    const findings: ValidationFinding[] = [];
    const data = ir.profileData;
    if (!data || typeof data !== 'object') {
      findings.push({
        code: 'profile.missing_data',
        message: 'software profileData missing',
        severity: 'error',
      });
      return findings;
    }
    // Re-scan the built profileData for forbidden infra (defense in depth: a value
    // could be assembled from multiple hint fields).
    const scopeText = typeof data.scope === 'string' ? data.scope : '';
    const evidenceText = typeof data.repositoryEvidence === 'string' ? data.repositoryEvidence : '';
    findings.push(...scanForForbiddenInfra(scopeText, evidenceText));
    return findings;
  },
};
