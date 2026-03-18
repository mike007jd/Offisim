export interface DashboardStatsProps {
  publishedCount: number;
  draftCount: number;
  totalInstalls: number;
}

interface StatCardProps {
  label: string;
  value: number;
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="rounded-lg border border-[var(--border)] px-5 py-4">
      <p className="text-2xl font-bold text-[var(--text-primary)]">{value.toLocaleString()}</p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{label}</p>
    </div>
  );
}

export function DashboardStats({ publishedCount, draftCount, totalInstalls }: DashboardStatsProps) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <StatCard label="Published Listings" value={publishedCount} />
      <StatCard label="Active Drafts" value={draftCount} />
      <StatCard label="Total Installs" value={totalInstalls} />
    </div>
  );
}
