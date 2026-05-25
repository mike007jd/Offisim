import type { UsagePoint } from '@/data/types.js';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

interface UsageTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: Array<{ payload?: UsagePoint }>;
}

function UsageTooltip({ active, payload, label }: UsageTooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className="off-chart-tip">
      <span className="off-chart-tip-label">{label}</span>
      <span>
        <b>{point.runs}</b> runs · <b>${point.cost.toFixed(2)}</b>
      </span>
    </div>
  );
}

export function UsageChart({ data }: { data: UsagePoint[] }) {
  return (
    <div className="off-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 14, bottom: 0, left: 14 }}>
          <defs>
            <linearGradient id="off-usage-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--off-accent)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--off-accent)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fill: 'var(--off-ink-4)', fontSize: 10 }}
            dy={4}
          />
          <Tooltip
            content={<UsageTooltip />}
            cursor={{ stroke: 'var(--off-accent-ring)', strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey="runs"
            stroke="var(--off-accent)"
            strokeWidth={2}
            fill="url(#off-usage-fill)"
            dot={false}
            activeDot={{
              r: 3,
              fill: 'var(--off-accent)',
              stroke: 'var(--off-surface-1)',
              strokeWidth: 1.5,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
