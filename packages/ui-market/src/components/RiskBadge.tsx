import { riskLabel } from '../lib/format.js';

const colors: Record<string, string> = {
  data_asset: 'bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/20',
  logic_asset: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  privileged_asset: 'bg-[var(--accent-rose)]/10 text-red-700 border-red-200',
};

export function RiskBadge({ risk }: { risk: string }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium border ${colors[risk] ?? 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border)]'}`}
    >
      {riskLabel(risk)}
    </span>
  );
}
