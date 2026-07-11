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
  'company_template',
  'office_layout',
  'bundle',
  'prefab',
] as const;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_REGEX = /^[a-f0-9]{64}$/i;

// ── Review ──

export const ReviewCreateSchema = z.object({
  listing_id: z.string().min(1, 'listing_id is required'),
  rating: z.number().int('rating must be an integer').min(1).max(5),
  title: z.string().optional(),
  body: z.string().optional(),
});

// ── Publish: Draft ──

export const DraftCreateSchema = z.object({
  kind: z.enum(VALID_KINDS, {
    error: (issue) => `Invalid draft kind: ${String(issue.input)}`,
  }),
  title: z.string().min(1, 'title is required'),
  summary: z.string().optional(),
  listing_id: z.string().regex(UUID_REGEX, 'listing_id must be a valid UUID').optional(),
});

// ── Publish: Manifest upload ──

export const ManifestUploadSchema = z.object({
  manifest_json: z.record(z.string(), z.unknown()),
  artifact: z
    .object({
      external_url: z.string().optional(),
      sha256: z.string().regex(SHA256_REGEX, 'artifact.sha256 must be 64 hex').optional(),
      size_bytes: z.number().int().positive('artifact.size_bytes must be positive').optional(),
      storage_backend: z
        .enum(['registry_object', 'external_url', 'github_release', 'npm'])
        .optional(),
      bytes_base64: z.string().optional(),
    })
    .optional(),
});

// ── Publish: Submit ──

export const SubmitDraftSchema = z.object({
  draft_id: z.string().min(1, 'draft_id is required'),
  submit_message: z.string().optional(),
});

// ── Install: Receipt ──

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
    error: 'install_source must be registry, url, or file',
  }),
});

// ── Report ──

const VALID_REPORT_REASONS = [
  'spam',
  'malicious_code',
  'copyright',
  'misleading',
  'other',
] as const;

export const ReportCreateSchema = z.object({
  reason: z.enum(VALID_REPORT_REASONS, {
    error: 'reason must be one of: spam, malicious_code, copyright, misleading, other',
  }),
  details: z.string().max(1000).optional(),
});

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

// ── Listing Status Patch ──

export const ListingStatusPatchSchema = z.object({
  status: z.enum(['listed', 'hidden', 'retired'], {
    error: 'status must be one of: listed, hidden, retired',
  }),
  reason: z.string().max(500).optional(),
});

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
