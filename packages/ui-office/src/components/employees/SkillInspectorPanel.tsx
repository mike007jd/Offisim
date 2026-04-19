import type { SkillMetadata } from '@offisim/shared-types';
import { useEffect, useState } from 'react';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';

interface SkillInspectorPanelProps {
  skill: SkillMetadata | null;
}

export function SkillInspectorPanel({ skill }: SkillInspectorPanelProps) {
  const runtime = useOffisimRuntime();
  const [body, setBody] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (!skill) {
      setBody(null);
      return () => {
        cancelled = true;
      };
    }
    const loader = runtime?.skillLoader;
    if (!loader) {
      setBody(null);
      setError('Skill loader is not available yet.');
      return () => {
        cancelled = true;
      };
    }
    setBody(null);
    loader
      .loadSkillBody(skill.id)
      .then((text) => {
        if (!cancelled) setBody(text);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [skill, runtime?.skillLoader]);

  if (!skill) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/10 py-6 text-center text-xs text-slate-500">
        Select a skill to preview its SKILL.md body.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/5 p-3">
      <header className="flex items-center gap-2">
        <p className="text-sm font-medium text-slate-100">{skill.name}</p>
        <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">
          {skill.scope === 'employee' ? 'personal' : 'global'}
        </span>
      </header>
      <p className="text-xs text-slate-400">{skill.description}</p>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!error && body === null && (
        <p className="text-xs italic text-slate-500">Loading SKILL.md…</p>
      )}
      {!error && body !== null && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-black/30 p-3 text-[11px] text-slate-200">
          {body}
        </pre>
      )}
    </div>
  );
}
