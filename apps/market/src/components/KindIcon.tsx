import { User, Zap, GitBranch, Building2, LayoutGrid, Package } from 'lucide-react';

const icons: Record<string, typeof User> = {
  employee: User,
  skill: Zap,
  sop: GitBranch,
  company_template: Building2,
  office_layout: LayoutGrid,
  bundle: Package,
};

export function KindIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  const Icon = icons[kind] ?? Package;
  return <Icon size={size} className="text-gray-500" />;
}
