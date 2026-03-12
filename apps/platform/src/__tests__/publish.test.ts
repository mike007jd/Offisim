import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { PlatformEnv } from '../types.js';
import { validateManifest } from '../services/validation.js';
import { publish } from '../routes/publish.js';
import { errorHandler } from '../middleware/error-handler.js';

// ── Shared Test Data ──

const USER_ID = '33333333-3333-3333-3333-333333333333';
const CREATOR_ID = '22222222-2222-2222-2222-222222222222';
const DRAFT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const JOB_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LISTING_ID = '11111111-1111-1111-1111-111111111111';

const fakeCreator = {
  creator_id: CREATOR_ID,
  user_id: USER_ID,
  handle: 'testcreator',
  display_name: 'Test Creator',
  bio: 'A bio',
  website_url: 'https://example.com',
  verification_state: 'verified',
  created_at: new Date('2025-12-01'),
  updated_at: new Date('2025-12-15'),
};

const fakeDraft = {
  draft_id: DRAFT_ID,
  creator_id: CREATOR_ID,
  listing_id: null as string | null,
  kind: 'employee',
  title: 'Test Employee',
  summary: 'A test employee',
  manifest_json: null,
  artifact_id: null,
  validation_state: 'unknown',
  validation_report: null,
  status: 'draft',
  created_at: new Date('2026-03-01'),
  updated_at: new Date('2026-03-01'),
};

const validManifest = {
  spec_version: '1.0',
  package: {
    id: 'test-employee-v1',
    kind: 'employee',
    version: '1.0.0',
    title: 'Test Employee',
    summary: 'A test employee',
    license: 'MIT',
  },
  compatibility: {
    runtime_range: '>=1.0.0',
    schema_version: '1.0',
    supported_environments: ['desktop'],
  },
  requirements: {
    required_capabilities: [],
    required_mcps: [],
  },
  permissions: {
    risk_class: 'data_asset',
    declares_secrets: false,
    filesystem_scope: 'none',
    network_scope: 'none',
  },
  assets: [{ asset_id: 'emp-1', kind: 'employee', path: './employee.json' }],
  integrity: {
    package_sha256: 'abc123def456',
  },
  previews: {
    readme_path: './README.md',
  },
};

// ── Mock Helpers ──

/**
 * Creates a chainable query builder mock (same pattern as market.test.ts).
 */
function createChainableMock(resolveValue: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const handler = {
    get(_target: unknown, prop: string) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(resolveValue);
      }
      if (!chain[prop]) {
        chain[prop] = vi.fn(() => new Proxy({}, handler));
      }
      return chain[prop];
    },
  };
  return new Proxy({}, handler);
}

function createMockDb(results: unknown[][]) {
  let callIndex = 0;
  const handler = {
    get(_target: unknown, prop: string) {
      if (prop === 'select' || prop === 'insert' || prop === 'update' || prop === 'delete') {
        const idx = callIndex++;
        const resolveValue = results[idx] ?? [];
        return vi.fn(() => createChainableMock(resolveValue));
      }
      return vi.fn();
    },
  };
  return new Proxy({}, handler) as any;
}

function createDevToken(payload: { sub: string; email?: string }): string {
  const header = btoa(JSON.stringify({ alg: 'none' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

function createApp(mockDb: any) {
  const app = new Hono<PlatformEnv>();
  app.use('*', async (c, next) => {
    c.set('db', mockDb);
    c.set('requestId', 'test-req-id');
    // Simulate optionalAuth: extract from Bearer token
    const authHeader = c.req.header('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        const payloadB64 = token.split('.')[1];
        if (payloadB64) {
          const payload = JSON.parse(atob(payloadB64));
          if (payload.sub) c.set('userId', payload.sub);
          if (payload.email) c.set('userEmail', payload.email);
        }
      } catch {
        // ignore
      }
    }
    await next();
  });
  app.onError(errorHandler);
  app.route('/v1/publish', publish);
  return app;
}

const AUTH_HEADER = `Bearer ${createDevToken({ sub: USER_ID, email: 'test@example.com' })}`;

// ── Validation Tests ──

describe('validateManifest', () => {
  it('accepts a valid manifest', () => {
    const result = validateManifest(validManifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing package section', () => {
    const { package: _, ...noPackage } = validManifest;
    const result = validateManifest(noPackage);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing package section');
  });

  it('rejects invalid kind', () => {
    const manifest = { ...validManifest, package: { ...validManifest.package, kind: 'invalid' } };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid package.kind'))).toBe(true);
  });

  it('rejects missing integrity hash', () => {
    const manifest = { ...validManifest, integrity: {} };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing integrity.package_sha256');
  });

  it('warns about missing readme', () => {
    const manifest = { ...validManifest, previews: {} };
    const result = validateManifest(manifest);
    expect(result.warnings).toContain('No readme_path in previews');
  });

  it('rejects non-object input', () => {
    const result = validateManifest('not an object');
    expect(result.valid).toBe(false);
  });

  it('rejects invalid environment', () => {
    const manifest = {
      ...validManifest,
      compatibility: { ...validManifest.compatibility, supported_environments: ['invalid_env'] },
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid environment'))).toBe(true);
  });

  it('rejects invalid risk class', () => {
    const manifest = {
      ...validManifest,
      permissions: { ...validManifest.permissions, risk_class: 'unknown_class' },
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid permissions.risk_class'))).toBe(true);
  });

  it('rejects non-boolean declares_secrets', () => {
    const manifest = {
      ...validManifest,
      permissions: { ...validManifest.permissions, declares_secrets: 'yes' },
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('permissions.declares_secrets must be boolean');
  });

  it('warns about missing package.summary', () => {
    const { summary: _, ...pkgNoSummary } = validManifest.package;
    const manifest = { ...validManifest, package: pkgNoSummary };
    const result = validateManifest(manifest);
    expect(result.warnings).toContain('No package.summary — recommended for marketplace display');
  });

  it('rejects null input', () => {
    const result = validateManifest(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Manifest must be a JSON object');
  });

  it('collects multiple errors at once', () => {
    const result = validateManifest({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
    expect(result.errors).toContain('Missing spec_version');
    expect(result.errors).toContain('Missing package section');
    expect(result.errors).toContain('Missing integrity section');
  });
});

// ── Publish Route Tests ──

describe('Publish Routes', () => {
  describe('POST /v1/publish/drafts', () => {
    it('creates a draft for an authenticated creator', async () => {
      const mockDb = createMockDb([
        // 1. creator lookup
        [fakeCreator],
        // 2. insert draft
        [fakeDraft],
      ]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/publish/drafts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: AUTH_HEADER,
        },
        body: JSON.stringify({ kind: 'employee', title: 'Test Employee' }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.draft_id).toBe(DRAFT_ID);
      expect(body.status).toBe('draft');
      expect(body.validation_state).toBe('unknown');
    });

    it('returns 401 without auth', async () => {
      const mockDb = createMockDb([]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/publish/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'employee', title: 'Test' }),
      });

      expect(res.status).toBe(401);
    });

    it('returns 403 if user is not a creator', async () => {
      const mockDb = createMockDb([
        [], // no creator found
      ]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/publish/drafts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: AUTH_HEADER,
        },
        body: JSON.stringify({ kind: 'employee', title: 'Test' }),
      });

      expect(res.status).toBe(403);
    });

    it('returns 400 if kind or title missing', async () => {
      const mockDb = createMockDb([]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/publish/drafts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: AUTH_HEADER,
        },
        body: JSON.stringify({ kind: 'employee' }), // missing title
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /v1/publish/drafts', () => {
    it('lists drafts for authenticated creator', async () => {
      const mockDb = createMockDb([
        // 1. creator lookup
        [fakeCreator],
        // 2. drafts list
        [fakeDraft],
      ]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/publish/drafts', {
        headers: { Authorization: AUTH_HEADER },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.drafts).toHaveLength(1);
      expect(body.drafts[0].draft_id).toBe(DRAFT_ID);
    });
  });

  describe('GET /v1/publish/drafts/:draftId', () => {
    it('returns draft details', async () => {
      const mockDb = createMockDb([
        // 1. creator lookup
        [fakeCreator],
        // 2. draft lookup
        [fakeDraft],
      ]);
      const app = createApp(mockDb);

      const res = await app.request(`/v1/publish/drafts/${DRAFT_ID}`, {
        headers: { Authorization: AUTH_HEADER },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.draft_id).toBe(DRAFT_ID);
      expect(body.kind).toBe('employee');
    });

    it('returns 404 for non-existent draft', async () => {
      const mockDb = createMockDb([
        [fakeCreator],
        [], // no draft found
      ]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/publish/drafts/00000000-0000-0000-0000-000000000000', {
        headers: { Authorization: AUTH_HEADER },
      });

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /v1/publish/drafts/:draftId/manifest', () => {
    it('validates and stores a valid manifest', async () => {
      const updatedDraft = {
        ...fakeDraft,
        manifest_json: validManifest,
        validation_state: 'valid',
        validation_report: { errors: [], warnings: [] },
      };

      const mockDb = createMockDb([
        // 1. creator lookup
        [fakeCreator],
        // 2. draft lookup
        [fakeDraft],
        // 3. update draft returning
        [updatedDraft],
      ]);
      const app = createApp(mockDb);

      const res = await app.request(`/v1/publish/drafts/${DRAFT_ID}/manifest`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: AUTH_HEADER,
        },
        body: JSON.stringify({ manifest_json: validManifest }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.validation_state).toBe('valid');
    });

    it('returns 400 for invalid manifest but still stores it', async () => {
      const invalidManifest = { spec_version: '1.0' }; // missing everything else
      const updatedDraft = {
        ...fakeDraft,
        manifest_json: invalidManifest,
        validation_state: 'invalid',
      };

      const mockDb = createMockDb([
        [fakeCreator],
        [fakeDraft],
        [updatedDraft], // update still happens
      ]);
      const app = createApp(mockDb);

      const res = await app.request(`/v1/publish/drafts/${DRAFT_ID}/manifest`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: AUTH_HEADER,
        },
        body: JSON.stringify({ manifest_json: invalidManifest }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.details.errors.length).toBeGreaterThan(0);
    });

    it('rejects manifest upload for already-submitted draft', async () => {
      const submittedDraft = { ...fakeDraft, status: 'submitted' };

      const mockDb = createMockDb([
        [fakeCreator],
        [submittedDraft],
      ]);
      const app = createApp(mockDb);

      const res = await app.request(`/v1/publish/drafts/${DRAFT_ID}/manifest`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: AUTH_HEADER,
        },
        body: JSON.stringify({ manifest_json: validManifest }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /v1/publish/submit', () => {
    it('submits a valid draft and creates moderation job', async () => {
      const validDraft = { ...fakeDraft, validation_state: 'valid' };
      const fakeJob = {
        job_id: JOB_ID,
        target_type: 'publish_draft',
        target_id: DRAFT_ID,
        job_kind: 'publish_review',
        status: 'pending',
        result: null,
        assigned_to: null,
        created_at: new Date(),
        completed_at: null,
      };
      const completedJob = { ...fakeJob, status: 'completed', result: { outcome: 'approved', listing_id: LISTING_ID } };

      const mockDb = createMockDb([
        // 1. creator lookup
        [fakeCreator],
        // 2. draft lookup
        [validDraft],
        // 3. update draft status to submitted
        [],
        // 4. insert moderation job
        [fakeJob],
        // --- processModerationJob calls ---
        // 5. select job
        [fakeJob],
        // 6. select draft (with manifest populated from prior manifest upload)
        [{ ...validDraft, status: 'submitted', manifest_json: validManifest }],
        // 7. insert listing (new listing)
        [{ listing_id: LISTING_ID }],
        // 8. insert package version
        [],
        // 9. update draft with listing_id
        [],
        // 10. update moderation job completed
        [],
        // --- back to route ---
        // 11. re-fetch job
        [completedJob],
      ]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/publish/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: AUTH_HEADER,
        },
        body: JSON.stringify({ draft_id: DRAFT_ID }),
      });

      expect(res.status).toBe(202);
      const body = (await res.json()) as any;
      expect(body.draft_id).toBe(DRAFT_ID);
      expect(body.moderation_job_id).toBe(JOB_ID);
      expect(body.status).toBe('queued');
    });

    it('rejects submission of invalid draft', async () => {
      const invalidDraft = { ...fakeDraft, validation_state: 'invalid' };

      const mockDb = createMockDb([
        [fakeCreator],
        [invalidDraft],
      ]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/publish/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: AUTH_HEADER,
        },
        body: JSON.stringify({ draft_id: DRAFT_ID }),
      });

      expect(res.status).toBe(400);
    });

    it('rejects submission without draft_id', async () => {
      const mockDb = createMockDb([]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/publish/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: AUTH_HEADER,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('rejects re-submission of already submitted draft', async () => {
      const submittedDraft = { ...fakeDraft, validation_state: 'valid', status: 'submitted' };

      const mockDb = createMockDb([
        [fakeCreator],
        [submittedDraft],
      ]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/publish/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: AUTH_HEADER,
        },
        body: JSON.stringify({ draft_id: DRAFT_ID }),
      });

      expect(res.status).toBe(400);
    });
  });
});
