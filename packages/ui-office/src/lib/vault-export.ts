import {
  employeeSlug,
  renderEmployeeMd,
  renderMemoryMd,
  renderRelationshipsMd,
  renderSoulMd,
  type RuntimeRepositories,
} from '@offisim/core/browser';
import { zipSync } from 'fflate';

function sanitizeFileName(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || 'company'
  );
}

function downloadBytes(fileName: string, bytes: Uint8Array): void {
  const blobBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const arrayBuffer = blobBytes.buffer.slice(
    blobBytes.byteOffset,
    blobBytes.byteOffset + blobBytes.byteLength,
  ) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([arrayBuffer], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function exportVaultSnapshotZip(
  repos: RuntimeRepositories,
  companyId: string,
): Promise<{ fileName: string; fileCount: number }> {
  const [company, employees] = await Promise.all([
    repos.companies.findById(companyId),
    repos.employees.findByCompany(companyId),
  ]);

  const files: Record<string, Uint8Array> = {};
  for (const employee of employees) {
    const slug = employeeSlug(employee.name, employee.employee_id);
    const basePath = `companies/${companyId}/employees/${slug}`;
    const memories = await repos.memories.findByOwner(employee.employee_id, { limit: 50 });
    files[`${basePath}/employee.md`] = new TextEncoder().encode(renderEmployeeMd(employee));
    files[`${basePath}/soul.md`] = new TextEncoder().encode(renderSoulMd(employee));
    files[`${basePath}/memory.md`] = new TextEncoder().encode(renderMemoryMd(employee, memories));
    files[`${basePath}/relationships.md`] = new TextEncoder().encode(
      renderRelationshipsMd(employee),
    );
  }

  const fileName = `${sanitizeFileName(company?.name ?? companyId)}-vault-snapshot.zip`;
  downloadBytes(fileName, zipSync(files, { level: 6 }));
  return { fileName, fileCount: Object.keys(files).length };
}
