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
      <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-default py-6 text-center text-xs text-text-muted">
        Select a skill to preview its SKILL.md body.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-default bg-surface-muted p-3">
      <header className="flex items-center gap-2">
        <p className="text-sm font-medium text-text-primary">{skill.name}</p>
        <span className="rounded-full border border-border-default bg-surface px-1.5 py-0.5 text-caption text-text-secondary">
          {skill.scope === 'employee' ? 'personal' : 'global'}
        </span>
      </header>
      <p className="text-xs text-text-secondary">{skill.description}</p>
      {error && <p className="text-xs text-error">{error}</p>}
      {!error && body === null && (
        <p className="text-xs italic text-text-muted">Loading SKILL.md…</p>
      )}
      {!error && body !== null && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border-default bg-surface p-3 text-caption text-text-secondary">
          {body}
        </pre>
      )}
    </div>
  );
}
