import { Button, cn } from '@offisim/ui-core';
import { type AgentState, DicebearAvatar, STATUS_DOTS } from '@offisim/ui-office/web';
import { Plus } from 'lucide-react';

interface StageTeamDockProps {
  agents: Map<string, AgentState>;
  selectedEmployeeId: string | null;
  onSelectEmployee: (id: string) => void;
  onOpenCreator: () => void;
}

/**
 * Horizontal Team dock below the stage — relocation home of the displaced
 * left-rail employee roster (`AgentPanel`). Each employee is an avatar + name +
 * status dot; selecting one anchors the existing employee inspector / Personnel
 * routing. The strip ends with an `Add` slot that opens employee creation.
 * In-scene avatars (scene canvas) carry the same roster on the stage itself.
 */
export function StageTeamDock({
  agents,
  selectedEmployeeId,
  onSelectEmployee,
  onOpenCreator,
}: StageTeamDockProps) {
  const entries = [...agents.entries()];

  return (
    <section
      className="pointer-events-auto flex h-24 items-center gap-sp-4 border-t border-line bg-gradient-to-b from-surface-1/[0.97] to-surface-2/[0.97] px-sp-5"
      aria-label="Team dock"
    >
      <div className="flex h-14 flex-none flex-col justify-center gap-1 border-r border-line-soft pr-sp-6">
        <span className="text-fs-micro font-bold uppercase tracking-ls-caps text-ink-3">
          Team
        </span>
        <span className="self-start rounded-r-pill border border-line-soft bg-surface-sunken px-2 py-px text-fs-micro font-semibold text-ink-3">
          {entries.length} {entries.length === 1 ? 'person' : 'people'}
        </span>
      </div>

      <div className="custom-scrollbar flex h-full min-w-0 flex-1 items-center gap-sp-4 overflow-x-auto px-sp-1">
        {entries.map(([id, agent]) => {
          const selected = selectedEmployeeId === id;
          return (
            <Button
              type="button"
              variant="ghost"
              key={id}
              onClick={() => onSelectEmployee(id)}
              aria-pressed={selected}
              title={`${agent.name} · ${agent.role}`}
              className={cn(
                'relative flex h-20 w-16 shrink-0 flex-col items-center gap-1 rounded-r-lg border px-1 pb-1.5 pt-1.5 transition-all',
                selected
                  ? 'border-accent-ring bg-surface-1 shadow-elev-2 ring-1 ring-accent-ring'
                  : 'border-transparent hover:-translate-y-0.5 hover:border-line-soft hover:bg-surface-1 hover:shadow-elev-2',
              )}
            >
              <DicebearAvatar
                seed={agent.avatarSeed}
                appearance={agent.appearance}
                size={46}
                className="shadow-elev-1 ring-2 ring-surface-1"
              />
              <span className="max-w-full truncate text-fs-micro font-semibold text-ink-1">
                {agent.name}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'absolute right-2 top-1.5 size-2.5 rounded-full ring-2 ring-surface-1',
                  STATUS_DOTS[agent.state] ?? 'bg-text-muted',
                )}
              />
            </Button>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          onClick={onOpenCreator}
          title="Add employee"
          className="flex h-20 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-r-lg border border-dashed border-line-strong text-ink-3 transition-colors hover:border-accent hover:bg-accent-surface hover:text-accent"
        >
          <Plus className="size-5" aria-hidden="true" />
          <span className="text-fs-meta font-semibold">Add</span>
        </Button>
      </div>
    </section>
  );
}
