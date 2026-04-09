import type { RoleSlug } from './roles.js';

export interface SopStep {
  readonly step_id: string;
  readonly label: string;
  readonly role_slug: RoleSlug;
  readonly instruction: string;
  readonly dependencies: readonly string[];
  readonly output_key: string;
  readonly position?: { readonly x: number; readonly y: number };
}

export interface SopDefinition {
  readonly sop_id: string;
  readonly name: string;
  readonly description: string;
  readonly steps: readonly SopStep[];
  readonly input_schema?: Record<string, string>;
  readonly output_schema?: Record<string, string>;
  readonly created_at: string;
}
