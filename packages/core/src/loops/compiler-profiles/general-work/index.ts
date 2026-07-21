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

const RETRY_NOUNS = [
  'attempts',
  'attempt',
  'failures',
  'failure',
  'reviews',
  'review',
  'checks',
  'check',
  'cycles',
  'cycle',
  'tries',
  'runs',
  'run',
] as const;
const ESCALATION_VERBS = ['ask', 'pause', 'notify', 'escalate'] as const;
const CADENCE_WORDS = ['whenever', 'every', 'each', 'when', 'on'] as const;
const ESCALATION_SEPARATORS = ',.;:—-';

function isWhitespace(char: string | undefined): boolean {
  return char !== undefined && /\s/u.test(char);
}

function isAsciiWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/u.test(char);
}

function skipWhitespace(value: string, start: number): number {
  let index = start;
  while (index < value.length && isWhitespace(value[index])) index += 1;
  return index;
}

function skipWhitespaceBackward(value: string, start: number): number {
  let index = start;
  while (index > 0 && isWhitespace(value[index - 1])) index -= 1;
  return index;
}

function matchesWord(value: string, index: number, word: string): boolean {
  return value.slice(index, index + word.length).toLowerCase() === word;
}

function matchingWord(
  value: string,
  index: number,
  words: readonly string[],
  requireTrailingBoundary = false,
): string | null {
  for (const word of words) {
    if (!matchesWord(value, index, word)) continue;
    if (requireTrailingBoundary && isAsciiWordChar(value[index + word.length])) continue;
    return word;
  }
  return null;
}

function cleanLabel(value: string): string {
  const isBoundary = (char: string | undefined) =>
    isWhitespace(char) || (char !== undefined && ',.;:—-'.includes(char));
  let start = 0;
  let end = value.length;
  while (start < end && isBoundary(value[start])) start += 1;
  while (end > start && isBoundary(value[end - 1])) end -= 1;

  let text = '';
  let pendingSpace = false;
  for (let index = start; index < end; index += 1) {
    const char = value[index];
    if (isWhitespace(char)) {
      pendingSpace = text.length > 0;
      continue;
    }
    if (pendingSpace) text += ' ';
    text += char;
    pendingSpace = false;
  }
  if (!text) return '';
  const sentence = `${text[0]?.toUpperCase()}${text.slice(1)}`;
  return sentence.length > 72 ? `${sentence.slice(0, 69)}…` : sentence;
}

function deriveTitle(prompt: string): string {
  const first = cleanLabel(prompt.split(/[\n.;]/)[0] ?? '');
  if (!first) return 'New loop';
  return first.length > 56 ? `${first.slice(0, 53)}…` : first;
}

interface RetryClause {
  readonly rawLimit: string;
  readonly end: number;
}

function findRetryClause(prompt: string): RetryClause | null {
  const numberWords = Object.keys(NUMBER_WORDS);
  for (let start = 0; start <= prompt.length - 'after'.length; start += 1) {
    if (!matchesWord(prompt, start, 'after')) continue;
    let index = start + 'after'.length;
    if (!isWhitespace(prompt[index])) continue;
    index = skipWhitespace(prompt, index);

    const limitStart = index;
    while (index < prompt.length && /[0-9]/u.test(prompt[index] ?? '')) index += 1;
    if (index === limitStart) {
      const numberWord = matchingWord(prompt, index, numberWords);
      if (!numberWord) continue;
      index += numberWord.length;
    }
    const rawLimit = prompt.slice(limitStart, index);
    if (!isWhitespace(prompt[index])) continue;
    index = skipWhitespace(prompt, index);

    if (matchesWord(prompt, index, 'failed') && isWhitespace(prompt[index + 'failed'.length])) {
      index = skipWhitespace(prompt, index + 'failed'.length);
    }
    const noun = matchingWord(prompt, index, RETRY_NOUNS);
    if (!noun) continue;
    return { rawLimit, end: index + noun.length };
  }
  return null;
}

function retryLimit(prompt: string): number | null {
  const raw = findRetryClause(prompt)?.rawLimit;
  if (!raw) return null;
  const parsed = /^[0-9]+$/u.test(raw) ? Number(raw) : NUMBER_WORDS[raw.toLowerCase()];
  return Math.max(1, Math.min(parsed ?? 3, 10));
}

function exitCondition(prompt: string): string {
  const match =
    prompt.match(/(?:stop|finish|end)\s+(?:(?:when|once|after)\s+)?([^;,.]+)/i)?.[1] ??
    prompt.match(/complete\s+(?:when|once|after)\s+([^;,.]+)/i)?.[1] ??
    prompt.match(/until\s+([^;,.]+)/i)?.[1];
  return cleanLabel(match ?? 'the intended result is complete');
}

function escalation(
  prompt: string,
  explicitRetryLimit: number | null,
): {
  label: string;
  edgeLabel: string;
} {
  const retryClause = findRetryClause(prompt);
  let afterFailures: string | null = null;
  const retrySuffix = retryClause ? prompt[retryClause.end] : undefined;
  if (
    retryClause &&
    (isWhitespace(retrySuffix) ||
      (retrySuffix !== undefined && ESCALATION_SEPARATORS.includes(retrySuffix)))
  ) {
    let remainderStart = retryClause.end;
    while (
      isWhitespace(prompt[remainderStart]) ||
      ESCALATION_SEPARATORS.includes(prompt[remainderStart] ?? '')
    ) {
      remainderStart += 1;
    }
    let remainderEnd = prompt.length;
    if (prompt.endsWith('\n')) remainderEnd -= 1;
    if (remainderEnd > 0 && prompt[remainderEnd - 1] === '\r') remainderEnd -= 1;
    const remainder = prompt.slice(remainderStart, remainderEnd);
    if (remainder.length > 0 && !remainder.includes('\n') && !remainder.includes('\r')) {
      afterFailures = remainder;
    }
  }
  if (afterFailures) {
    return {
      label: cleanLabel(afterFailures),
      edgeLabel: `after ${explicitRetryLimit ?? 3} attempts`,
    };
  }

  const conditional = findConditionalEscalation(prompt);
  if (conditional) {
    const condition = cleanLabel(conditional.condition);
    return {
      label: cleanLabel(conditional.action),
      edgeLabel: `${conditional.keyword} ${condition[0]?.toLowerCase()}${condition.slice(1)}`,
    };
  }

  return {
    label: 'Ask for help',
    edgeLabel: explicitRetryLimit ? `after ${explicitRetryLimit} attempts` : 'if blocked',
  };
}

interface ConditionalEscalation {
  readonly keyword: 'if' | 'when';
  readonly condition: string;
  readonly action: string;
}

function findEscalationVerb(value: string, start: number, end: number): number {
  let match = -1;
  for (let index = start + 1; index < end; index += 1) {
    const verb = matchingWord(value, index, ESCALATION_VERBS, true);
    if (verb) match = index;
  }
  return match;
}

function findConditionalEscalation(prompt: string): ConditionalEscalation | null {
  let clauseStart = 0;
  while (clauseStart < prompt.length) {
    let clauseEnd = clauseStart;
    while (clauseEnd < prompt.length && prompt[clauseEnd] !== ';' && prompt[clauseEnd] !== '.') {
      clauseEnd += 1;
    }
    const keywordStart = skipWhitespace(prompt, clauseStart);
    const keyword = matchingWord(prompt, keywordStart, ['if', 'when'], true) as
      | 'if'
      | 'when'
      | null;
    if (keyword) {
      let conditionStart = keywordStart + keyword.length;
      if (isWhitespace(prompt[conditionStart])) {
        conditionStart = skipWhitespace(prompt, conditionStart);
        let boundedComma = -1;
        for (let index = conditionStart; index < clauseEnd; index += 1) {
          if (prompt[index] === ',') {
            boundedComma = index;
            break;
          }
        }
        const actionStart =
          boundedComma >= 0
            ? skipWhitespace(prompt, boundedComma + 1)
            : findEscalationVerb(prompt, conditionStart, clauseEnd);
        const verb =
          actionStart >= 0 ? matchingWord(prompt, actionStart, ESCALATION_VERBS, true) : null;
        if (verb) {
          let actionEnd = actionStart;
          while (
            actionEnd < prompt.length &&
            prompt[actionEnd] !== ';' &&
            prompt[actionEnd] !== ',' &&
            prompt[actionEnd] !== '.'
          ) {
            actionEnd += 1;
          }
          return {
            keyword,
            condition: prompt.slice(conditionStart, boundedComma >= 0 ? boundedComma : actionStart),
            action: prompt.slice(actionStart, actionEnd),
          };
        }
      }
    }

    if (clauseEnd >= prompt.length) break;
    clauseStart = clauseEnd + 1;
  }
  return null;
}

function stripCadence(firstPass: string): string {
  const cadence = matchingWord(firstPass, 0, CADENCE_WORDS, true);
  if (!cadence) return firstPass;
  const comma = firstPass.indexOf(',');
  return comma < 0 ? firstPass : firstPass.slice(skipWhitespace(firstPass, comma + 1));
}

function exitPhraseAt(value: string, index: number): boolean {
  const simple = matchingWord(value, index, ['stop', 'finish', 'end']);
  if (simple) {
    let cursor = index + simple.length;
    if (!isWhitespace(value[cursor])) return false;
    cursor = skipWhitespace(value, cursor);
    const qualifier = matchingWord(value, cursor, ['when', 'once', 'after'], true);
    return !qualifier || isWhitespace(value[cursor + qualifier.length]);
  }

  if (matchesWord(value, index, 'complete')) {
    let cursor = index + 'complete'.length;
    if (!isWhitespace(value[cursor])) return false;
    cursor = skipWhitespace(value, cursor);
    const qualifier = matchingWord(value, cursor, ['when', 'once', 'after'], true);
    return Boolean(qualifier && isWhitespace(value[cursor + (qualifier?.length ?? 0)]));
  }

  return matchesWord(value, index, 'until') && isWhitespace(value[index + 'until'.length]);
}

function includePrecedingAnd(value: string, markerStart: number): number {
  const beforeMarker = skipWhitespaceBackward(value, markerStart);
  const andStart = beforeMarker - 'and'.length;
  if (andStart < 0 || !matchesWord(value, andStart, 'and')) return markerStart;
  if (andStart > 0 && isAsciiWordChar(value[andStart - 1])) return markerStart;
  let start = skipWhitespaceBackward(value, andStart);
  if (start > 0 && value[start - 1] === ',') start -= 1;
  return start;
}

function stripExitSuffix(value: string): string {
  for (let index = 0; index < value.length; index += 1) {
    if (exitPhraseAt(value, index)) return value.slice(0, includePrecedingAnd(value, index));
  }
  return value;
}

function splitActions(value: string): string[] {
  const parts: string[] = [];
  let partStart = 0;
  let index = 0;
  while (index < value.length) {
    if (value[index] === ',') {
      parts.push(value.slice(partStart, index));
      index = skipWhitespace(value, index + 1);
      partStart = index;
      continue;
    }
    if (isWhitespace(value[index])) {
      const whitespaceStart = index;
      const wordStart = skipWhitespace(value, index);
      if (matchesWord(value, wordStart, 'and') && isWhitespace(value[wordStart + 'and'.length])) {
        parts.push(value.slice(partStart, whitespaceStart));
        index = skipWhitespace(value, wordStart + 'and'.length);
        partStart = index;
        continue;
      }
      index = wordStart;
      continue;
    }
    index += 1;
  }
  parts.push(value.slice(partStart));
  return parts;
}

function actionLabels(prompt: string): string[] {
  const semicolon = prompt.indexOf(';');
  const firstPass = semicolon < 0 ? prompt : prompt.slice(0, semicolon);
  const labels = splitActions(stripExitSuffix(stripCadence(firstPass)))
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
