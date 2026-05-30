import type { EmployeeRepository, EmployeeRow, EmployeeUpdate } from '../runtime/repositories.js';
import { VaultParseError, parseDocument } from './codec.js';
import { employeeFrontmatterSchema, soulFrontmatterSchema } from './frontmatter.js';

export interface ImportDiagnostic {
  readonly kind: 'employee' | 'soul';
  readonly employeeId: string;
  readonly reason: string;
  readonly cause?: unknown;
}

export interface ImportOutcome {
  readonly applied: number;
  readonly skipped: number;
  readonly diagnostics: readonly ImportDiagnostic[];
}

export interface EmployeeSourceFile {
  readonly content: string;
  readonly mtime: string;
}

export interface EmployeeVaultFiles {
  readonly employee?: EmployeeSourceFile;
  readonly soul?: EmployeeSourceFile;
}

function newerThan(mdTime: string, rowTime: string): boolean {
  // Compare on parsed epoch rather than lexical order: both values are
  // schema-validated ISO-8601 (datetime + optional offset), so two equal
  // instants written with different offsets must still compare equal. If
  // either fails to parse (should not happen post-validation), fall back to
  // "not newer" so a bad md never wins the last-writer-wins resolution.
  const md = Date.parse(mdTime);
  const row = Date.parse(rowTime);
  if (Number.isNaN(md) || Number.isNaN(row)) {
    return false;
  }
  return md > row;
}

function soulBodyToFreeform(body: string): string | undefined {
  const withoutHeading = body.replace(/^#[^\n]*\n+/u, '').trim();
  if (!withoutHeading || withoutHeading.startsWith('_No soul narrative')) {
    return undefined;
  }
  return withoutHeading;
}

async function importEmployeeFile(
  repo: EmployeeRepository,
  row: EmployeeRow,
  file: EmployeeSourceFile,
  diagnostics: ImportDiagnostic[],
): Promise<boolean> {
  let parsed: ReturnType<typeof parseDocument>;
  try {
    parsed = parseDocument(file.content);
  } catch (err) {
    diagnostics.push({
      kind: 'employee',
      employeeId: row.employee_id,
      reason: err instanceof VaultParseError ? err.message : 'Unknown parse error',
      cause: err,
    });
    return false;
  }

  const result = employeeFrontmatterSchema.safeParse(parsed.frontmatter);
  if (!result.success) {
    diagnostics.push({
      kind: 'employee',
      employeeId: row.employee_id,
      reason: 'Frontmatter failed schema validation',
      cause: result.error,
    });
    return false;
  }

  const fm = result.data;
  if (fm.employee_id !== row.employee_id) {
    diagnostics.push({
      kind: 'employee',
      employeeId: row.employee_id,
      reason: `Frontmatter employee_id "${fm.employee_id}" does not match row "${row.employee_id}"`,
    });
    return false;
  }
  if (!newerThan(fm.updated_at, row.updated_at)) {
    return false;
  }

  const patch: EmployeeUpdate = {
    name: fm.name,
    role_slug: fm.role_slug as EmployeeRow['role_slug'],
    workstation_id: fm.workstation_id ?? null,
    enabled: fm.dismissed ? 0 : 1,
  };
  await repo.update(row.employee_id, patch);
  return true;
}

async function importSoulFile(
  repo: EmployeeRepository,
  row: EmployeeRow,
  file: EmployeeSourceFile,
  diagnostics: ImportDiagnostic[],
): Promise<boolean> {
  let parsed: ReturnType<typeof parseDocument>;
  try {
    parsed = parseDocument(file.content);
  } catch (err) {
    diagnostics.push({
      kind: 'soul',
      employeeId: row.employee_id,
      reason: err instanceof VaultParseError ? err.message : 'Unknown parse error',
      cause: err,
    });
    return false;
  }

  const result = soulFrontmatterSchema.safeParse(parsed.frontmatter);
  if (!result.success) {
    diagnostics.push({
      kind: 'soul',
      employeeId: row.employee_id,
      reason: 'Soul frontmatter failed schema validation',
      cause: result.error,
    });
    return false;
  }

  const fm = result.data;
  if (fm.employee_id !== row.employee_id) {
    diagnostics.push({
      kind: 'soul',
      employeeId: row.employee_id,
      reason: `Frontmatter employee_id "${fm.employee_id}" does not match row "${row.employee_id}"`,
    });
    return false;
  }
  if (!newerThan(fm.updated_at, row.updated_at)) {
    return false;
  }

  const freeform = soulBodyToFreeform(parsed.body);
  const mergedPersona: Record<string, unknown> = { ...fm.persona };
  if (freeform !== undefined) {
    mergedPersona.freeform = freeform;
  }
  await repo.update(row.employee_id, {
    persona_json: JSON.stringify(mergedPersona),
  });
  return true;
}

export async function importEmployeeBundle(
  repo: EmployeeRepository,
  row: EmployeeRow,
  files: EmployeeVaultFiles,
): Promise<ImportOutcome> {
  const diagnostics: ImportDiagnostic[] = [];
  let applied = 0;
  let skipped = 0;

  if (files.employee) {
    const didApply = await importEmployeeFile(repo, row, files.employee, diagnostics);
    if (didApply) {
      applied += 1;
    } else {
      skipped += 1;
    }
  }
  if (files.soul) {
    const didApply = await importSoulFile(repo, row, files.soul, diagnostics);
    if (didApply) {
      applied += 1;
    } else {
      skipped += 1;
    }
  }

  return { applied, skipped, diagnostics };
}
