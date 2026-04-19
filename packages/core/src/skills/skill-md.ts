import { SkillMdParseError } from '@offisim/shared-types';
import yaml from 'js-yaml';
import { VaultParseError, parseDocument } from '../vault/codec.js';

const ALLOWED_FRONTMATTER_KEYS = new Set([
  'name',
  'description',
  'allowedTools',
  'license',
  'version',
]);

export interface ParsedSkillMd {
  name: string;
  description: string;
  allowedTools: string[] | undefined;
  license: string | undefined;
  version: string | undefined;
  unknownFields: Record<string, unknown>;
  body: string;
}

export interface SerializeInput {
  name: string;
  description: string;
  allowedTools?: string[] | undefined;
  license?: string | undefined;
  version?: string | undefined;
  body: string;
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new SkillMdParseError(
      'invalid-field-type',
      `SKILL.md field "${field}" must be a string`,
      field,
    );
  }
  return value;
}

function assertStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new SkillMdParseError(
      'invalid-field-type',
      `SKILL.md field "${field}" must be an array of strings`,
      field,
    );
  }
  return value.map((item, i) => {
    if (typeof item !== 'string') {
      throw new SkillMdParseError(
        'invalid-field-type',
        `SKILL.md field "${field}[${i}]" must be a string`,
        field,
      );
    }
    return item;
  });
}

export function parseSkillMd(raw: string): ParsedSkillMd {
  let frontmatter: Record<string, unknown>;
  let body: string;
  try {
    const parsed = parseDocument(raw);
    frontmatter = parsed.frontmatter as Record<string, unknown>;
    body = parsed.body;
  } catch (err) {
    if (err instanceof VaultParseError) {
      const kind = err.message.startsWith('Missing')
        ? 'missing-frontmatter'
        : 'invalid-frontmatter-yaml';
      throw new SkillMdParseError(kind, err.message);
    }
    throw err;
  }

  for (const key of Object.keys(frontmatter)) {
    if (key.startsWith('offisim.')) {
      throw new SkillMdParseError(
        'private-namespace-forbidden',
        `SKILL.md frontmatter key "${key}" uses reserved "offisim." namespace`,
        key,
      );
    }
  }

  if (!('name' in frontmatter)) {
    throw new SkillMdParseError(
      'missing-required-field',
      'SKILL.md frontmatter missing `name`',
      'name',
    );
  }
  if (!('description' in frontmatter)) {
    throw new SkillMdParseError(
      'missing-required-field',
      'SKILL.md frontmatter missing `description`',
      'description',
    );
  }

  const name = assertString(frontmatter.name, 'name');
  const description = assertString(frontmatter.description, 'description');
  const allowedTools =
    frontmatter.allowedTools !== undefined
      ? assertStringArray(frontmatter.allowedTools, 'allowedTools')
      : undefined;
  const license =
    frontmatter.license !== undefined ? assertString(frontmatter.license, 'license') : undefined;
  const version =
    frontmatter.version !== undefined ? assertString(frontmatter.version, 'version') : undefined;

  const unknownFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!ALLOWED_FRONTMATTER_KEYS.has(key)) {
      unknownFields[key] = value;
    }
  }

  return { name, description, allowedTools, license, version, unknownFields, body };
}

/**
 * SKILL.md uses a deterministic key order (name → description → optional fields) to match the
 * Anthropic open-standard convention; we can't reuse `serializeDocument` which sort-keys alphabetically.
 */
export function serializeSkillMd(input: SerializeInput): string {
  if (!input.name) throw new Error('serializeSkillMd: name is required');
  if (!input.description) throw new Error('serializeSkillMd: description is required');

  const ordered: Record<string, unknown> = {
    name: input.name,
    description: input.description,
  };
  if (input.allowedTools !== undefined) ordered.allowedTools = input.allowedTools;
  if (input.license !== undefined) ordered.license = input.license;
  if (input.version !== undefined) ordered.version = input.version;

  const yamlText = yaml.dump(ordered, { lineWidth: 120, schema: yaml.CORE_SCHEMA });
  const trimmedYaml = yamlText.endsWith('\n') ? yamlText.slice(0, -1) : yamlText;
  return `---\n${trimmedYaml}\n---\n\n${input.body}`;
}
