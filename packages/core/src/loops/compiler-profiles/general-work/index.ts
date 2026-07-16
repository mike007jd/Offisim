import type { LoopAcceptanceItem, LoopEdge, LoopIR, LoopNode } from '@offisim/shared-types';
import { defaultBudgetForTier, repairOrReject } from '../../repair.js';
import type {
  LoopCompileInput,
  LoopCompileModel,
  LoopCompileResult,
  LoopCompilerProfile,
  LoopModelOutput,
} from '../../types.js';
import { LOOP_COMPILER_VERSION } from '../../types.js';
import { validateLoopIR } from '../../validate.js';

export const GENERAL_WORK_PROFILE_ID = 'general-work' as const;
export const GENERAL_WORK_PROFILE_VERSION = '1.0.0' as const;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function cleanLabel(value: string): string {
  const text = value
    .trim()
    .replace(/^[\s,.;:—-]+|[\s,.;:—-]+$/g, '')
    .replace(/\s+/g, ' ');
  if (!text) return '';
  const sentence = `${text[0]?.toUpperCase()}${text.slice(1)}`;
  return sentence.length > 72 ? `${sentence.slice(0, 69)}…` : sentence;
}

function deriveTitle(prompt: string): string {
  const first = cleanLabel(prompt.split(/[\n.;]/)[0] ?? '');
  if (!first) return 'New loop';
  return first.length > 56 ? `${first.slice(0, 53)}…` : first;
}

function retryLimit(prompt: string): number | null {
  const raw = prompt.match(
    /after\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:failed\s+)?(?:attempts?|tries|failures?|reviews?|runs?|checks?|cycles?)/i,
  )?.[1];
  if (!raw) return null;
  const parsed = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw.toLowerCase()];
  return Math.max(1, Math.min(parsed ?? 3, 10));
}

function exitCondition(prompt: string): string {
  const match =
    prompt.match(/(?:stop|finish|end)\s+(?:(?:when|once|after)\s+)?([^;,.]+)/i)?.[1] ??
    prompt.match(/complete\s+(?:when|once|after)\s+([^;,.]+)/i)?.[1] ??
    prompt.match(/until\s+([^;,.]+)/i)?.[1];
  return cleanLabel(match ?? 'the intended result is complete');
}

function escalation(prompt: string, explicitRetryLimit: number | null): {
  label: string;
  edgeLabel: string;
} {
  const afterFailures = prompt.match(
    /after\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:failed\s+)?(?:attempts?|tries|failures?|reviews?|runs?|checks?|cycles?)\s*,?\s*(.+)$/i,
  )?.[1];
  if (afterFailures) {
    return {
      label: cleanLabel(afterFailures),
      edgeLabel: `after ${explicitRetryLimit ?? 3} attempts`,
    };
  }

  const conditional = prompt.match(
    /(?:^|[;.]\s*)(if|when)\s+([^;,.]+),?\s*((?:ask|pause|notify|escalate)\b[^;,.]*)/i,
  );
  if (conditional) {
    const condition = cleanLabel(conditional[2] ?? '');
    return {
      label: cleanLabel(conditional[3] ?? 'Ask for help'),
      edgeLabel: `${conditional[1]?.toLowerCase()} ${condition[0]?.toLowerCase()}${condition.slice(1)}`,
    };
  }

  return {
    label: 'Ask for help',
    edgeLabel: explicitRetryLimit ? `after ${explicitRetryLimit} attempts` : 'if blocked',
  };
}

function actionLabels(prompt: string): string[] {
  const firstPass = prompt.split(';')[0] ?? prompt;
  const withoutCadence = firstPass.replace(/^(?:every|each|on|when|whenever)\b[^,]*,\s*/i, '');
  const withoutExit = withoutCadence.replace(
    /(?:,?\s*and\s+)?(?:(?:stop|finish|end)\s+(?:(?:when|once|after)\s+)?|complete\s+(?:when|once|after)\s+|until\s+).+$/i,
    '',
  );
  const labels = withoutExit
    .split(/\s*,\s*|\s+and\s+/i)
    .map(cleanLabel)
    .filter(Boolean);
  return labels.length > 0 ? labels.slice(0, 8) : [cleanLabel(prompt) || 'Do the work'];
}

function buildIR(input: LoopCompileInput, modelOutput: LoopModelOutput): LoopIR {
  const hints = modelOutput.structuredHints;
  const title =
    typeof hints?.title === 'string' && hints.title.trim()
      ? cleanLabel(hints.title)
      : deriveTitle(input.sourcePrompt);
  const outcome =
    typeof hints?.outcome === 'string' && hints.outcome.trim()
      ? hints.outcome.trim()
      : input.sourcePrompt.trim();
  const labels = actionLabels(input.sourcePrompt);
  const explicitRetryLimit = retryLimit(input.sourcePrompt);
  const completionLabel = exitCondition(input.sourcePrompt);
  const escalationPath = escalation(input.sourcePrompt, explicitRetryLimit);

  const nodes: LoopNode[] = [{ id: 'n_start', kind: 'start', label: 'Start' }];
  labels.forEach((label, index) => {
    const isVerification = /\b(check|verify|test|review results?|validate)\b/i.test(label);
    nodes.push({
      id: `n_step_${index + 1}`,
      kind: isVerification ? 'verify' : 'action',
      label,
    });
  });
  nodes.push(
    { id: 'n_decide', kind: 'decision', label: completionLabel },
    { id: 'n_done', kind: 'finish', label: 'Done' },
    { id: 'n_help', kind: 'finish', label: escalationPath.label },
  );

  const edges: LoopEdge[] = [];
  for (let index = 0; index < labels.length; index += 1) {
    edges.push({
      id: `e_step_${index + 1}`,
      from: index === 0 ? 'n_start' : `n_step_${index}`,
      to: `n_step_${index + 1}`,
      kind: 'next',
    });
  }
  edges.push(
    {
      id: 'e_decide',
      from: `n_step_${labels.length}`,
      to: 'n_decide',
      kind: 'next',
    },
    { id: 'e_success', from: 'n_decide', to: 'n_done', kind: 'next', label: 'yes' },
    {
      id: 'e_retry',
      from: 'n_decide',
      to: 'n_step_1',
      kind: explicitRetryLimit ? 'retry' : 'feedback',
      label: 'not yet',
      ...(explicitRetryLimit ? { maxRetries: explicitRetryLimit } : {}),
    },
    {
      id: 'e_escalate',
      from: 'n_decide',
      to: 'n_help',
      kind: 'escalate',
      label: escalationPath.edgeLabel,
    },
  );

  const acceptance: LoopAcceptanceItem[] = [
    {
      id: 'acc_outcome',
      description: completionLabel,
      oracle: 'review',
      required: true,
    },
  ];
  const budget = defaultBudgetForTier('light');
  if (explicitRetryLimit) budget.maxFixWavesPerGate = explicitRetryLimit;

  return {
    schemaVersion: '1',
    title,
    outcome,
    inputs: [],
    outputs: [{ id: 'out_result', label: 'Result', type: 'artifact', required: true }],
    parameters: [],
    nodes,
    edges,
    completion: {
      outcome,
      acceptance,
      exitStates: ['success', 'blocked-handoff'],
    },
    budget,
    humanGates: [],
    skillBindings: [],
    profileData: {
      cadence: input.sourcePrompt.match(/^(?:every|each|on|when|whenever)\b[^,]*/i)?.[0] ?? '',
      retryLimit: explicitRetryLimit,
    },
    metadata: {
      profileId: GENERAL_WORK_PROFILE_ID,
      profileVersion: GENERAL_WORK_PROFILE_VERSION,
      compilerVersion: LOOP_COMPILER_VERSION,
    },
  };
}

export const generalWorkProfile: LoopCompilerProfile = {
  id: GENERAL_WORK_PROFILE_ID,
  version: GENERAL_WORK_PROFILE_VERSION,
  displayName: 'General Work',
  description:
    'Turn a plain-language recurring job into a reviewable plan with clear retry and exit paths.',
  systemInstruction:
    'Turn the request into concise natural-language steps. Preserve the user goal, repetition, stopping condition, retry limit, and escalation exactly. Do not add software-development process unless the user asked for it.',
  referenceAssets: [],
  defaultBudget: defaultBudgetForTier('light'),
  enhanceProfile: 'loop_design',

  async compile(input: LoopCompileInput, model: LoopCompileModel): Promise<LoopCompileResult> {
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

    const ir = buildIR(input, modelOutput);
    const validation = validateLoopIR(ir);
    if (!validation.ok) {
      return {
        status: 'invalid',
        questions: [],
        validation,
        ...(modelOutput.enhancedPrompt ? { enhancedPrompt: modelOutput.enhancedPrompt } : {}),
      };
    }
    return {
      status: 'ready',
      ir,
      questions: [],
      validation,
      ...(modelOutput.enhancedPrompt ? { enhancedPrompt: modelOutput.enhancedPrompt } : {}),
    };
  },
};
