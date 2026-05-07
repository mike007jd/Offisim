/**
 * task-tool-intent — single source of truth for "does this task description
 * require Offisim-local file / shell / workspace tools?"
 *
 * Owns the keyword vocabularies (English + Chinese), false-positive guards,
 * and the structured `TaskToolIntent` record consumed by both routing
 * (boss / manager / pm-planner / direct-setup) and completion-evidence
 * verification. Pure, deterministic, side-effect-free.
 */

import type { EmployeeRow } from '../runtime/repositories.js';

export interface TaskToolIntent {
  needsRead: boolean;
  needsWrite: boolean;
  needsBash: boolean;
  needsVerification: boolean;
  requiresLocalTools: boolean;
}

/**
 * Whole-word tool tokens that always trigger local-tool routing on their own.
 * Matched as `\b<token>\b` (case-insensitive).
 */
export const LOCAL_TOOL_NAME_TOKENS = [
  'read_file',
  'write_file',
  'bash',
  'pwd',
  'ls',
  'cat',
  'pnpm',
  'npm',
  'cargo',
  'timeout',
  'sleep',
] as const;

/**
 * English read intent — verb + object pairs. Verb appears first then the
 * object within ~80 non-period chars (lets the user write "read the file" /
 * "read the project workspace" / "quote the bytes between …" naturally).
 */
export const READ_VERB_OBJECT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['read', 'file'],
  ['read', 'path'],
  ['read', 'workspace'],
  ['read', 'content'],
  ['read', 'readme'],
  ['quote', 'bytes'],
  ['quote', 'content'],
  ['quote', 'file'],
  ['view', 'file'],
  ['inspect', 'file'],
];

/**
 * English write intent — verb + object pairs.
 */
export const WRITE_VERB_OBJECT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['write', 'file'],
  ['write', 'path'],
  ['write', 'content'],
  ['create', 'file'],
  ['create', 'scratch note'],
  ['save', 'file'],
  ['append', 'file'],
  ['copy', 'project'],
  ['copy', 'file'],
  ['copy', 'folder'],
  ['organize', 'folder'],
  ['organize', 'directory'],
  ['create', 'pdf'],
  ['create', 'ppt'],
  ['create', 'html'],
  ['export', 'pdf'],
  ['export', 'ppt'],
  ['export', 'html'],
  ['generate', 'pdf'],
  ['generate', 'ppt'],
  ['generate', 'html'],
];

/**
 * English bash intent — verb + object pairs. `run pwd` / `execute command`.
 */
export const BASH_VERB_OBJECT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['run', 'pwd'],
  ['run', 'ls'],
  ['run', 'cat'],
  ['run', 'pnpm'],
  ['run', 'npm'],
  ['run', 'cargo'],
  ['run', 'python'],
  ['run', 'python3'],
  ['run', 'script'],
  ['run', 'sleep'],
  ['execute', 'command'],
  ['execute', 'shell'],
  ['execute', 'bash'],
  ['execute', 'python'],
  ['execute', 'python3'],
  ['execute', 'script'],
];

/**
 * Verification phrasing — when present the task explicitly demands evidence
 * tooling (typecheck / lint / harness / pnpm-test) rather than file/shell.
 */
export const VERIFICATION_TOKENS = [
  'verification evidence',
  'running verification evidence',
  'pnpm-test',
  'pnpm-typecheck',
  'pnpm-lint',
  'harness-contract',
] as const;

/**
 * Default verification tool list returned by `evidenceToolsForIntent` when
 * `intent.needsVerification === true`. Order matches declaration so the
 * spec's stable-order requirement holds.
 */
export const DEFAULT_VERIFICATION_TOOLS = [
  'pnpm-test',
  'pnpm-typecheck',
  'pnpm-lint',
  'harness-contract',
] as const;

/**
 * Chinese read intent — verb prefix matched within ~8 chars of the object,
 * which lets natural connectives like "请帮我读取一下 README" pass.
 */
export const CHINESE_READ_PATTERNS: readonly RegExp[] = [
  /读取/u,
  /读回/u,
  /查看[^。]{0,40}(文件|工作区|readme)/iu,
  /引用[^。]{0,40}(文件|内容)/u,
  /分析[^。]{0,80}(代码库|源码|项目|目录|文件)/u,
  /扫描[^。]{0,80}(工作区|项目|目录)/u,
];

export const CHINESE_WRITE_PATTERNS: readonly RegExp[] = [
  /写入/u,
  /写回/u,
  /创建[^。]{0,8}文件/u,
  /保存[^。]{0,8}文件/u,
  /追加[^。]{0,8}文件/u,
  /保存为/u,
  /输出[^。]{0,80}(PDF|PPT|HTML|infographic)/iu,
  /生成[^。]{0,80}(PDF|PPT|HTML|infographic)/iu,
  /(复制|拷贝)[^。]{0,80}(到|目录|文件夹|项目|源码)/u,
  /整理[^。]{0,80}(文件夹|目录|文件)/u,
  /形成[^。]{0,80}(目录|结构)/u,
];

export const CHINESE_BASH_PATTERNS: readonly RegExp[] = [
  /运行[^。]{0,8}(命令|脚本)/u,
  /执行[^。]{0,8}(命令|脚本)/u,
];

export const CHINESE_VERIFICATION_PATTERNS: readonly RegExp[] = [
  /验证证据/u,
  /运行[^。]{0,20}验证/u,
  /执行[^。]{0,20}验证/u,
];

const CHINESE_NEGATED_LOCAL_TOOL_PATTERNS: readonly RegExp[] = [
  /(?:不需要|无需|不用|不必|不要)[^。；，,.!?！？]{0,12}(?:读取|读回|查看|引用|分析|扫描)[^。；，,.!?！？]{0,80}(?:文件|工作区|readme|内容|代码库|源码|项目|目录)/giu,
  /(?:不需要|无需|不用|不必|不要)[^。；，,.!?！？]{0,12}(?:写入|写回|创建|保存|追加|输出|生成|复制|拷贝|整理|形成)[^。；，,.!?！？]{0,80}(?:文件|文件夹|目录|PDF|PPT|HTML|infographic|结构)/giu,
  /(?:不需要|无需|不用|不必|不要)[^。；，,.!?！？]{0,12}(?:运行|执行)[^。；，,.!?！？]{0,20}(?:命令|脚本|验证)/giu,
  /(?:不需要|无需|不用|不必|不要)[^。；，,.!?！？]{0,20}验证证据/giu,
];

/**
 * Pre-built explicit-tool-token regex `\b(read_file|write_file|...)\b`,
 * case-insensitive.
 */
const LOCAL_TOOL_NAME_RE = new RegExp(`\\b(${LOCAL_TOOL_NAME_TOKENS.join('|')})\\b`, 'iu');

/**
 * Read-intent: any explicit tool subset OR verb+object pair OR Chinese pattern.
 * Tool tokens that imply read (read_file) flow into needsRead independently of
 * tool-name detection so completion evidence still picks `read_file`.
 */
const READ_TOOL_TOKENS_RE = /\b(read_file|cat)\b/iu;
const WRITE_TOOL_TOKENS_RE = /\bwrite_file\b/iu;
const BASH_TOOL_TOKENS_RE = /\b(bash|pwd|ls|pnpm|npm|cargo|timeout|sleep)\b/iu;

const VERIFICATION_TOKEN_RE = new RegExp(
  `(${VERIFICATION_TOKENS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
  'iu',
);

function buildVerbObjectRegex(pairs: ReadonlyArray<readonly [string, string]>): RegExp {
  // \b<verb>\b[^.]{0,80}\b<object>\b for each pair, joined with |.
  // `\b` before "object" tolerates "create file", "create a file", "read the file content".
  const parts = pairs
    .map(([verb, object]) => {
      const objectEsc = object.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const verbEsc = verb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return `\\b${verbEsc}\\b[^.]{0,80}\\b${objectEsc}\\b`;
    })
    .join('|');
  return new RegExp(parts, 'iu');
}

const READ_VERB_OBJECT_RE = buildVerbObjectRegex(READ_VERB_OBJECT_PAIRS);
const WRITE_VERB_OBJECT_RE = buildVerbObjectRegex(WRITE_VERB_OBJECT_PAIRS);
const BASH_VERB_OBJECT_RE = buildVerbObjectRegex(BASH_VERB_OBJECT_PAIRS);
const EXPLICIT_ARTIFACT_FILE_WRITE_RE =
  /\b(create|generate|save|write|export)\b[^。！？\n]{0,120}\.(pdf|pptx?|html|json)\b/iu;

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  for (const pattern of patterns) {
    if (pattern.test(text)) return true;
  }
  return false;
}

const EMPTY_INTENT: TaskToolIntent = Object.freeze({
  needsRead: false,
  needsWrite: false,
  needsBash: false,
  needsVerification: false,
  requiresLocalTools: false,
});

/**
 * Detect the structured local-tool intent of a free-text task description.
 *
 * Pure: same input always returns deeply-equal output, no I/O, no shared state.
 *
 * @param text the task / user message text
 * @returns a `TaskToolIntent` record. For empty / null / whitespace-only input,
 *   returns the canonical no-intent record.
 */
export function detectTaskToolIntent(text: string | null | undefined): TaskToolIntent {
  if (!text || !text.trim()) {
    return { ...EMPTY_INTENT };
  }

  const effectiveText = stripNegatedChineseLocalToolPhrases(text);

  // Tool-name tokens trigger their own bucket plus requiresLocalTools.
  const hasToolToken = LOCAL_TOOL_NAME_RE.test(effectiveText);

  const needsRead =
    READ_TOOL_TOKENS_RE.test(effectiveText) ||
    READ_VERB_OBJECT_RE.test(effectiveText) ||
    matchesAny(effectiveText, CHINESE_READ_PATTERNS);

  const needsWrite =
    WRITE_TOOL_TOKENS_RE.test(effectiveText) ||
    WRITE_VERB_OBJECT_RE.test(effectiveText) ||
    EXPLICIT_ARTIFACT_FILE_WRITE_RE.test(effectiveText) ||
    matchesAny(effectiveText, CHINESE_WRITE_PATTERNS);

  const needsBash =
    BASH_TOOL_TOKENS_RE.test(effectiveText) ||
    BASH_VERB_OBJECT_RE.test(effectiveText) ||
    matchesAny(effectiveText, CHINESE_BASH_PATTERNS);

  const needsVerification =
    VERIFICATION_TOKEN_RE.test(effectiveText) ||
    matchesAny(effectiveText, CHINESE_VERIFICATION_PATTERNS);

  // requiresLocalTools is true iff any bucket fired (or a tool-name token did
  // — those always indicate local-tool intent even if the bucket categorisation
  // is ambiguous, e.g. a bare "bash" mention).
  const requiresLocalTools =
    needsRead || needsWrite || needsBash || needsVerification || hasToolToken;

  return {
    needsRead,
    needsWrite,
    needsBash,
    needsVerification,
    requiresLocalTools,
  };
}

function stripNegatedChineseLocalToolPhrases(text: string): string {
  let stripped = text;
  for (const pattern of CHINESE_NEGATED_LOCAL_TOOL_PATTERNS) {
    stripped = stripped.replace(pattern, ' ');
  }
  return stripped;
}

/**
 * Union two `TaskToolIntent` records — every bucket is OR'd. Used by the
 * completion verifier to combine per-turn intent (computed at boss/preflight
 * entry from the user message) with per-task intent (computed from the
 * specific PM-planner step description) so a verifier scoped to one task
 * never accepts text-only completion when the per-task description requires
 * file/shell/verification evidence even if the per-turn message did not.
 */
export function unionTaskToolIntents(a: TaskToolIntent, b: TaskToolIntent): TaskToolIntent {
  return {
    needsRead: a.needsRead || b.needsRead,
    needsWrite: a.needsWrite || b.needsWrite,
    needsBash: a.needsBash || b.needsBash,
    needsVerification: a.needsVerification || b.needsVerification,
    requiresLocalTools: a.requiresLocalTools || b.requiresLocalTools,
  };
}

/**
 * Derive the completion-evidence tool list from a `TaskToolIntent`.
 *
 * Returns a deduplicated, stable-ordered list. `bash` is accepted as evidence
 * for read/write intents because real workspace tasks often use shell commands
 * (`find`, `ls`, `rsync`, `mkdir`, `cat`, converters) instead of the narrower
 * file tools.
 *
 * An intent with no buckets set returns `[]` — the verifier treats that as
 * "no evidence required" (plain text deliverables).
 */
export function evidenceToolsForIntent(intent: TaskToolIntent): readonly string[] {
  const tools: string[] = [];
  if (intent.needsRead) tools.push('read_file', 'bash');
  if (intent.needsWrite) tools.push('write_file', 'bash');
  if (intent.needsBash) tools.push('bash');
  if (intent.needsVerification) {
    for (const tool of DEFAULT_VERIFICATION_TOOLS) {
      tools.push(tool);
    }
  }
  return [...new Set(tools)];
}

/**
 * An employee is assignable to local-tool work iff it is enabled and runs in
 * the gateway lane (`is_external !== 1`). External A2A employees cannot reach
 * Offisim's `read_file` / `write_file` / `bash` tools.
 */
export function isLocalToolAssignableEmployee(employee: EmployeeRow): boolean {
  return employee.enabled === 1 && employee.is_external !== 1;
}
