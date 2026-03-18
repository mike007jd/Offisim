import { riskLabel } from '../lib/format.js';

const colors: Record<string, string> = {
  data_asset: 'bg-[rgba(34,197,94,0.1)] text-[var(--success)] border-[rgba(34,197,94,0.2)]',
  logic_asset: 'bg-[rgba(234,179,8,0.1)] text-[var(--warning)] border-yellow-200',
  privileged_asset: 'bg-[rgba(244,63,94,0.1)] text-[var(--accent-rose)] border-[rgba(244,63,94,0.2)]',
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
