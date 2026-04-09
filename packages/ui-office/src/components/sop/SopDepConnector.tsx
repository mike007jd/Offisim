import type { SopStepStatus } from './SopStepCard';

export interface DepLine {
  fromStepId: string;
  toStepId: string;
  status: SopStepStatus;
}

export interface CardRect {
  stepId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SopDepConnectorProps {
  lines: DepLine[];
  cards: CardRect[];
  containerWidth: number;
  containerHeight: number;
}

const LINE_COLOR: Record<SopStepStatus, string> = {
  design: 'rgba(255,255,255,0.06)',
  pending: 'rgba(255,255,255,0.06)',
  active: 'rgba(34,211,238,0.45)',
  completed: 'rgba(52,211,153,0.35)',
  failed: 'rgba(248,113,113,0.35)',
};

const PARTICLE_COLOR: Record<string, string> = {
  active: 'rgba(34,211,238,0.9)',
  completed: 'rgba(52,211,153,0.7)',
};

function buildPath(from: CardRect, to: CardRect): string {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const dx = (x2 - x1) * 0.4;
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

export function SopDepConnector({
  lines,
  cards,
  containerWidth,
  containerHeight,
}: SopDepConnectorProps) {
  if (lines.length === 0 || cards.length === 0) return null;

  const cardMap = new Map(cards.map((c) => [c.stepId, c]));

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={containerWidth}
      height={containerHeight}
      aria-hidden="true"
    >
      {lines.map((line) => {
        const from = cardMap.get(line.fromStepId);
        const to = cardMap.get(line.toStepId);
        if (!from || !to) return null;

        const pathD = buildPath(from, to);
        const key = `${line.fromStepId}-${line.toStepId}`;
        return (
          <g key={key}>
            <path d={pathD} fill="none" stroke={LINE_COLOR[line.status]} strokeWidth={2} />
            {line.status === 'active' && (
              <>
                <circle r={2.5} fill={PARTICLE_COLOR.active}>
                  <animateMotion dur="1.5s" repeatCount="indefinite" path={pathD} />
                </circle>
                <circle r={2} fill={PARTICLE_COLOR.active} opacity={0.4}>
                  <animateMotion dur="1.5s" repeatCount="indefinite" path={pathD} begin="0.5s" />
                </circle>
              </>
            )}
            {line.status === 'completed' && (
              <circle r={2} fill={PARTICLE_COLOR.completed}>
                <animateMotion dur="2s" repeatCount="1" path={pathD} fill="freeze" />
              </circle>
            )}
          </g>
        );
      })}
    </svg>
  );
}
