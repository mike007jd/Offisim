import {
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// ── 001: Auth and Creators ──

export const users = pgTable('users', {
  user_id: uuid('user_id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  display_name: text('display_name').notNull(),
  avatar_url: text('avatar_url'),
  auth_provider: text('auth_provider').notNull(),
  auth_subject: text('auth_subject').notNull(),
  /** Links to Better Auth "user".id for session-based auth */
  ba_user_id: text('ba_user_id').unique(),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const creators = pgTable('creators', {
  creator_id: uuid('creator_id').primaryKey().defaultRandom(),
  user_id: uuid('user_id')
    .notNull()
    .references(() => users.user_id)
    .unique(),
  handle: text('handle').notNull().unique(),
  display_name: text('display_name').notNull(),
  bio: text('bio'),
  website_url: text('website_url'),
  verification_state: text('verification_state').notNull().default('unverified'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

// ── 002: Registry Core ──

export const listings = pgTable('listings', {
  listing_id: uuid('listing_id').primaryKey().defaultRandom(),
  creator_id: uuid('creator_id')
    .notNull()
    .references(() => creators.creator_id),
  slug: text('slug').notNull().unique(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  summary: text('summary'),
  description: text('description'),
  status: text('status').notNull().default('listed'),
  rating_avg: real('rating_avg').default(0),
  rating_count: integer('rating_count').default(0),
  install_count: integer('install_count').default(0),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const packageVersions = pgTable('package_versions', {
  package_version_id: uuid('package_version_id').primaryKey().defaultRandom(),
  listing_id: uuid('listing_id')
    .notNull()
    .references(() => listings.listing_id),
  package_id: text('package_id').notNull(),
  version: text('version').notNull(),
  manifest_json: jsonb('manifest_json').notNull(),
  runtime_range: text('runtime_range').notNull(),
  schema_version: text('schema_version').notNull(),
  environments: jsonb('environments').notNull(),
  risk_class: text('risk_class').notNull(),
  artifact_url: text('artifact_url'),
  artifact_sha256: text('artifact_sha256'),
  artifact_size_bytes: integer('artifact_size_bytes'),
  changelog: text('changelog'),
  status: text('status').notNull().default('active'),
  published_at: timestamp('published_at').notNull().defaultNow(),
});

export const listingTags = pgTable('listing_tags', {
  listing_id: uuid('listing_id')
    .notNull()
    .references(() => listings.listing_id),
  tag: text('tag').notNull(),
});

export const listingPreviews = pgTable('listing_previews', {
  preview_id: uuid('preview_id').primaryKey().defaultRandom(),
  listing_id: uuid('listing_id')
    .notNull()
    .references(() => listings.listing_id),
  kind: text('kind').notNull(),
  url: text('url').notNull(),
  alt_text: text('alt_text'),
  sort_order: integer('sort_order').notNull().default(0),
});

// ── 003: Publish and Lineage ──

export const publishDrafts = pgTable('publish_drafts', {
  draft_id: uuid('draft_id').primaryKey().defaultRandom(),
  creator_id: uuid('creator_id')
    .notNull()
    .references(() => creators.creator_id),
  listing_id: uuid('listing_id').references(() => listings.listing_id),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  summary: text('summary'),
  manifest_json: jsonb('manifest_json'),
  artifact_id: text('artifact_id'),
  validation_state: text('validation_state').notNull().default('unknown'),
  validation_report: jsonb('validation_report'),
  status: text('status').notNull().default('draft'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const packageLineage = pgTable('package_lineage', {
  lineage_id: uuid('lineage_id').primaryKey().defaultRandom(),
  package_version_id: uuid('package_version_id')
    .notNull()
    .references(() => packageVersions.package_version_id),
  origin_listing_id: uuid('origin_listing_id').references(() => listings.listing_id),
  origin_package_id: text('origin_package_id'),
  forked_from_version: text('forked_from_version'),
});

export const moderationJobs = pgTable('moderation_jobs', {
  job_id: uuid('job_id').primaryKey().defaultRandom(),
  target_type: text('target_type').notNull(),
  target_id: uuid('target_id').notNull(),
  job_kind: text('job_kind').notNull(),
  status: text('status').notNull().default('pending'),
  result: jsonb('result'),
  assigned_to: uuid('assigned_to').references(() => users.user_id),
  created_at: timestamp('created_at').notNull().defaultNow(),
  completed_at: timestamp('completed_at'),
});

// ── 004: Reviews, Library, and Moderation ──

export const reviews = pgTable('reviews', {
  review_id: uuid('review_id').primaryKey().defaultRandom(),
  listing_id: uuid('listing_id')
    .notNull()
    .references(() => listings.listing_id),
  user_id: uuid('user_id')
    .notNull()
    .references(() => users.user_id),
  rating: integer('rating').notNull(),
  title: text('title'),
  body: text('body'),
  moderation_state: text('moderation_state').notNull().default('visible'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const userLibrary = pgTable(
  'user_library',
  {
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.user_id),
    listing_id: uuid('listing_id')
      .notNull()
      .references(() => listings.listing_id),
    package_version_id: uuid('package_version_id').references(
      () => packageVersions.package_version_id,
    ),
    saved_at: timestamp('saved_at').notNull().defaultNow(),
    install_receipt_id: text('install_receipt_id'),
  },
  (table) => [unique('user_library_user_listing_unique').on(table.user_id, table.listing_id)],
);

export const installReceipts = pgTable('install_receipts', {
  install_receipt_id: text('install_receipt_id').primaryKey(),
  user_id: uuid('user_id').references(() => users.user_id, { onDelete: 'set null' }),
  listing_id: uuid('listing_id').references(() => listings.listing_id, { onDelete: 'set null' }),
  package_version_id: uuid('package_version_id').references(
    () => packageVersions.package_version_id,
    { onDelete: 'set null' },
  ),
  install_source: text('install_source').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

// ── 005: Better Auth tables ──
// Better Auth manages these tables automatically via its adapter.
// We define them here for Drizzle type-safety and query access.

export const baUser = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const baSession = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => baUser.id, { onDelete: 'cascade' }),
});

export const baAccount = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => baUser.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const baVerification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});

// ── 006: API Tokens (for CLI / programmatic access) ──

export const apiTokens = pgTable('api_tokens', {
  token_id: uuid('token_id').primaryKey().defaultRandom(),
  user_id: text('user_id')
    .notNull()
    .references(() => baUser.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** SHA-256 hash of the token. The raw token is shown once at creation. */
  token_hash: text('token_hash').notNull().unique(),
  /** First 8 chars of the raw token for display (e.g. "aics_abc1...") */
  token_prefix: text('token_prefix').notNull(),
  scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
  last_used_at: timestamp('last_used_at'),
  expires_at: timestamp('expires_at'),
  created_at: timestamp('created_at').notNull().defaultNow(),
});

export const moderationFlags = pgTable('moderation_flags', {
  flag_id: uuid('flag_id').primaryKey().defaultRandom(),
  target_type: text('target_type').notNull(),
  target_id: uuid('target_id').notNull(),
  reporter_user_id: uuid('reporter_user_id')
    .notNull()
    .references(() => users.user_id),
  reason: text('reason').notNull(),
  details: text('details'),
  status: text('status').notNull().default('open'),
  created_at: timestamp('created_at').notNull().defaultNow(),
});
