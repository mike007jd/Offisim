import type { CommunicationFrequency, DecisionStyle, RiskPreference } from '@offisim/shared-types';
import { z } from 'zod';

export const VAULT_SCHEMA_VERSION = 1;

const isoDate = z.string();

export const employeeFrontmatterSchema = z.object({
  schema: z.literal(VAULT_SCHEMA_VERSION),
  employee_id: z.string(),
  company_id: z.string(),
  name: z.string(),
  role_slug: z.string(),
  workstation_id: z.string().nullable().optional(),
  dismissed: z.boolean(),
  created_at: isoDate,
  updated_at: isoDate,
});

export type EmployeeFrontmatter = z.infer<typeof employeeFrontmatterSchema>;

const decisionStyleEnum = z.enum([
  'analytical',
  'intuitive',
  'collaborative',
  'directive',
]) satisfies z.ZodType<DecisionStyle>;

const riskPreferenceEnum = z.enum([
  'conservative',
  'balanced',
  'aggressive',
]) satisfies z.ZodType<RiskPreference>;

const communicationFrequencyEnum = z.enum([
  'low',
  'medium',
  'high',
]) satisfies z.ZodType<CommunicationFrequency>;

export const soulFrontmatterSchema = z.object({
  schema: z.literal(VAULT_SCHEMA_VERSION),
  employee_id: z.string(),
  persona: z
    .object({
      decisionStyle: decisionStyleEnum.optional(),
      riskPreference: riskPreferenceEnum.optional(),
      communicationFrequency: communicationFrequencyEnum.optional(),
      expertise: z.string().optional(),
      tone: z.string().optional(),
    })
    .catchall(z.unknown()),
  updated_at: isoDate,
});

export type SoulFrontmatter = z.infer<typeof soulFrontmatterSchema>;

export const memoryCategoryEnum = z.enum(['experience', 'decision', 'knowledge', 'preference']);
export type MemoryCategory = z.infer<typeof memoryCategoryEnum>;

export const memoryFrontmatterSchema = z.object({
  schema: z.literal(VAULT_SCHEMA_VERSION),
  employee_id: z.string(),
  company_id: z.string(),
  count: z.number().int().nonnegative(),
  updated_at: isoDate,
});

export type MemoryFrontmatter = z.infer<typeof memoryFrontmatterSchema>;

export const relationshipsFrontmatterSchema = z.object({
  schema: z.literal(VAULT_SCHEMA_VERSION),
  employee_id: z.string(),
  company_id: z.string(),
  relationships: z.array(
    z.object({
      peer_employee_id: z.string(),
      peer_name: z.string().optional(),
      collaborations: z.number().int().nonnegative(),
      trust: z.number().min(0).max(1).optional(),
      last_interaction: isoDate.optional(),
      dismissed_peer: z.boolean().optional(),
    }),
  ),
  updated_at: isoDate,
});

export type RelationshipsFrontmatter = z.infer<typeof relationshipsFrontmatterSchema>;

export type VaultFile = 'employee' | 'soul' | 'memory' | 'relationships';

export const VAULT_FILENAMES: Record<VaultFile, string> = {
  employee: 'employee.md',
  soul: 'soul.md',
  memory: 'memory.md',
  relationships: 'relationships.md',
};
