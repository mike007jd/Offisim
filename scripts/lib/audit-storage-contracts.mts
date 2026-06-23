// Reusable storage-consistency contract oracles (Wave 0 of the GPT-5.5 audit
// remediation). See Docs/contracts/storage-consistency-contracts.md.
//
// These assertions are deliberately backend-agnostic: they take a repository that
// satisfies the office-layout slice of `RuntimeRepositories['officeLayouts']` and
// hold for BOTH the better-sqlite3 and sqlite-proxy backends once the tenant
// boundary (contract C-A) is honoured.

import assert from 'node:assert/strict';

export interface OfficeLayoutRowLike {
  readonly layout_id: string;
  readonly company_id: string;
  readonly is_active: number;
}

export interface OfficeLayoutsContractRepo {
  findByCompany(companyId: string): Promise<OfficeLayoutRowLike[]>;
  findActive(companyId: string): Promise<OfficeLayoutRowLike | null>;
  setActive(companyId: string, layoutId: string): Promise<void>;
}

/** Contract C-A specialization: a company has exactly one active layout, == expectedId. */
export async function assertExactlyOneActive(
  backend: string,
  repo: OfficeLayoutsContractRepo,
  companyId: string,
  expectedActiveId: string,
): Promise<void> {
  const rows = await repo.findByCompany(companyId);
  const active = rows.filter((r) => r.is_active === 1);
  assert.equal(
    active.length,
    1,
    `[${backend}] company ${companyId} must have exactly one active layout, found ${active.length}`,
  );
  assert.equal(
    active[0]?.layout_id,
    expectedActiveId,
    `[${backend}] company ${companyId} active layout must be ${expectedActiveId}, found ${active[0]?.layout_id}`,
  );
}

async function assertRejectsAndStateUnchanged(
  backend: string,
  repo: OfficeLayoutsContractRepo,
  companyId: string,
  badLayoutId: string,
  expectedActiveId: string,
  label: string,
): Promise<void> {
  let threw = false;
  try {
    await repo.setActive(companyId, badLayoutId);
  } catch {
    threw = true;
  }
  assert.ok(
    threw,
    `[${backend}] setActive(${companyId}, ${badLayoutId}) — ${label} — must reject, did not throw`,
  );
  // Tenant boundary: the rejected call must not have torn down the company's
  // active state (atomic rollback). This is the assertion the pre-fix Tauri
  // backend fails: it deactivates every layout of the company and activates none.
  await assertExactlyOneActive(backend, repo, companyId, expectedActiveId);
}

/**
 * Full office-layout setActive contract. Caller supplies a repo already seeded with:
 *   company A: layout A1 (active), layout A2 (inactive)
 *   company B: layout B1 (active)
 * and the four layout ids. Holds on both backends only when contract C-A is honoured.
 */
export async function runOfficeLayoutSetActiveContract(
  backend: string,
  repo: OfficeLayoutsContractRepo,
  ids: { companyA: string; companyB: string; a1: string; a2: string; b1: string },
): Promise<void> {
  const { companyA, companyB, a1, a2, b1 } = ids;

  // Baseline.
  await assertExactlyOneActive(backend, repo, companyA, a1);
  await assertExactlyOneActive(backend, repo, companyB, b1);

  // 1. Valid sibling activation flips A1 -> A2 and leaves company B untouched.
  await repo.setActive(companyA, a2);
  await assertExactlyOneActive(backend, repo, companyA, a2);
  await assertExactlyOneActive(backend, repo, companyB, b1);

  // 2. Cross-tenant: activating B's layout under company A must be rejected
  //    atomically; A keeps A2 active, B keeps B1 active.
  await assertRejectsAndStateUnchanged(backend, repo, companyA, b1, a2, 'cross-tenant layout');
  await assertExactlyOneActive(backend, repo, companyB, b1);

  // 3. Non-existent layout id must be rejected atomically; A keeps A2 active.
  await assertRejectsAndStateUnchanged(
    backend,
    repo,
    companyA,
    'ghost-layout-id',
    a2,
    'non-existent layout',
  );
}
