import { z } from 'zod';
import type { ToolDef } from '../llm/gateway.js';

export interface ToolValidationResult {
  readonly success: boolean;
  readonly data?: Record<string, unknown>;
  readonly error?: string;
}

export function validateToolInput(
  tool: ToolDef,
  input: Record<string, unknown>,
): ToolValidationResult {
  const schema = zodFromJsonSchema(tool.parameters);
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; '),
    };
  }
  return { success: true, data: parsed.data as Record<string, unknown> };
}

function zodFromJsonSchema(schema: Record<string, unknown>): z.ZodTypeAny {
  if (schema.type === 'object') {
    const properties =
      schema.properties && typeof schema.properties === 'object'
        ? (schema.properties as Record<string, Record<string, unknown>>)
        : {};
    const required = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter((v): v is string => typeof v === 'string')
        : [],
    );
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, value] of Object.entries(properties)) {
      const field = zodFromJsonSchema(value);
      shape[key] = required.has(key) ? field : field.optional();
    }
    return z.object(shape).passthrough();
  }
  if (schema.type === 'array') {
    const itemSchema =
      schema.items && typeof schema.items === 'object'
        ? zodFromJsonSchema(schema.items as Record<string, unknown>)
        : z.unknown();
    return z.array(itemSchema);
  }
  if (Array.isArray(schema.enum)) {
    const values = schema.enum.filter((v): v is string => typeof v === 'string');
    return values.length > 0 ? z.enum(values as [string, ...string[]]) : z.unknown();
  }
  switch (schema.type) {
    case 'string':
      return z.string();
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    default:
      return z.unknown();
  }
}
