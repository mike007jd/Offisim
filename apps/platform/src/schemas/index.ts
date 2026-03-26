/**
 * Zod request schemas for all Platform API POST/PUT endpoints.
 *
 * Each schema validates the request body shape and constraints.
 * Routes call `schema.parse(body)` and let ZodError propagate
 * to the global error handler for consistent 400 responses.
 */

import { z } from 'zod';

// ── Shared enums ──

export const VALID_KINDS = [
  'employee',
  'skill',
  'sop',
  'company_template',
  'office_layout',
  'bundle',
  'prefab',
] as const;

export const VALID_RISK_CLASSES = ['data_asset', 'logic_asset', 'privileged_asset'] as const;

export const VALID_ENVIRONMENTS = ['desktop', 'docker', 'web_limited'] as const;

// ── Review ──

export const ReviewCreateSchema = z.object({
  listing_id: z.string().min(1, 'listing_id is required'),
  rating: z.number().int('rating must be an integer').min(1).max(5),
  title: z.string().optional(),
  body: z.string().optional(),
});
export type ReviewCreateBody = z.infer<typeof ReviewCreateSchema>;

// ── Publish: Draft ──

export const DraftCreateSchema = z.object({
  kind: z.string().min(1, 'kind is required'),
  title: z.string().min(1, 'title is required'),
  summary: z.string().optional(),
  listing_id: z.string().optional(),
});
export type DraftCreateBody = z.infer<typeof DraftCreateSchema>;

// ── Publish: Manifest upload ──

export const ManifestUploadSchema = z.object({
  manifest_json: z.record(z.unknown()),
  artifact: z
    .object({
      external_url: z.string().optional(),
      sha256: z.string().optional(),
      size_bytes: z.number().optional(),
    })
    .optional(),
});
export type ManifestUploadBody = z.infer<typeof ManifestUploadSchema>;

// ── Publish: Submit ──

export const SubmitDraftSchema = z.object({
  draft_id: z.string().min(1, 'draft_id is required'),
  submit_message: z.string().optional(),
});
export type SubmitDraftBody = z.infer<typeof SubmitDraftSchema>;

// ── Install: Receipt ──

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const InstallReceiptSchema = z.object({
  listing_id: z
    .string()
    .min(1, 'listing_id is required')
    .regex(UUID_REGEX, 'listing_id must be a valid UUID'),
  package_version_id: z
    .string()
    .min(1, 'package_version_id is required')
    .regex(UUID_REGEX, 'package_version_id must be a valid UUID'),
  install_source: z.enum(['registry', 'url', 'file'], {
    errorMap: () => ({ message: 'install_source must be registry, url, or file' }),
  }),
});
export type InstallReceiptBody = z.infer<typeof InstallReceiptSchema>;

// ── Report ──

export const VALID_REPORT_REASONS = [
  'spam',
  'malicious_code',
  'copyright',
  'misleading',
  'other',
] as const;

export const ReportCreateSchema = z.object({
  reason: z.enum(VALID_REPORT_REASONS, {
    errorMap: () => ({
      message: 'reason must be one of: spam, malicious_code, copyright, misleading, other',
    }),
  }),
  details: z.string().max(1000).optional(),
});
export type ReportCreateBody = z.infer<typeof ReportCreateSchema>;

// ── Register Creator ──

const HANDLE_REGEX = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export const RegisterCreatorSchema = z.object({
  handle: z
    .string()
    .min(3, 'handle must be at least 3 characters')
    .max(30, 'handle must be at most 30 characters')
    .regex(HANDLE_REGEX, 'handle must be lowercase alphanumeric, may contain . _ - as separators'),
  display_name: z
    .string()
    .min(1, 'display_name is required')
    .max(100, 'display_name must be at most 100 characters'),
  bio: z.string().max(500).optional(),
});
export type RegisterCreatorBody = z.infer<typeof RegisterCreatorSchema>;

// ── Listing Status Patch ──

export const ListingStatusPatchSchema = z.object({
  status: z.enum(['listed', 'hidden', 'retired'], {
    errorMap: () => ({ message: 'status must be one of: listed, hidden, retired' }),
  }),
  reason: z.string().max(500).optional(),
});
export type ListingStatusPatchBody = z.infer<typeof ListingStatusPatchSchema>;

// ── Search Params ──

export const SearchParamsSchema = z.object({
  q: z.string().optional(),
  kind: z.string().optional(),
  risk_class: z.string().optional(),
  tag: z.string().optional(),
  sort: z.string().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});
export type SearchParams = z.infer<typeof SearchParamsSchema>;

// ── Manifest validation schema (replaces services/validation.ts if-checks) ──

const packageSchema = z.object({
  id: z.string().min(1, 'Missing package.id'),
  kind: z.enum(VALID_KINDS, {
    errorMap: (_issue, ctx) => ({
      message: `Invalid package.kind: ${ctx.data}`,
    }),
  }),
  version: z.string().min(1, 'Missing package.version'),
  title: z.string().min(1, 'Missing package.title'),
  license: z.string().min(1, 'Missing package.license'),
  summary: z.string().optional(),
});

const compatibilitySchema = z.object({
  runtime_range: z.string().min(1, 'Missing compatibility.runtime_range'),
  schema_version: z.string().min(1, 'Missing compatibility.schema_version'),
  supported_environments: z
    .array(
      z.enum(VALID_ENVIRONMENTS, {
        errorMap: (_issue, ctx) => ({
          message: `Invalid environment: ${ctx.data}`,
        }),
      }),
    )
    .min(1, 'Missing compatibility.supported_environments'),
});

const permissionsSchema = z.object({
  risk_class: z.enum(VALID_RISK_CLASSES, {
    errorMap: (_issue, ctx) => ({
      message: `Invalid permissions.risk_class: ${ctx.data}`,
    }),
  }),
  declares_secrets: z.boolean({
    required_error: 'permissions.declares_secrets must be boolean',
    invalid_type_error: 'permissions.declares_secrets must be boolean',
  }),
  filesystem_scope: z.string().optional(),
  network_scope: z.string().optional(),
});

const integritySchema = z.object({
  package_sha256: z
    .string({ required_error: 'Missing integrity.package_sha256' })
    .min(1, 'Missing integrity.package_sha256'),
  file_hashes: z.record(z.string()).optional(),
});

export const ManifestSchema = z.object({
  spec_version: z.string().min(1, 'Missing spec_version'),
  package: packageSchema,
  compatibility: compatibilitySchema,
  requirements: z.record(z.unknown()),
  permissions: permissionsSchema,
  assets: z.array(z.record(z.unknown())).min(1, 'Missing or invalid assets array'),
  integrity: integritySchema,
  previews: z.record(z.unknown()).optional(),
  lineage: z.record(z.unknown()).optional(),
});
