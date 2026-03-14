# Phase 0 + Phase 1: Contract Patches & Monorepo Foundation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 从零搭建 AICS monorepo 骨架，使所有 Phase 2 workstream agent 可以并行开始工作。

**Architecture:** pnpm workspace monorepo + Turbo build pipeline。4 个 apps（web/desktop/market/platform）+ 11 个 packages。Phase 1 只创建骨架和类型基础，不写业务逻辑。有实质内容的包：shared-types（最小跨包类型）、asset-schema（manifest validator）、db-local（Drizzle SQLite schema）、db-platform（Drizzle Postgres schema）。其余包只有 stub。

**Tech Stack:** pnpm 10 · Turbo · TypeScript strict · Biome (lint+format) · Drizzle ORM · Vitest · React 19 · Vite 7 · Next.js 16 · Hono · Tailwind CSS

---

## Parallelism Map

```
Task 1 (sequential)  → Git init + contract patches
Task 2 (sequential)  → Root monorepo configs
Task 3 (sequential)  → packages/shared-types
  ├─ 🔀 PARALLEL SESSION POINT ──────────────────────────┐
  │                                                       │
Task 4a → packages/asset-schema    (Session A)            │
Task 4b → packages/db-local        (Session A)            │
Task 4c → packages/db-platform     (Session B, 可并行)     │
Task 5  → All 7 stub packages      (Session B, 可并行)     │
  │                                                       │
  ├─ 🔀 PARALLEL SESSION POINT ──────────────────────────┐
  │                                                       │
Task 6a → apps/web                 (Session A)            │
Task 6b → apps/market              (Session B)            │
Task 6c → apps/platform            (Session A or B)       │
Task 6d → apps/desktop             (Session A or B)       │
  │                                                       │
  └── Task 7 (sequential) → Full verification ────────────┘
```

**Session 建议：** Task 3 完成后，开两个并行 session（Session A + Session B）分别执行 Task 4a/4b/6a 和 Task 4c/5/6b。Task 7 回到单 session 做最终验证。

---

## Task 1: Git Init + Contract Patches

**Files:**
- Modify: `Docs/02_contracts_and_schemas/aics_manifest.schema.json`
- Modify: `Docs/02_contracts_and_schemas/aics_openapi.yaml`
- Modify: `Docs/02_contracts_and_schemas/aics_local_runtime_schema.sql`
- Modify: `Docs/02_contracts_and_schemas/aics_platform_registry_schema.sql`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `GEMINI.md`
- Create: `.gitignore`

**Step 1: Create .gitignore**

```gitignore
node_modules/
dist/
.turbo/
*.tsbuildinfo
.DS_Store
.env
.env.*
!.env.example
target/
src-tauri/target/
.next/
.vercel/
*.swp
*.swo
tmp/
```

**Step 2: Init git repo**

Run: `git init && git add .gitignore`
Expected: Initialized empty Git repository

**Step 3: Patch manifest schema — network_scope**

File: `Docs/02_contracts_and_schemas/aics_manifest.schema.json`

Change `permissions.network_scope.enum`:
```json
FROM: ["none", "limited", "open"]
TO:   ["none", "limited", "unrestricted"]
```

**Step 4: Patch OpenAPI — filesystem_scope**

File: `Docs/02_contracts_and_schemas/aics_openapi.yaml`

In `PermissionSummary.properties.filesystem_scope.enum`:
```yaml
FROM: [none, workspace, project_root, user_selected]
TO:   [none, workspace, project, custom_path]
```

**Step 5: Patch local runtime schema — asset_bindings nullability**

File: `Docs/02_contracts_and_schemas/aics_local_runtime_schema.sql`

Change `asset_bindings` table:
```sql
FROM: installed_asset_id TEXT NOT NULL REFERENCES installed_assets(installed_asset_id)
TO:   installed_asset_id TEXT REFERENCES installed_assets(installed_asset_id)
```

Add CHECK constraint (after all column defs, before closing paren):
```sql
CHECK (installed_asset_id IS NOT NULL OR install_txn_id IS NOT NULL)
```

**Step 6: Patch platform schema — moderation_jobs enums**

File: `Docs/02_contracts_and_schemas/aics_platform_registry_schema.sql`

In `moderation_jobs` table:
```sql
FROM: target_type TEXT NOT NULL CHECK(target_type IN ('listing','package_version','review'))
TO:   target_type TEXT NOT NULL CHECK(target_type IN ('listing','package_version','review','publish_draft'))

FROM: job_kind TEXT NOT NULL CHECK(job_kind IN ('manifest_scan','policy_review','lineage_check'))
TO:   job_kind TEXT NOT NULL CHECK(job_kind IN ('manifest_scan','policy_review','lineage_check','risk_review'))
```

**Step 7: Patch AGENTS/CLAUDE/GEMINI — core description**

Files: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`

In the repo shape section, change:
```
FROM: packages/core — orchestration kernel, runtime domain logic, install logic
TO:   packages/core — orchestration kernel, runtime domain logic, LLM gateway
```

**Step 8: Commit**

```bash
git add -A
git commit -m "phase-0: contract patches from drift audit

- network_scope: open → unrestricted (manifest schema ↔ OpenAPI alignment)
- filesystem_scope: OpenAPI aligned to manifest canonical values
- asset_bindings: allow nullable installed_asset_id with CHECK constraint
- moderation_jobs: add publish_draft target_type, risk_review job_kind
- core description: remove install logic claim, add LLM gateway"
```

Run: `git log --oneline`
Expected: 1 commit

---

## Task 2: Root Monorepo Configuration

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `biome.json`

**Step 1: Create root package.json**

```json
{
  "name": "aics",
  "private": true,
  "packageManager": "pnpm@10.15.1",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "test": "turbo run test",
    "format": "biome format --write .",
    "clean": "turbo run clean && rm -rf node_modules"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "turbo": "^2.4.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

**Step 3: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "lint": {},
    "test": {
      "dependsOn": ["build"]
    },
    "clean": {
      "cache": false
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

**Step 4: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": false
  },
  "exclude": ["node_modules", "dist"]
}
```

**Step 5: Create biome.json**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedImports": "warn",
        "noUnusedVariables": "warn"
      },
      "style": {
        "noNonNullAssertion": "warn"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "always",
      "trailingCommas": "all"
    }
  },
  "files": {
    "ignore": [
      "node_modules",
      "dist",
      ".turbo",
      ".next",
      "target",
      "*.sql",
      "*.json"
    ]
  }
}
```

**Step 6: Install dependencies**

Run: `pnpm install`
Expected: lockfile created, 0 errors

**Step 7: Verify biome works**

Run: `npx biome check .`
Expected: no errors on empty workspace

**Step 8: Commit**

```bash
git add -A
git commit -m "phase-1: root monorepo configuration

- pnpm workspace + turbo pipeline
- tsconfig.base with strict mode + bundler resolution
- biome for lint + format
- no eslint, no prettier"
```

---

## Task 3: packages/shared-types (Sequential — 必须先完成)

**Files:**
- Create: `packages/shared-types/package.json`
- Create: `packages/shared-types/tsconfig.json`
- Create: `packages/shared-types/src/index.ts`
- Create: `packages/shared-types/src/ids.ts`
- Create: `packages/shared-types/src/events.ts`
- Create: `packages/shared-types/src/states.ts`

**Step 1: Create package.json**

```json
{
  "name": "@aics/shared-types",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 3: Create src/ids.ts — opaque branded ID types**

```typescript
declare const __brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type CompanyId = Brand<string, 'CompanyId'>;
export type EmployeeId = Brand<string, 'EmployeeId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type MeetingId = Brand<string, 'MeetingId'>;
export type InstallTxnId = Brand<string, 'InstallTxnId'>;
export type InstalledPackageId = Brand<string, 'InstalledPackageId'>;
export type InstalledAssetId = Brand<string, 'InstalledAssetId'>;
export type ListingId = Brand<string, 'ListingId'>;
export type PackageId = Brand<string, 'PackageId'>;
export type AssetBindingId = Brand<string, 'AssetBindingId'>;
export type ReportId = Brand<string, 'ReportId'>;
```

**Step 4: Create src/states.ts — state discriminated unions**

```typescript
/** Employee lifecycle states — source: SCENE_STATE_MATRIX §6 + install state machine */
export type EmployeeState =
  | 'idle'
  | 'assigned'
  | 'thinking'
  | 'searching'
  | 'executing'
  | 'meeting'
  | 'blocked'
  | 'waiting'
  | 'reporting'
  | 'success'
  | 'failed'
  | 'paused';

/** Task lifecycle states — source: SCENE_STATE_MATRIX §7 */
export type TaskState =
  | 'created'
  | 'routed'
  | 'queued'
  | 'active'
  | 'waiting_input'
  | 'waiting_dependency'
  | 'review_ready'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Install transaction states — source: aics_install_state_machine.md
 * Binding happens BEFORE materializing (裁决确认).
 */
export type InstallState =
  | 'created'
  | 'manifest_loaded'
  | 'integrity_checked'
  | 'compatibility_checked'
  | 'dependency_planned'
  | 'awaiting_confirmation'
  | 'awaiting_bindings'
  | 'ready_to_install'
  | 'materializing'
  | 'installed'
  | 'failed'
  | 'rolled_back'
  | 'cancelled';

/** Meeting lifecycle states — source: SCENE_STATE_MATRIX §8 */
export type MeetingState =
  | 'scheduled'
  | 'gathering'
  | 'active'
  | 'waiting'
  | 'ended';

/** Report lifecycle states — source: SCENE_STATE_MATRIX §10 */
export type ReportState =
  | 'drafting'
  | 'ready'
  | 'delivered'
  | 'rejected';

/** Entity types that can emit runtime events */
export type RuntimeEntityType =
  | 'employee'
  | 'task'
  | 'meeting'
  | 'install'
  | 'report';
```

**Step 5: Create src/events.ts — event envelope**

```typescript
import type { RuntimeEntityType } from './states.js';

/**
 * Minimal cross-package event envelope.
 *
 * Payload typing is intentionally loose here — each consuming package
 * narrows via its own event catalog. shared-types only defines the envelope.
 */
export type RuntimeEvent<T extends string = string> = {
  /** Dot-delimited event type, e.g. "employee.state.changed" */
  readonly type: T;
  /** The entity this event is about */
  readonly entityId: string;
  /** Top-level entity kind */
  readonly entityType: RuntimeEntityType;
  /** Unix ms timestamp */
  readonly timestamp: number;
  /** Event-specific data — narrowed by consumers */
  readonly payload?: Readonly<Record<string, unknown>>;
};

/**
 * Well-known event type prefixes.
 * Consuming packages define the full catalog; these are just the namespaces.
 */
export type EventFamily =
  | 'employee.state.changed'
  | 'task.state.changed'
  | 'task.assignment.changed'
  | 'meeting.state.changed'
  | 'install.state.changed'
  | 'binding.state.changed'
  | 'report.state.changed'
  | 'runtime.performance.tier.changed'
  | 'ui.selection.changed';
```

**Step 6: Create src/index.ts — barrel export**

```typescript
export type {
  CompanyId,
  EmployeeId,
  TaskId,
  MeetingId,
  InstallTxnId,
  InstalledPackageId,
  InstalledAssetId,
  ListingId,
  PackageId,
  AssetBindingId,
  ReportId,
} from './ids.js';

export type {
  EmployeeState,
  TaskState,
  InstallState,
  MeetingState,
  ReportState,
  RuntimeEntityType,
} from './states.js';

export type { RuntimeEvent, EventFamily } from './events.js';
```

**Step 7: Build and verify**

Run: `cd packages/shared-types && pnpm install && pnpm build`
Expected: dist/ with .js and .d.ts files, 0 errors

**Step 8: Commit**

```bash
git add packages/shared-types
git commit -m "phase-1: packages/shared-types — opaque IDs, state unions, event envelope

Minimal cross-package type surface:
- Branded opaque ID types for all domain entities
- Discriminated unions for Employee/Task/Install/Meeting/Report states
- RuntimeEvent<T> envelope for event-driven communication
- No manifest types, no DB types, no OpenAPI types (those stay in their own packages)"
```

---

## 🔀 PARALLEL SESSION POINT

> **提醒人类 orchestrator：** Task 3 完成后，你可以开 2 个并行 session。
>
> - **Session A:** 执行 Task 4a → Task 4b → Task 6a → Task 6c
> - **Session B:** 执行 Task 4c → Task 5 → Task 6b → Task 6d
>
> 两个 session 之间无依赖，可同时启动。完成后回到单 session 执行 Task 7。

---

## Task 4a: packages/asset-schema (Session A)

**Files:**
- Create: `packages/asset-schema/package.json`
- Create: `packages/asset-schema/tsconfig.json`
- Create: `packages/asset-schema/src/schema/manifest-1.0.0.json` (copy from contracts)
- Create: `packages/asset-schema/src/manifest.types.ts`
- Create: `packages/asset-schema/src/validate.ts`
- Create: `packages/asset-schema/src/index.ts`
- Create: `packages/asset-schema/src/__tests__/validate.test.ts`
- Create: `packages/asset-schema/src/__tests__/fixtures/valid-manifest.json` (copy from contracts)

**Step 1: Create package.json**

```json
{
  "name": "@aics/asset-schema",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "ajv": "^8.17.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["src/__tests__"]
}
```

**Step 3: Copy manifest schema**

Run: `mkdir -p packages/asset-schema/src/schema && cp Docs/02_contracts_and_schemas/aics_manifest.schema.json packages/asset-schema/src/schema/manifest-1.0.0.json`

**Step 4: Copy example manifest as test fixture**

Run: `mkdir -p packages/asset-schema/src/__tests__/fixtures && cp Docs/02_contracts_and_schemas/aics_manifest_example.json packages/asset-schema/src/__tests__/fixtures/valid-manifest.json`

**Step 5: Create src/manifest.types.ts**

Write TypeScript types derived from the JSON Schema. Key types:

```typescript
/** Asset package kinds — source: manifest schema */
export type AssetKind =
  | 'employee'
  | 'skill'
  | 'sop'
  | 'company_template'
  | 'office_layout'
  | 'bundle';

export type SupportedEnvironment = 'desktop' | 'docker' | 'web_limited';

export type RiskClass = 'data_asset' | 'logic_asset' | 'privileged_asset';

export type FilesystemScope = 'none' | 'workspace' | 'project' | 'custom_path';

export type NetworkScope = 'none' | 'limited' | 'unrestricted';

export type MirrorPolicy = 'registry_only' | 'external_only' | 'registry_or_external';

export interface ManifestPackage {
  readonly id: string;
  readonly kind: AssetKind;
  readonly version: string;
  readonly title: string;
  readonly summary?: string;
  readonly license: string;
  readonly publisher?: {
    readonly creator_handle?: string;
    readonly display_name?: string;
  };
  readonly tags?: readonly string[];
}

export interface ManifestCompatibility {
  readonly runtime_range: string;
  readonly schema_version: string;
  readonly supported_environments: readonly SupportedEnvironment[];
  readonly migration_notes?: string;
}

export interface ManifestLineage {
  readonly origin_listing_id?: string;
  readonly origin_package_id?: string;
  readonly forked_from_version?: string;
  readonly derivative_of?: readonly string[];
}

export interface ManifestRecommendedModel {
  readonly profile: string;
  readonly reason?: string;
  readonly provider_hints?: readonly string[];
}

export interface ManifestRequirements {
  readonly required_capabilities: readonly string[];
  readonly required_mcps: readonly string[];
  readonly optional_mcps?: readonly string[];
  readonly recommended_models?: readonly ManifestRecommendedModel[];
}

export interface ManifestPermissions {
  readonly risk_class: RiskClass;
  readonly declares_secrets: boolean;
  readonly secret_slots_required?: readonly string[];
  readonly filesystem_scope: FilesystemScope;
  readonly network_scope: NetworkScope;
  readonly notes?: string;
}

export interface ManifestAsset {
  readonly asset_id: string;
  readonly kind: AssetKind;
  readonly path: string;
  readonly entrypoint?: string;
  readonly default_enabled?: boolean;
  readonly recommended_models?: readonly string[];
}

export interface ManifestDistribution {
  readonly source_url?: string;
  readonly mirror_policy?: MirrorPolicy;
  readonly artifact_size_bytes?: number;
}

export interface ManifestIntegrity {
  readonly package_sha256: string;
  readonly signature?: {
    readonly alg?: string;
    readonly key_id?: string;
    readonly sig?: string;
  };
  readonly files?: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
}

export interface ManifestPreviews {
  readonly icon_path?: string;
  readonly hero_image_path?: string;
  readonly readme_path?: string;
}

/** Top-level manifest type */
export interface PackageManifest {
  readonly spec_version: string;
  readonly package: ManifestPackage;
  readonly compatibility: ManifestCompatibility;
  readonly lineage?: ManifestLineage;
  readonly requirements: ManifestRequirements;
  readonly permissions: ManifestPermissions;
  readonly assets: readonly ManifestAsset[];
  readonly distribution?: ManifestDistribution;
  readonly integrity: ManifestIntegrity;
  readonly previews?: ManifestPreviews;
  readonly custom?: Readonly<Record<string, unknown>>;
}
```

**Step 6: Write the failing test**

File: `packages/asset-schema/src/__tests__/validate.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../validate.js';
import validManifest from './fixtures/valid-manifest.json';

describe('validateManifest', () => {
  it('accepts a valid manifest', () => {
    const result = validateManifest(validManifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toBeUndefined();
  });

  it('rejects a manifest missing required fields', () => {
    const result = validateManifest({});
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('rejects invalid network_scope value', () => {
    const bad = {
      ...validManifest,
      permissions: { ...validManifest.permissions, network_scope: 'open' },
    };
    const result = validateManifest(bad);
    expect(result.valid).toBe(false);
  });

  it('rejects invalid filesystem_scope value', () => {
    const bad = {
      ...validManifest,
      permissions: { ...validManifest.permissions, filesystem_scope: 'project_root' },
    };
    const result = validateManifest(bad);
    expect(result.valid).toBe(false);
  });
});
```

**Step 7: Run test to verify it fails**

Run: `cd packages/asset-schema && pnpm install && pnpm test`
Expected: FAIL — validateManifest not defined

**Step 8: Implement validate.ts**

```typescript
import Ajv from 'ajv';
import type { PackageManifest } from './manifest.types.js';
import schema from './schema/manifest-1.0.0.json' with { type: 'json' };

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors?: readonly { message: string; path: string }[];
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

export function validateManifest(data: unknown): ValidationResult {
  const valid = validate(data);
  if (valid) {
    return { valid: true };
  }
  return {
    valid: false,
    errors: (validate.errors ?? []).map((e) => ({
      message: e.message ?? 'unknown error',
      path: e.instancePath || '/',
    })),
  };
}

/** Type-narrowing helper: returns typed manifest if valid, throws otherwise */
export function parseManifest(data: unknown): PackageManifest {
  const result = validateManifest(data);
  if (!result.valid) {
    throw new Error(
      `Invalid manifest:\n${result.errors?.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`,
    );
  }
  return data as PackageManifest;
}
```

**Step 9: Create src/index.ts**

```typescript
export type {
  PackageManifest,
  ManifestPackage,
  ManifestCompatibility,
  ManifestLineage,
  ManifestRequirements,
  ManifestPermissions,
  ManifestAsset,
  ManifestDistribution,
  ManifestIntegrity,
  ManifestPreviews,
  ManifestRecommendedModel,
  AssetKind,
  SupportedEnvironment,
  RiskClass,
  FilesystemScope,
  NetworkScope,
  MirrorPolicy,
} from './manifest.types.js';

export { validateManifest, parseManifest } from './validate.js';
export type { ValidationResult } from './validate.js';
```

**Step 10: Run tests**

Run: `cd packages/asset-schema && pnpm test`
Expected: 4 tests pass

**Step 11: Build**

Run: `cd packages/asset-schema && pnpm build`
Expected: dist/ created, 0 errors

**Step 12: Commit**

```bash
git add packages/asset-schema
git commit -m "phase-1: packages/asset-schema — manifest types + AJV validator

- TypeScript types derived from manifest-1.0.0 JSON Schema
- AJV validator with allErrors mode
- parseManifest() type-narrowing helper
- Tests: valid manifest, missing fields, invalid enum values
- network_scope uses 'unrestricted' (post-patch canonical)"
```

---

## Task 4b: packages/db-local (Session A)

**Files:**
- Create: `packages/db-local/package.json`
- Create: `packages/db-local/tsconfig.json`
- Create: `packages/db-local/src/index.ts`
- Create: `packages/db-local/src/schema.ts`
- Create: `packages/db-local/src/migrations/` (copy all 4 SQL files)

**Step 1: Create package.json**

```json
{
  "name": "@aics/db-local",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "drizzle-orm": "^0.39.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 3: Copy migration SQL files**

Run:
```bash
mkdir -p packages/db-local/src/migrations
cp Docs/03_migrations/aics_migrations_local_v0.1/*.sql packages/db-local/src/migrations/
cp Docs/03_migrations/aics_migrations_local_v0.1/README.md packages/db-local/src/migrations/
```

**Step 4: Create src/schema.ts — Drizzle SQLite schema**

Derive from migration DDL. Key tables:

```typescript
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// ── 001: Core Tables ──

export const companies = sqliteTable('companies', {
  company_id: text('company_id').primaryKey(),
  name: text('name').notNull(),
  template_origin: text('template_origin'),
  engine_version: text('engine_version').notNull(),
  schema_version: text('schema_version').notNull(),
  created_at: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
  updated_at: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const employees = sqliteTable('employees', {
  employee_id: text('employee_id').primaryKey(),
  company_id: text('company_id').notNull().references(() => companies.company_id),
  role: text('role').notNull(),
  display_name: text('display_name').notNull(),
  system_role: text('system_role'),
  personality_config: text('personality_config'),
  model_profile: text('model_profile'),
  state: text('state').notNull().default('idle'),
  workstation_id: text('workstation_id'),
  origin_asset_id: text('origin_asset_id'),
  created_at: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
  updated_at: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const workstations = sqliteTable('workstations', {
  workstation_id: text('workstation_id').primaryKey(),
  company_id: text('company_id').notNull().references(() => companies.company_id),
  label: text('label'),
  department: text('department'),
  position_x: real('position_x'),
  position_y: real('position_y'),
  mcp_slots: text('mcp_slots'),
  created_at: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const skills = sqliteTable('skills', {
  skill_id: text('skill_id').primaryKey(),
  employee_id: text('employee_id').notNull().references(() => employees.employee_id),
  name: text('name').notNull(),
  config: text('config'),
  origin_asset_id: text('origin_asset_id'),
  created_at: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});

// ── 002: Install Tables ──

export const installedPackages = sqliteTable('installed_packages', {
  installed_package_id: text('installed_package_id').primaryKey(),
  company_id: text('company_id').notNull().references(() => companies.company_id),
  package_id: text('package_id').notNull(),
  version: text('version').notNull(),
  kind: text('kind').notNull(),
  manifest_snapshot: text('manifest_snapshot').notNull(),
  source_type: text('source_type').notNull(),
  source_ref: text('source_ref'),
  installed_at: text('installed_at').notNull().default('CURRENT_TIMESTAMP'),
  updated_at: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const installedAssets = sqliteTable('installed_assets', {
  installed_asset_id: text('installed_asset_id').primaryKey(),
  installed_package_id: text('installed_package_id').notNull().references(() => installedPackages.installed_package_id),
  asset_id: text('asset_id').notNull(),
  kind: text('kind').notNull(),
  entity_ref: text('entity_ref'),
  created_at: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const installTransactions = sqliteTable('install_transactions', {
  install_txn_id: text('install_txn_id').primaryKey(),
  company_id: text('company_id').notNull().references(() => companies.company_id),
  source_type: text('source_type').notNull(),
  source_ref: text('source_ref'),
  target_package_id: text('target_package_id'),
  target_version: text('target_version'),
  state: text('state').notNull().default('created'),
  manifest_snapshot: text('manifest_snapshot'),
  compatibility_result: text('compatibility_result'),
  error_code: text('error_code'),
  error_detail: text('error_detail'),
  started_at: text('started_at').notNull().default('CURRENT_TIMESTAMP'),
  finished_at: text('finished_at'),
});

export const assetBindings = sqliteTable('asset_bindings', {
  binding_id: text('binding_id').primaryKey(),
  installed_asset_id: text('installed_asset_id').references(() => installedAssets.installed_asset_id),
  install_txn_id: text('install_txn_id').references(() => installTransactions.install_txn_id),
  binding_type: text('binding_type').notNull(),
  binding_key: text('binding_key').notNull(),
  binding_value: text('binding_value'),
  status: text('status').notNull().default('pending'),
  created_at: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
  updated_at: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
});

// ── 003: Runtime Orchestration ──

export const tasks = sqliteTable('tasks', {
  task_id: text('task_id').primaryKey(),
  company_id: text('company_id').notNull().references(() => companies.company_id),
  title: text('title').notNull(),
  description: text('description'),
  state: text('state').notNull().default('created'),
  priority: integer('priority').notNull().default(0),
  assigned_employee_id: text('assigned_employee_id').references(() => employees.employee_id),
  parent_task_id: text('parent_task_id'),
  sop_ref: text('sop_ref'),
  created_at: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
  updated_at: text('updated_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const meetings = sqliteTable('meetings', {
  meeting_id: text('meeting_id').primaryKey(),
  company_id: text('company_id').notNull().references(() => companies.company_id),
  kind: text('kind').notNull(),
  state: text('state').notNull().default('scheduled'),
  agenda: text('agenda'),
  summary: text('summary'),
  started_at: text('started_at'),
  ended_at: text('ended_at'),
  created_at: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const meetingParticipants = sqliteTable('meeting_participants', {
  meeting_id: text('meeting_id').notNull().references(() => meetings.meeting_id),
  employee_id: text('employee_id').notNull().references(() => employees.employee_id),
  role: text('role').notNull().default('participant'),
  joined_at: text('joined_at'),
});

export const handoffEvents = sqliteTable('handoff_events', {
  event_id: text('event_id').primaryKey(),
  task_id: text('task_id').notNull().references(() => tasks.task_id),
  from_employee_id: text('from_employee_id').references(() => employees.employee_id),
  to_employee_id: text('to_employee_id').references(() => employees.employee_id),
  kind: text('kind').notNull(),
  payload: text('payload'),
  created_at: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const toolCalls = sqliteTable('tool_calls', {
  call_id: text('call_id').primaryKey(),
  task_id: text('task_id').notNull().references(() => tasks.task_id),
  employee_id: text('employee_id').notNull().references(() => employees.employee_id),
  tool_name: text('tool_name').notNull(),
  input_summary: text('input_summary'),
  output_summary: text('output_summary'),
  status: text('status').notNull().default('pending'),
  review_state: text('review_state').notNull().default('none'),
  cost_tokens: integer('cost_tokens'),
  started_at: text('started_at').notNull().default('CURRENT_TIMESTAMP'),
  finished_at: text('finished_at'),
});

export const checkpoints = sqliteTable('checkpoints', {
  checkpoint_id: text('checkpoint_id').primaryKey(),
  thread_id: text('thread_id').notNull(),
  step: integer('step').notNull(),
  state_blob: text('state_blob').notNull(),
  metadata: text('metadata'),
  created_at: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});

// ── 004: Audit and Events ──

export const runtimeEvents = sqliteTable('runtime_events', {
  event_id: text('event_id').primaryKey(),
  company_id: text('company_id').notNull().references(() => companies.company_id),
  event_type: text('event_type').notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id').notNull(),
  payload: text('payload'),
  created_at: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});

export const costLedger = sqliteTable('cost_ledger', {
  entry_id: text('entry_id').primaryKey(),
  company_id: text('company_id').notNull().references(() => companies.company_id),
  task_id: text('task_id').references(() => tasks.task_id),
  employee_id: text('employee_id').references(() => employees.employee_id),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  input_tokens: integer('input_tokens').notNull().default(0),
  output_tokens: integer('output_tokens').notNull().default(0),
  cost_usd: real('cost_usd'),
  created_at: text('created_at').notNull().default('CURRENT_TIMESTAMP'),
});
```

**Step 5: Create src/index.ts**

```typescript
export * from './schema.js';
```

**Step 6: Build**

Run: `cd packages/db-local && pnpm install && pnpm build`
Expected: 0 errors

**Step 7: Commit**

```bash
git add packages/db-local
git commit -m "phase-1: packages/db-local — Drizzle SQLite schema from migrations

- All 4 migration groups: core, install, runtime orchestration, audit
- Typed table definitions with foreign key references
- Migration SQL files copied as reference"
```

---

## Task 4c: packages/db-platform (Session B)

**Files:**
- Create: `packages/db-platform/package.json`
- Create: `packages/db-platform/tsconfig.json`
- Create: `packages/db-platform/src/index.ts`
- Create: `packages/db-platform/src/schema.ts`
- Create: `packages/db-platform/src/migrations/` (copy all 4 SQL files)

**Step 1: Create package.json**

```json
{
  "name": "@aics/db-platform",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "drizzle-orm": "^0.39.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 3: Copy migration SQL files**

Run:
```bash
mkdir -p packages/db-platform/src/migrations
cp Docs/03_migrations/aics_migrations_platform_v0.1/*.sql packages/db-platform/src/migrations/
cp Docs/03_migrations/aics_migrations_platform_v0.1/README.md packages/db-platform/src/migrations/
```

**Step 4: Create src/schema.ts — Drizzle Postgres schema**

Derive from platform migration DDL:

```typescript
import { pgTable, text, integer, timestamp, boolean, real, uuid, jsonb } from 'drizzle-orm/pg-core';

// ── 001: Auth and Creators ──

export const users = pgTable('users', {
  user_id: uuid('user_id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  display_name: text('display_name').notNull(),
  avatar_url: text('avatar_url'),
  auth_provider: text('auth_provider').notNull(),
  auth_subject: text('auth_subject').notNull(),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const creators = pgTable('creators', {
  creator_id: uuid('creator_id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull().references(() => users.user_id).unique(),
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
  creator_id: uuid('creator_id').notNull().references(() => creators.creator_id),
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
  listing_id: uuid('listing_id').notNull().references(() => listings.listing_id),
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
  listing_id: uuid('listing_id').notNull().references(() => listings.listing_id),
  tag: text('tag').notNull(),
});

export const listingPreviews = pgTable('listing_previews', {
  preview_id: uuid('preview_id').primaryKey().defaultRandom(),
  listing_id: uuid('listing_id').notNull().references(() => listings.listing_id),
  kind: text('kind').notNull(),
  url: text('url').notNull(),
  alt_text: text('alt_text'),
  sort_order: integer('sort_order').notNull().default(0),
});

// ── 003: Publish and Lineage ──

export const publishDrafts = pgTable('publish_drafts', {
  draft_id: uuid('draft_id').primaryKey().defaultRandom(),
  creator_id: uuid('creator_id').notNull().references(() => creators.creator_id),
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
  package_version_id: uuid('package_version_id').notNull().references(() => packageVersions.package_version_id),
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
  listing_id: uuid('listing_id').notNull().references(() => listings.listing_id),
  user_id: uuid('user_id').notNull().references(() => users.user_id),
  rating: integer('rating').notNull(),
  title: text('title'),
  body: text('body'),
  moderation_state: text('moderation_state').notNull().default('visible'),
  created_at: timestamp('created_at').notNull().defaultNow(),
  updated_at: timestamp('updated_at').notNull().defaultNow(),
});

export const userLibrary = pgTable('user_library', {
  user_id: uuid('user_id').notNull().references(() => users.user_id),
  listing_id: uuid('listing_id').notNull().references(() => listings.listing_id),
  package_version_id: uuid('package_version_id').references(() => packageVersions.package_version_id),
  saved_at: timestamp('saved_at').notNull().defaultNow(),
  install_receipt_id: text('install_receipt_id'),
});

export const moderationFlags = pgTable('moderation_flags', {
  flag_id: uuid('flag_id').primaryKey().defaultRandom(),
  target_type: text('target_type').notNull(),
  target_id: uuid('target_id').notNull(),
  reporter_user_id: uuid('reporter_user_id').notNull().references(() => users.user_id),
  reason: text('reason').notNull(),
  details: text('details'),
  status: text('status').notNull().default('open'),
  created_at: timestamp('created_at').notNull().defaultNow(),
});
```

**Step 5: Create src/index.ts**

```typescript
export * from './schema.js';
```

**Step 6: Build**

Run: `cd packages/db-platform && pnpm install && pnpm build`
Expected: 0 errors

**Step 7: Commit**

```bash
git add packages/db-platform
git commit -m "phase-1: packages/db-platform — Drizzle Postgres schema from migrations

- All 4 migration groups: auth, registry core, publish/lineage, reviews/library
- UUID primary keys, jsonb for manifests, typed enums via text CHECK
- Migration SQL files copied as reference"
```

---

## Task 5: All 7 Stub Packages (Session B)

**Files:** 7 packages × 3 files each = 21 files

Each stub package gets: `package.json`, `tsconfig.json`, `src/index.ts`

**Step 1: Create all stubs using a script**

Run this bash script:

```bash
cd /Users/haoshengli/Seafile/WebWorkSpace/Offisim

for pkg in core install-core renderer registry-client ui-core ui-office ui-market; do
  mkdir -p "packages/${pkg}/src"

  # tsconfig.json
  cat > "packages/${pkg}/tsconfig.json" << 'TSEOF'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
TSEOF

  # src/index.ts
  echo "// @aics/${pkg} — stub, Phase 2 implements" > "packages/${pkg}/src/index.ts"
  echo "export {};" >> "packages/${pkg}/src/index.ts"
done
```

**Step 2: Create each package.json with correct dependencies**

`packages/core/package.json`:
```json
{
  "name": "@aics/core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@aics/shared-types": "workspace:*",
    "@aics/db-local": "workspace:*"
  },
  "devDependencies": { "typescript": "^5.7.0", "vitest": "^3.0.0" }
}
```

`packages/install-core/package.json`:
```json
{
  "name": "@aics/install-core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@aics/shared-types": "workspace:*",
    "@aics/asset-schema": "workspace:*",
    "@aics/db-local": "workspace:*",
    "@aics/registry-client": "workspace:*"
  },
  "devDependencies": { "typescript": "^5.7.0", "vitest": "^3.0.0" }
}
```

`packages/renderer/package.json`:
```json
{
  "name": "@aics/renderer",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@aics/shared-types": "workspace:*"
  },
  "devDependencies": { "typescript": "^5.7.0", "vitest": "^3.0.0" }
}
```

`packages/registry-client/package.json`:
```json
{
  "name": "@aics/registry-client",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@aics/shared-types": "workspace:*"
  },
  "devDependencies": { "typescript": "^5.7.0", "vitest": "^3.0.0" }
}
```

`packages/ui-core/package.json`:
```json
{
  "name": "@aics/ui-core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "devDependencies": { "typescript": "^5.7.0" }
}
```

`packages/ui-office/package.json`:
```json
{
  "name": "@aics/ui-office",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@aics/shared-types": "workspace:*",
    "@aics/ui-core": "workspace:*"
  },
  "devDependencies": { "typescript": "^5.7.0" }
}
```

`packages/ui-market/package.json`:
```json
{
  "name": "@aics/ui-market",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@aics/ui-core": "workspace:*"
  },
  "devDependencies": { "typescript": "^5.7.0" }
}
```

**Step 3: Install and build all stubs**

Run: `cd /Users/haoshengli/Seafile/WebWorkSpace/Offisim && pnpm install && pnpm turbo run build --filter='./packages/*'`
Expected: All 11 packages build successfully

**Step 4: Commit**

```bash
git add packages/core packages/install-core packages/renderer packages/registry-client packages/ui-core packages/ui-office packages/ui-market
git commit -m "phase-1: 7 stub packages with correct dependency declarations

core → shared-types, db-local
install-core → shared-types, asset-schema, db-local, registry-client
renderer → shared-types
registry-client → shared-types
ui-core → (none)
ui-office → shared-types, ui-core
ui-market → ui-core"
```

---

## 🔀 PARALLEL SESSION POINT

> **提醒人类 orchestrator：** 4 个 apps 可以并行创建。
>
> - **Session A:** Task 6a (apps/web) + Task 6c (apps/platform)
> - **Session B:** Task 6b (apps/market) + Task 6d (apps/desktop)

---

## Task 6a: apps/web (Session A)

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/tsconfig.node.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/vite-env.d.ts`

**Step 1: Create package.json**

```json
{
  "name": "@aics/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "typecheck": "tsc --noEmit",
    "preview": "vite preview",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@aics/shared-types": "workspace:*",
    "@aics/ui-office": "workspace:*",
    "@aics/renderer": "workspace:*",
    "@aics/core": "workspace:*",
    "@aics/install-core": "workspace:*"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.4.0",
    "typescript": "^5.7.0",
    "vite": "^6.2.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "outDir": "dist",
    "noEmit": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

**Step 3: Create tsconfig.node.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "noEmit": false,
    "module": "ESNext"
  },
  "include": ["vite.config.ts"]
}
```

**Step 4: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
```

**Step 5: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Company Simulator</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 6: Create src/vite-env.d.ts**

```typescript
/// <reference types="vite/client" />
```

**Step 7: Create src/main.tsx**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

**Step 8: Create src/App.tsx**

```tsx
export function App() {
  return (
    <div style={{ fontFamily: 'system-ui', padding: '2rem' }}>
      <h1>AI Company Simulator — Runtime Shell</h1>
      <p>Vite + React SPA. Not Next.js.</p>
    </div>
  );
}
```

**Step 9: Install and verify dev server starts**

Run: `cd apps/web && pnpm install && pnpm dev &` then wait 3s, then `curl -s http://localhost:5173 | head -5`
Expected: HTML with "AI Company Simulator"
Kill dev server after verification.

**Step 10: Build**

Run: `cd apps/web && pnpm build`
Expected: dist/ created

**Step 11: Commit**

```bash
git add apps/web
git commit -m "phase-1: apps/web — Vite + React SPA runtime shell skeleton"
```

---

## Task 6b: apps/market (Session B)

**Files:**
- Create: `apps/market/package.json`
- Create: `apps/market/tsconfig.json`
- Create: `apps/market/next.config.ts`
- Create: `apps/market/src/app/layout.tsx`
- Create: `apps/market/src/app/page.tsx`

**Step 1: Create package.json**

```json
{
  "name": "@aics/market",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "typecheck": "tsc --noEmit",
    "start": "next start",
    "clean": "rm -rf .next"
  },
  "dependencies": {
    "next": "^15.2.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "@aics/ui-market": "workspace:*",
    "@aics/registry-client": "workspace:*"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "plugins": [{ "name": "next" }],
    "noEmit": true,
    "composite": false,
    "declaration": false,
    "declarationMap": false,
    "sourceMap": false,
    "incremental": true
  },
  "include": ["src", "next-env.d.ts", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**Step 3: Create next.config.ts**

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@aics/ui-market', '@aics/registry-client'],
};

export default nextConfig;
```

**Step 4: Create src/app/layout.tsx**

```tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AICS Talent Market',
  description: 'Discover and install AI company assets',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui' }}>{children}</body>
    </html>
  );
}
```

**Step 5: Create src/app/page.tsx**

```tsx
export default function Home() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>AICS Talent Market</h1>
      <p>Next.js App Router — marketplace website.</p>
    </main>
  );
}
```

**Step 6: Build**

Run: `cd apps/market && pnpm install && pnpm build`
Expected: .next/ created, 0 errors

**Step 7: Commit**

```bash
git add apps/market
git commit -m "phase-1: apps/market — Next.js 15 App Router marketplace skeleton"
```

---

## Task 6c: apps/platform (Session A)

**Files:**
- Create: `apps/platform/package.json`
- Create: `apps/platform/tsconfig.json`
- Create: `apps/platform/src/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "@aics/platform",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit",
    "start": "node dist/index.js",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "hono": "^4.7.0",
    "@aics/db-platform": "workspace:*",
    "@aics/shared-types": "workspace:*",
    "@aics/asset-schema": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "tsx": "^4.19.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 3: Create src/index.ts**

```typescript
import { Hono } from 'hono';

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;
export { app };

// Dev server entry — only runs directly
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const { serve } = await import('@hono/node-server');
  serve({ fetch: app.fetch, port: 4111 }, (info) => {
    console.log(`AICS Platform API running on http://localhost:${info.port}`);
  });
}
```

Note: Add `@hono/node-server` to dependencies:

```json
"dependencies": {
    "hono": "^4.7.0",
    "@hono/node-server": "^1.14.0",
    ...
}
```

**Step 4: Build**

Run: `cd apps/platform && pnpm install && pnpm build`
Expected: dist/ created, 0 errors

**Step 5: Commit**

```bash
git add apps/platform
git commit -m "phase-1: apps/platform — Hono API server skeleton with health check"
```

---

## Task 6d: apps/desktop (Session B)

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/src/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "@aics/desktop",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@aics/shared-types": "workspace:*",
    "@aics/core": "workspace:*",
    "@aics/install-core": "workspace:*",
    "@aics/renderer": "workspace:*",
    "@aics/ui-office": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src"]
}
```

**Step 3: Create src/index.ts**

```typescript
// @aics/desktop — Tauri 2 desktop app placeholder
// Full Tauri init will happen in Phase 2 (Desktop Shell Agent)
//
// This package will:
// 1. Initialize Tauri window loading apps/web as the renderer
// 2. Mount local HTTP server on port 43111
// 3. Inject install-core handlers into local server
// 4. Provide file system access via Tauri commands
// 5. Manage SQLite connection via db-local

export {};
```

**Step 4: Build**

Run: `cd apps/desktop && pnpm install && pnpm build`
Expected: dist/ created, 0 errors

**Step 5: Commit**

```bash
git add apps/desktop
git commit -m "phase-1: apps/desktop — Tauri 2 placeholder with dependency declarations"
```

---

## Task 7: Full Verification (Sequential — 单 session)

**Step 1: Clean install from root**

Run: `cd /Users/haoshengli/Seafile/WebWorkSpace/Offisim && rm -rf node_modules && pnpm install`
Expected: 0 errors

**Step 2: Full turbo build**

Run: `pnpm turbo run build`
Expected: All 15 packages/apps build successfully

**Step 3: Full typecheck**

Run: `pnpm turbo run typecheck`
Expected: 0 type errors

**Step 4: Lint**

Run: `pnpm lint`
Expected: Biome reports no errors (warnings acceptable)

**Step 5: Test**

Run: `pnpm turbo run test`
Expected: asset-schema tests pass (4/4)

**Step 6: Verify no `any` in public exports**

Run: `grep -r ': any' packages/*/src/index.ts apps/*/src/index.ts || echo "No any found"`
Expected: "No any found"

**Step 7: Verify apps/web dev server**

Run: `cd apps/web && pnpm dev &` wait 3s, `curl -s http://localhost:5173 | grep -o 'AI Company Simulator'`
Expected: "AI Company Simulator"
Kill server.

**Step 8: Final commit**

If any fixes were needed during verification:
```bash
git add -A
git commit -m "phase-1: verification fixes"
```

**Step 9: Tag phase-1 completion**

```bash
git tag phase-1-foundation
git log --oneline
```

Expected: Clean commit history showing phase-0 patches + phase-1 foundation

---

## Phase 1 Complete — Exit Criteria Checklist

- [ ] `pnpm install` — 0 errors
- [ ] `pnpm turbo run build` — all 15 targets pass
- [ ] `pnpm turbo run typecheck` — 0 type errors
- [ ] `pnpm lint` — 0 errors
- [ ] `pnpm turbo run test` — asset-schema 4/4 pass
- [ ] shared-types exports importable from other packages
- [ ] apps/web dev server serves React SPA
- [ ] apps/market builds as Next.js
- [ ] No `any` type escapes in public exports
- [ ] Git tag `phase-1-foundation` applied
