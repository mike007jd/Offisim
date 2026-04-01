import { Puzzle } from 'lucide-react';
import type { RuntimeSkillConfig } from '../../hooks/useEmployeeEditor';

interface SkillBindingListProps {
  sourcePackageId: string | null;
  runtimeSkill: RuntimeSkillConfig | null;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

export function SkillBindingList({
  sourcePackageId,
  runtimeSkill,
  enabled,
  onEnabledChange,
}: SkillBindingListProps) {
  if (!runtimeSkill) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-white/10 py-6 text-center">
        <Puzzle className="h-8 w-8 text-slate-600" />
        <p className="max-w-[260px] text-xs italic text-slate-400/70">
          No runtime skill bound to this employee yet. Install a skill package from the marketplace
          and bind it to unlock guided capabilities.
        </p>
      </div>
    );
  }

  const capabilityCount = runtimeSkill.capabilityIndex?.capabilities?.length ?? 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="flex items-start gap-2">
        <Puzzle className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-slate-100">{runtimeSkill.skillName}</p>
            <span className="rounded-full border border-blue-500/20 bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-200">
              {enabled ? 'enabled' : 'disabled'}
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">
              {capabilityCount} capabilities
            </span>
            {runtimeSkill.instructionMode && (
              <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">
                {runtimeSkill.instructionMode}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-400">{runtimeSkill.summary}</p>
          {sourcePackageId && (
            <p className="mt-1 text-[10px] font-mono text-slate-500">{sourcePackageId}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onEnabledChange(!enabled)}
          className="rounded-md border border-white/10 bg-slate-900 px-2 py-1 text-xs text-slate-200 transition hover:border-blue-400"
          aria-label={enabled ? 'Disable skill' : 'Enable skill'}
        >
          {enabled ? 'Disable' : 'Enable'}
        </button>
      </div>

      {capabilityCount > 0 && (
        <details className="rounded-md border border-white/10 bg-black/10 p-2">
          <summary className="cursor-pointer text-xs text-slate-300">Capabilities</summary>
          <ul className="mt-2 flex flex-col gap-1 text-xs text-slate-400">
            {runtimeSkill.capabilityIndex?.capabilities?.map((capability, index) => (
              <li
                key={`${capability.key ?? capability.label ?? capability.kind ?? 'cap'}-${index}`}
              >
                {capability.label ?? capability.key ?? capability.kind ?? 'Unnamed capability'}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
