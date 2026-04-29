import type { EmployeeRow } from '../runtime/repositories.js';

const LOCAL_TOOL_REQUEST_RE =
  /\b(read_file|write_file|bash|shell|terminal|command|workspace|file|folder|directory|path|pwd|ls|cat|sleep|pnpm|npm|cargo|timeout)\b|读取|读回|写入|文件|目录|工作区|命令|终端|越界|拒绝|超时/i;

export function requiresLocalOffisimTools(text: string | null | undefined): boolean {
  return LOCAL_TOOL_REQUEST_RE.test(text ?? '');
}

export function isLocalToolAssignableEmployee(employee: EmployeeRow): boolean {
  return employee.enabled === 1 && employee.is_external !== 1;
}
