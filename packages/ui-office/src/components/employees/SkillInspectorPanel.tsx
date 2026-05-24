import type { SkillMetadata } from '@offisim/shared-types';
import { useEffect, useState } from 'react';
import { useOffisimRuntimeServices } from '../../runtime/offisim-runtime-context';

interface SkillInspectorPanelProps {
  skill: SkillMetadata | null;
}

export function SkillInspectorPanel({ skill }: SkillInspectorPanelProps) {
  const runtime = useOffisimRuntimeServices();
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
      <div className="flex flex-col items-center justify-center gap-1 rounded-r-md border border-dashed border-line py-6 text-center text-fs-meta text-ink-4">
        Select a skill to preview its SKILL.md body.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-r-md border border-line bg-surface-2 p-3">
      <header className="flex items-center gap-2">
        <p className="text-fs-sm font-medium text-ink-1">{skill.name}</p>
        <span className="rounded-r-pill border border-line bg-surface-1 px-1.5 py-0.5 text-fs-meta text-ink-3">
          {skill.scope === 'employee' ? 'personal' : 'global'}
        </span>
      </header>
      <p className="text-fs-meta text-ink-3">{skill.description}</p>
      {error && <p className="text-fs-meta text-danger">{error}</p>}
      {!error && body === null && (
        <p className="text-fs-meta italic text-ink-4">Loading SKILL.md…</p>
      )}
      {!error && body !== null && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-r-sm border border-line bg-surface-1 p-3 text-fs-meta text-ink-3">
          {body}
        </pre>
      )}
    </div>
  );
}
