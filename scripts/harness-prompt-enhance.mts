/**
 * Prompt Enhance deterministic harness (PR-06).
 *
 * Proves the contract + span-validation layer WITHOUT a live model: every model
 * call is injected (a fake transport returns canned "enhanced" text), so this gate
 * tests exactly the deterministic part — request building, versioned profiles,
 * protected-span extraction, the INVALID-blocks-Apply rule, the loop_design ≤3
 * questions cap, and the profile guardrail guidance — none of which depend on a
 * model being reachable.
 *
 * It also asserts the HOST enhance path is isolated (zero tools, no persistence,
 * no extension factories) by reading the entry.mjs source, since the "no
 * persistence side effects" requirement is a property of the host config, not of
 * the pure layer. Run via `pnpm harness:prompt-enhance` (in the validate chain).
 *
 * Style mirrors the neighboring `.mts` harnesses: a `check(...)` counter, a final
 * pass/fail summary, exit code 0/1.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ENHANCE_SPAN_LOST_WARNING,
  type PromptEnhanceProfile,
  resultIsApplyable,
} from '../apps/desktop/renderer/src/assistant/enhance/contract.js';
import {
  allEnhanceProfiles,
  getEnhanceProfile,
} from '../apps/desktop/renderer/src/assistant/enhance/profiles.js';
import {
  extractProtectedSpans,
  validateProtectedSpans,
} from '../apps/desktop/renderer/src/assistant/enhance/protected-spans.js';
import {
  type EnhanceTransport,
  type EnhanceTransportResult,
  assembleEnhanceResult,
  buildEnhanceRequest,
  runEnhance,
} from '../apps/desktop/renderer/src/assistant/enhance/service.js';

let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail?: string): void {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('prompt-enhance gate');

// A transport that echoes canned text — the model is never called.
function fakeTransport(text: string, hints?: Record<string, unknown>): EnhanceTransport {
  return {
    async run(): Promise<EnhanceTransportResult> {
      return { text, ...(hints ? { structuredHints: hints } : {}) };
    },
  };
}

const ROSTER = [
  { id: 'e-alice', label: 'Alice', role: 'Engineer' },
  { id: 'e-bob', label: 'Bob', role: 'Designer' },
];

// ── Scenario A: request building + versioned profiles ───────────────────────
{
  const profiles: PromptEnhanceProfile[] = [
    'office_instruction',
    'collaboration_message',
    'loop_design',
  ];
  for (const profile of profiles) {
    const req = buildEnhanceRequest({ profile, text: 'do the thing', protectedSpans: [] });
    check(`${profile}: request defaults locale to en`, req.locale === 'en');
    check(`${profile}: request carries the profile`, req.profile === profile);
    const def = getEnhanceProfile(profile);
    check(`${profile}: has a versioned profileVersion`, /@\d+$/.test(def.version), def.version);
  }
  // The result must echo the resolved profileVersion (so a downstream consumer
  // can audit which instruction produced an enhancement).
  const def = getEnhanceProfile('office_instruction');
  const req = buildEnhanceRequest({ profile: 'office_instruction', text: 'ship it', protectedSpans: [] });
  const result = assembleEnhanceResult(req, def, { text: 'Ship it by Friday with tests passing.' });
  check('result.profileVersion matches the profile', result.profileVersion === def.version);
}

// ── Scenario B: span extraction for every kind ───────────────────────────────
{
  const mentionSpans = extractProtectedSpans('Hey @Alice please review', ROSTER);
  check(
    'extracts a mention span',
    mentionSpans.some((s) => s.kind === 'mention' && s.source === '@Alice'),
    JSON.stringify(mentionSpans),
  );

  const varSpans = extractProtectedSpans('Set {{deadline}} on the task', ROSTER);
  check(
    'extracts a {{variable}} span',
    varSpans.some((s) => s.kind === 'variable' && s.source === '{{deadline}}'),
    JSON.stringify(varSpans),
  );

  const codeText = 'Run this:\n```\nnpm test\n```\nthanks';
  const codeSpans = extractProtectedSpans(codeText, ROSTER);
  check(
    'extracts a fenced code span',
    codeSpans.some((s) => s.kind === 'code' && s.source.includes('npm test')),
    JSON.stringify(codeSpans),
  );

  const pathSpans = extractProtectedSpans('Edit src/app/main.ts now', ROSTER);
  check(
    'extracts an inline path span',
    pathSpans.some((s) => s.kind === 'path' && s.source === 'src/app/main.ts'),
    JSON.stringify(pathSpans),
  );

  const attSpans = extractProtectedSpans('See @@att:abc-123 attached', ROSTER);
  check(
    'extracts an attachment id span',
    attSpans.some((s) => s.kind === 'attachment' && s.source === '@@att:abc-123'),
    JSON.stringify(attSpans),
  );

  const loopSpans = extractProtectedSpans('Tie into [[loop:design-rev]] each sprint', ROSTER);
  check(
    'extracts a loop_ref span (reserved for PR-10)',
    loopSpans.some((s) => s.kind === 'loop_ref' && s.source === '[[loop:design-rev]]'),
    JSON.stringify(loopSpans),
  );

  // Deterministic ids: two extractions of the same text are identical.
  const a = extractProtectedSpans('@Alice see src/x.ts', ROSTER);
  const b = extractProtectedSpans('@Alice see src/x.ts', ROSTER);
  check('span extraction is deterministic', JSON.stringify(a) === JSON.stringify(b));

  // A path inside a code fence is claimed once (by the code span), not double-counted.
  const overlap = extractProtectedSpans('```\ncat src/a/b.ts\n```', ROSTER);
  check(
    'overlapping path inside code fence is not double-claimed',
    overlap.filter((s) => s.kind === 'path').length === 0,
    JSON.stringify(overlap),
  );
}

// ── Scenario C: INVALID when a span is dropped → Apply blocked ───────────────
{
  const def = getEnhanceProfile('office_instruction');
  const text = 'Hey @Alice, update {{deadline}} in src/app/main.ts';
  const spans = extractProtectedSpans(text, ROSTER);
  check('original text has ≥3 protected spans', spans.length >= 3, String(spans.length));

  // All spans preserved → applyable.
  const keptText = `${text} — and add tests`;
  const goodReq = buildEnhanceRequest({ profile: 'office_instruction', text, protectedSpans: spans });
  const good = assembleEnhanceResult(goodReq, def, { text: keptText });
  check('span-preserving enhance is applyable', resultIsApplyable(good));
  check('span-preserving enhance has no span-lost warning', !good.warnings.includes(ENHANCE_SPAN_LOST_WARNING));
  check('preservedSpanIds covers every span', good.preservedSpanIds.length === spans.length);

  // Drop the mention → INVALID → Apply blocked.
  const mangledText = 'Hey team, update {{deadline}} in src/app/main.ts';
  const bad = assembleEnhanceResult(goodReq, def, { text: mangledText });
  check('span-dropping enhance is NOT applyable', !resultIsApplyable(bad));
  check(
    'span-dropping enhance emits the span-lost marker',
    bad.warnings.includes(ENHANCE_SPAN_LOST_WARNING),
    JSON.stringify(bad.warnings),
  );

  // Lower-level validator agrees.
  const v = validateProtectedSpans(mangledText, spans);
  check('validator reports the dropped span as lost', v.valid === false && v.lostSpanIds.length === 1);

  // Multiplicity: two distinct spans sharing the same source. Dropping ONE
  // occurrence must mark exactly one span lost — a model cannot collapse
  // `{{deadline}} … {{deadline}}` to a single `{{deadline}}` and slip through.
  const dupText = 'Set {{deadline}} and reconfirm {{deadline}} with the team';
  const dupSpans = extractProtectedSpans(dupText, ROSTER);
  check('duplicate-source extracts two distinct spans', dupSpans.filter((s) => s.source === '{{deadline}}').length === 2, String(dupSpans.length));
  check('both occurrences present → valid', validateProtectedSpans(dupText, dupSpans).valid === true);
  const dupDropped = validateProtectedSpans('Set {{deadline}} with the team', dupSpans);
  check('dropping one of two same-source spans is INVALID', dupDropped.valid === false && dupDropped.lostSpanIds.length === 1);
}

// ── Scenario D: empty / very short / very long / multilingual ────────────────
{
  const def = getEnhanceProfile('collaboration_message');
  const short = buildEnhanceRequest({ profile: 'collaboration_message', text: 'ok', protectedSpans: [] });
  const shortRes = assembleEnhanceResult(short, def, { text: 'Sounds good.' });
  check('very short text enhances without spans', resultIsApplyable(shortRes));

  const longSource = `Please ${'review '.repeat(2000)}@Alice`;
  const longSpans = extractProtectedSpans(longSource, ROSTER);
  const longReq = buildEnhanceRequest({
    profile: 'collaboration_message',
    text: longSource,
    protectedSpans: longSpans,
  });
  // Enhanced output keeps the mention → applyable even at length.
  const longRes = assembleEnhanceResult(longReq, def, { text: `Reviewed. Thanks @Alice` });
  check('very long text still validates the mention span', resultIsApplyable(longRes));

  // Multilingual: a CJK message with a mention; the mention must still be guarded.
  const zh = '请 @Bob 看一下 {{需求}} 文档';
  const zhSpans = extractProtectedSpans(zh, ROSTER);
  check(
    'multilingual text extracts mention + variable',
    zhSpans.some((s) => s.kind === 'mention' && s.source === '@Bob') &&
      zhSpans.some((s) => s.kind === 'variable' && s.source === '{{需求}}'),
    JSON.stringify(zhSpans),
  );
  const zhReq = buildEnhanceRequest({ profile: 'collaboration_message', text: zh, protectedSpans: zhSpans });
  const zhDropped = assembleEnhanceResult(zhReq, def, { text: '请看一下文档' });
  check('multilingual span loss blocks Apply', !resultIsApplyable(zhDropped));
}

// ── Scenario E: loop_design emits ≤3 questions ──────────────────────────────
{
  const def = getEnhanceProfile('loop_design');
  check('loop_design wants structured hints', def.wantsStructuredHints === true);

  const fiveQuestions = [
    'Here is a rough loop design.',
    '1. What is the exit condition?',
    '2. What is the budget?',
    '3. Who approves the output?',
    '4. What are the inputs?',
    '5. What oracle verifies it?',
  ].join('\n');
  const req = buildEnhanceRequest({ profile: 'loop_design', text: 'a review loop', protectedSpans: [] });
  const res = assembleEnhanceResult(req, def, { text: fiveQuestions });
  const questions = (res.structuredHints?.questions as string[] | undefined) ?? [];
  check('loop_design caps questions at 3', questions.length <= 3, `got ${questions.length}`);
  check('loop_design surfaces structuredHints', res.structuredHints !== undefined);
}

// ── Scenario F: profile PROMPTS carry their guardrail guidance ──────────────
{
  const office = getEnhanceProfile('office_instruction').systemPrompt.toLowerCase();
  check(
    'office prompt forbids unauthorized destructive permissions',
    office.includes('destructive') && office.includes('never') && office.includes('permission'),
  );
  check('office prompt forbids inventing tools', office.includes('invent') && office.includes('tool'));

  const collab = getEnhanceProfile('collaboration_message').systemPrompt.toLowerCase();
  check(
    'collaboration prompt forbids task-list expansion',
    collab.includes('task list') && collab.includes('not'),
  );
  check(
    'collaboration prompt forbids Office/Loop jargon',
    collab.includes('jargon') || (collab.includes('loop') && collab.includes('do not add')),
  );

  const loop = getEnhanceProfile('loop_design').systemPrompt.toLowerCase();
  check('loop prompt caps clarifying questions at 3', loop.includes('3') && loop.includes('question'));
  check('loop prompt forbids raw evaluator JSON', loop.includes('json') && loop.includes('never'));

  // Every profile inherits the protected-span fidelity instruction.
  for (const def of allEnhanceProfiles()) {
    const p = def.systemPrompt.toLowerCase();
    check(`${def.profile} prompt instructs span preservation`, p.includes('exactly') || p.includes('preserve'));
  }
}

// ── Scenario G: cancellation surfaces EnhanceCancelledError, no result ───────
{
  const controller = new AbortController();
  controller.abort();
  const req = buildEnhanceRequest({ profile: 'office_instruction', text: 'x', protectedSpans: [] });
  let threw = false;
  try {
    await runEnhance(req, fakeTransport('enhanced'), controller.signal);
  } catch (err) {
    threw = (err as Error).name === 'EnhanceCancelledError';
  }
  check('aborted enhance throws EnhanceCancelledError', threw);
}

// ── Scenario H: HOST enhance path is isolated (no tools, no persistence) ─────
{
  const entryPath = fileURLToPath(
    new URL('./tauri-pi-agent-host.entry.mjs', import.meta.url),
  );
  const entry = readFileSync(entryPath, 'utf8');
  const enhanceStart = entry.indexOf('async function runEnhance(');
  // End the slice at the NEXT top-level function after runEnhance — NOT at
  // `function main()`. Other isolated host paths (e.g. runCollaboration) live
  // between runEnhance and main(); anchoring on main() would over-capture their
  // bodies and let an unrelated function's `extensionFactories` fail this
  // enhance-only isolation check. The next `(async )?function ` boundary bounds
  // the slice to runEnhance itself.
  const nextFnRe = /\n(?:async )?function /g;
  nextFnRe.lastIndex = enhanceStart + 1;
  const nextFn = nextFnRe.exec(entry);
  const enhanceEnd = nextFn ? nextFn.index : -1;
  // Guard the slice boundaries: a missing anchor (-1) would make slice() capture
  // (nearly) the whole file and let the isolation checks below pass vacuously.
  check('runEnhance boundary found in host source', enhanceStart >= 0, String(enhanceStart));
  check('next-function boundary found after runEnhance', enhanceEnd > enhanceStart, `${enhanceStart}..${enhanceEnd}`);
  const enhanceFn = entry.slice(enhanceStart, enhanceEnd);
  // A real runEnhance body is ~5 KB; an 8 KB ceiling catches a runaway slice.
  check('runEnhance slice is bounded (not the whole file)', enhanceFn.length < 8000, String(enhanceFn.length));
  // Test CODE, not prose: a sibling function's doc comment (e.g. runCollaboration
  // documenting "ZERO extensionFactories") can fall just inside this slice. Strip
  // comments so the isolation assertions reflect what runEnhance actually does.
  const enhanceCode = enhanceFn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  check('host registers a dedicated enhance dispatch', entry.includes("payload.mode === 'enhance'"));
  check('host enhance uses noTools: all', /noTools:\s*'all'/.test(enhanceCode));
  check('host enhance passes an empty tool allowlist', /tools:\s*\[\]/.test(enhanceCode));
  check(
    'host enhance registers NO extension factories',
    !enhanceCode.includes('extensionFactories'),
    'enhance must not pass extensionFactories',
  );
  check(
    'host enhance never binds a project workspace',
    !enhanceCode.includes('ensureProjectBoundForRun') && !enhanceCode.includes('project_read_file'),
  );
  check(
    'host enhance creates an ephemeral session (no session dir persistence)',
    /SessionManager\.create\(cwd\)/.test(enhanceCode) && !/sessionDir/.test(enhanceCode),
  );
  check(
    'host enhance never writes agent_runs / chat_threads / mission tables',
    !/agent_runs|chat_threads|collaboration_|mission_/.test(enhanceCode),
  );
  check(
    'host enhance throws on any tool execution (isolation breach guard)',
    enhanceCode.includes('isolation breach') || enhanceCode.includes('must not execute tools'),
  );
}

console.log(`\nprompt-enhance: ${checks - failures}/${checks} checks passed`);
if (failures > 0) {
  console.error(`prompt-enhance gate FAILED with ${failures} failing check(s)`);
  process.exit(1);
}
console.log('prompt-enhance gate OK');
