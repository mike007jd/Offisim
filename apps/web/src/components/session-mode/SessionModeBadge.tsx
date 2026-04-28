import { INTERACTION_MODE_LABEL, type InteractionMode } from '@offisim/shared-types';

const MODE_COLOR: Record<InteractionMode, string> = {
  boss_proxy: 'var(--color-foam)',
  human_in_loop: 'var(--color-coral-orange)',
  direct_to_employee: 'var(--color-sea-blue)',
  yolo: 'var(--color-kelp-green)',
};

export interface SessionModeBadgeProps {
  mode: InteractionMode;
}

export function SessionModeBadge({ mode }: SessionModeBadgeProps) {
  return (
    <span
      className="inline-flex h-5 min-w-0 items-center rounded-full border px-2 text-[10px] font-black uppercase"
      style={{
        borderColor: `color-mix(in srgb, ${MODE_COLOR[mode]} 55%, transparent)`,
        background: `color-mix(in srgb, ${MODE_COLOR[mode]} 14%, transparent)`,
        color: MODE_COLOR[mode],
      }}
    >
      {INTERACTION_MODE_LABEL[mode]}
    </span>
  );
}
