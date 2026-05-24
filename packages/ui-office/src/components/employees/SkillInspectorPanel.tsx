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
      <div className="skill-inspector-empty">Select a skill to preview its SKILL.md body.</div>
    );
  }

  return (
    <div className="skill-inspector-panel">
      <header>
        <p>{skill.name}</p>
        <span>{skill.scope === 'employee' ? 'personal' : 'global'}</span>
      </header>
      <p data-slot="description">{skill.description}</p>
      {error && <p data-tone="error">{error}</p>}
      {!error && body === null && <p data-state="loading">Loading SKILL.md…</p>}
      {!error && body !== null && <pre>{body}</pre>}
    </div>
  );
}
