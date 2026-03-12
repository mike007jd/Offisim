import { riskLabel } from '../lib/format';

const colors: Record<string, string> = {
  data_asset: 'bg-green-50 text-green-700 border-green-200',
  logic_asset: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  privileged_asset: 'bg-red-50 text-red-700 border-red-200',
};

export function RiskBadge({ risk }: { risk: string }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium border ${colors[risk] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}
    >
      {riskLabel(risk)}
    </span>
  );
}
