import { Puzzle } from 'lucide-react';

interface SkillBindingListProps {
  employeeId: string;
  sourcePackageId: string | null;
}

export function SkillBindingList({
  employeeId: _employeeId,
  sourcePackageId,
}: SkillBindingListProps) {
  if (!sourcePackageId) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <Puzzle className="h-8 w-8 text-slate-600" />
        <p className="text-xs text-slate-400/70 italic max-w-[220px]">
          No skills installed — install skill packages from the marketplace
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5">
        <Puzzle className="h-4 w-4 text-blue-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-300 font-medium truncate">Source Package</p>
          <p className="text-[10px] text-slate-500 font-mono truncate">{sourcePackageId}</p>
        </div>
        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/20">
          installed
        </span>
      </div>
    </div>
  );
}
