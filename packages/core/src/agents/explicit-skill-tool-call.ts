import type { LlmResponse, ToolCallResult, ToolDef } from '../llm/gateway.js';
import { generateId } from '../utils/generate-id.js';

const CREATE_TOOL_NAME = 'create_skill_from_scratch';
const CREATE_TOOL_NORMALIZED_NAME = 'createskillfromscratch';

interface InlineFrontmatterField {
  readonly key: string;
  readonly value: string;
}

const INLINE_FIELD_KEY_PATTERN =
  /(?:^|\s)(name|description|version|allowedTools|license|extraField|unknownField|x-[A-Za-z][\w.-]*|offisim\.[A-Za-z][\w.-]*)(?![\w.-])\s*:?\s*/giu;

function cleanInlineValue(
  value: string | undefined,
  options?: { stripTrailingPeriod?: boolean },
): string | null {
  let cleaned = value?.trim().replace(/,+$/u, '').trim();
  if (options?.stripTrailingPeriod) {
    cleaned = cleaned?.replace(/\.$/u, '').trim();
  }
  return cleaned ? cleaned : null;
}

function extractTargetEmployeeId(input: string): string | null {
  const match = input.match(/targetEmployeeId\s*(?:[:=]|is)?\s*([0-9a-f-]{36})/iu);
  return match?.[1] ?? null;
}

function extractFencedSkillBody(input: string): string | null {
  const match = input.match(/```(?:markdown|md)?\s*\n([\s\S]*?)```/iu);
  return match?.[1]?.trim() || null;
}

function extractRawFrontmatterSkillBody(input: string): string | null {
  const match = input.match(/(^|\n)(---\n[\s\S]*?\n---\n[\s\S]*)$/u);
  return match?.[2]?.trim() || null;
}

function parseInlineFrontmatterFields(frontmatter: string): readonly InlineFrontmatterField[] {
  const fields: InlineFrontmatterField[] = [];
  const fieldPattern =
    /(?:^|,\s*)([A-Za-z][\w.-]*)\s*:?\s*([\s\S]*?)(?=,\s*[A-Za-z][\w.-]*\s*:?\s|$)/gu;
  for (const match of frontmatter.matchAll(fieldPattern)) {
    const key = match[1]?.trim();
    const value = cleanInlineValue(match[2], {
      stripTrailingPeriod: key?.toLowerCase() === 'version',
    });
    if (key && value) fields.push({ key, value });
  }
  return fields.length > 1 ? fields : parseUnpunctuatedInlineFrontmatterFields(frontmatter, fields);
}

function parseUnpunctuatedInlineFrontmatterFields(
  frontmatter: string,
  fallback: readonly InlineFrontmatterField[],
): readonly InlineFrontmatterField[] {
  const matches = [...frontmatter.matchAll(INLINE_FIELD_KEY_PATTERN)];
  if (matches.length <= 1) return fallback;

  const fields: InlineFrontmatterField[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    if (!match) continue;
    const key = match[1]?.trim();
    const valueStart = (match.index ?? 0) + match[0].length;
    const valueEnd = matches[index + 1]?.index ?? frontmatter.length;
    const value = cleanInlineValue(frontmatter.slice(valueStart, valueEnd), {
      stripTrailingPeriod: key?.toLowerCase() === 'version',
    });
    if (key && value) fields.push({ key, value });
  }

  return fields.length > 0 ? fields : fallback;
}

function buildSkillBodyFromInlineFields(input: string): string | null {
  const frontmatter = input.match(/Frontmatter fields:?\s*([\s\S]*?)(?:Markdown body:?|$)/iu)?.[1];
  if (!frontmatter) return null;

  const fields = parseInlineFrontmatterFields(frontmatter);
  const name = fields.find((field) => field.key.toLowerCase() === 'name')?.value;
  const description = fields.find((field) => field.key.toLowerCase() === 'description')?.value;
  if (!name) return null;

  const body = input.match(/Markdown body:?\s*([\s\S]*)$/iu)?.[1]?.trim() ?? '';
  const bodyMatch = body.match(/heading\s+([\s\S]*?)\s+and (?:the )?sentence\s+([\s\S]*)$/iu);
  const heading = cleanInlineValue(bodyMatch?.[1]) ?? name;
  const sentence = cleanInlineValue(bodyMatch?.[2]) ?? description ?? name;

  return [
    '---',
    ...fields.map((field) => `${field.key}: ${field.value}`),
    '---',
    '',
    `# ${heading}`,
    '',
    sentence,
  ].join('\n');
}

function parseCreateSkillArgs(input: string): Record<string, unknown> | null {
  const skillBody =
    extractFencedSkillBody(input) ??
    extractRawFrontmatterSkillBody(input) ??
    buildSkillBodyFromInlineFields(input);
  if (!skillBody) return null;

  const targetEmployeeId = extractTargetEmployeeId(input);
  return {
    skillBody,
    ...(targetEmployeeId ? { targetEmployeeId } : {}),
  };
}

function mentionsCreateTool(input: string): boolean {
  return input
    .toLowerCase()
    .replace(/[\s_-]+/gu, '')
    .includes(CREATE_TOOL_NORMALIZED_NAME);
}

export function buildExplicitSkillToolResponse(
  taskDescription: string,
  allTools: readonly ToolDef[],
): LlmResponse | null {
  if (!mentionsCreateTool(taskDescription)) return null;
  if (!allTools.some((tool) => tool.name === CREATE_TOOL_NAME)) return null;

  const args = parseCreateSkillArgs(taskDescription);
  if (!args) return null;

  const toolCall: ToolCallResult = {
    id: generateId('tool'),
    name: CREATE_TOOL_NAME,
    arguments: args,
  };

  return {
    content: '',
    toolCalls: [toolCall],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}
