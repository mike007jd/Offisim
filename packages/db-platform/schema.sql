CREATE TABLE "api_tokens" (
	"token_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);

CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);

CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);

CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);

CREATE TABLE "creators" (
	"creator_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text,
	"website_url" text,
	"verification_state" text DEFAULT 'unverified' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "creators_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "creators_handle_unique" UNIQUE("handle")
);

CREATE TABLE "install_receipts" (
	"install_receipt_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"listing_id" uuid,
	"package_version_id" uuid,
	"install_source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "listing_previews" (
	"preview_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"alt_text" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "listing_tags" (
	"listing_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "listing_tags_listing_tag_unique" UNIQUE("listing_id","tag")
);

CREATE TABLE "listings" (
	"listing_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"description" text,
	"status" text DEFAULT 'listed' NOT NULL,
	"rating_avg" real DEFAULT 0,
	"rating_count" integer DEFAULT 0,
	"install_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "listings_slug_unique" UNIQUE("slug")
);

CREATE TABLE "moderation_flags" (
	"flag_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "moderation_jobs" (
	"job_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"job_kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"assigned_to" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);

CREATE TABLE "package_lineage" (
	"lineage_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"package_version_id" uuid NOT NULL,
	"origin_listing_id" uuid,
	"origin_package_id" text,
	"forked_from_version" text
);

CREATE TABLE "package_versions" (
	"package_version_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"package_id" text NOT NULL,
	"version" text NOT NULL,
	"manifest_json" jsonb NOT NULL,
	"runtime_range" text NOT NULL,
	"schema_version" text NOT NULL,
	"environments" jsonb NOT NULL,
	"risk_class" text NOT NULL,
	"artifact_url" text,
	"artifact_sha256" text,
	"artifact_size_bytes" integer,
	"changelog" text,
	"status" text DEFAULT 'active' NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "package_versions_listing_package_version_unique" UNIQUE("listing_id","package_id","version")
);

CREATE TABLE "publish_drafts" (
	"draft_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"listing_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"manifest_json" jsonb,
	"artifact_id" text,
	"validation_state" text DEFAULT 'unknown' NOT NULL,
	"validation_report" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "reviews" (
	"review_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"title" text,
	"body" text,
	"moderation_state" text DEFAULT 'visible' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_listing_user_unique" UNIQUE("listing_id","user_id")
);

CREATE TABLE "user_library" (
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"package_version_id" uuid,
	"saved_at" timestamp DEFAULT now() NOT NULL,
	"install_receipt_id" text,
	CONSTRAINT "user_library_user_listing_unique" UNIQUE("user_id","listing_id")
);

CREATE TABLE "users" (
	"user_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"auth_provider" text NOT NULL,
	"auth_subject" text NOT NULL,
	"ba_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_ba_user_id_unique" UNIQUE("ba_user_id")
);

ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "creators" ADD CONSTRAINT "creators_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "install_receipts" ADD CONSTRAINT "install_receipts_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "install_receipts" ADD CONSTRAINT "install_receipts_listing_id_listings_listing_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("listing_id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "install_receipts" ADD CONSTRAINT "install_receipts_package_version_id_package_versions_package_version_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("package_version_id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "listing_previews" ADD CONSTRAINT "listing_previews_listing_id_listings_listing_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("listing_id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "listing_tags" ADD CONSTRAINT "listing_tags_listing_id_listings_listing_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("listing_id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "listings" ADD CONSTRAINT "listings_creator_id_creators_creator_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("creator_id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "moderation_flags" ADD CONSTRAINT "moderation_flags_reporter_user_id_users_user_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "moderation_jobs" ADD CONSTRAINT "moderation_jobs_assigned_to_users_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("user_id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "package_lineage" ADD CONSTRAINT "package_lineage_package_version_id_package_versions_package_version_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("package_version_id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "package_lineage" ADD CONSTRAINT "package_lineage_origin_listing_id_listings_listing_id_fk" FOREIGN KEY ("origin_listing_id") REFERENCES "public"."listings"("listing_id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "package_versions" ADD CONSTRAINT "package_versions_listing_id_listings_listing_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("listing_id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "publish_drafts" ADD CONSTRAINT "publish_drafts_creator_id_creators_creator_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("creator_id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "publish_drafts" ADD CONSTRAINT "publish_drafts_listing_id_listings_listing_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("listing_id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_listing_id_listings_listing_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("listing_id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_library" ADD CONSTRAINT "user_library_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_library" ADD CONSTRAINT "user_library_listing_id_listings_listing_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("listing_id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_library" ADD CONSTRAINT "user_library_package_version_id_package_versions_package_version_id_fk" FOREIGN KEY ("package_version_id") REFERENCES "public"."package_versions"("package_version_id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "install_receipts_user_id_idx" ON "install_receipts" USING btree ("user_id");
CREATE INDEX "install_receipts_listing_id_idx" ON "install_receipts" USING btree ("listing_id");
CREATE INDEX "install_receipts_package_version_id_idx" ON "install_receipts" USING btree ("package_version_id");
CREATE INDEX "listing_previews_listing_id_idx" ON "listing_previews" USING btree ("listing_id");
CREATE INDEX "listings_creator_id_idx" ON "listings" USING btree ("creator_id");
CREATE INDEX "moderation_flags_reporter_user_id_idx" ON "moderation_flags" USING btree ("reporter_user_id");
CREATE INDEX "moderation_flags_target_idx" ON "moderation_flags" USING btree ("target_type","target_id");
CREATE INDEX "moderation_jobs_assigned_to_idx" ON "moderation_jobs" USING btree ("assigned_to");
CREATE INDEX "moderation_jobs_target_idx" ON "moderation_jobs" USING btree ("target_type","target_id");
CREATE INDEX "package_lineage_package_version_id_idx" ON "package_lineage" USING btree ("package_version_id");
CREATE INDEX "package_lineage_origin_listing_id_idx" ON "package_lineage" USING btree ("origin_listing_id");
CREATE INDEX "publish_drafts_creator_id_idx" ON "publish_drafts" USING btree ("creator_id");
CREATE INDEX "publish_drafts_listing_id_idx" ON "publish_drafts" USING btree ("listing_id");
CREATE INDEX "reviews_user_id_idx" ON "reviews" USING btree ("user_id");
CREATE INDEX "user_library_listing_id_idx" ON "user_library" USING btree ("listing_id");
CREATE INDEX "user_library_package_version_id_idx" ON "user_library" USING btree ("package_version_id");
