import { Icon } from '@/design-system/icons/Icon.js';
import { Sparkles, X } from 'lucide-react';
import {
  type ComposerSkillReference,
  useComposerSkillReferenceStore,
} from './composer-skill-reference-store.js';

const EMPTY_SKILL_REFERENCES: ComposerSkillReference[] = [];

/** Removable per-thread Skill chips rendered above the plain-text composer input. */
export function ComposerSkillChip({ threadId }: { threadId: string }) {
  const references = useComposerSkillReferenceStore(
    (state) => state.byThread[threadId] ?? EMPTY_SKILL_REFERENCES,
  );
  const removeReference = useComposerSkillReferenceStore((state) => state.removeReference);

  if (!references.length) return null;

  return (
    <div className="off-loop-chips" aria-label="Referenced Skills">
      {references.map((reference) => (
        <div key={reference.id} className="off-loop-chip">
          <span className="off-loop-chip-icon">
            <Icon icon={Sparkles} size="sm" />
          </span>
          <span className="off-loop-chip-text">
            <span className="off-loop-chip-name">
              <span>{reference.name}</span>
            </span>
            <span className="off-loop-chip-meta">{reference.source}</span>
          </span>
          <button
            type="button"
            className="off-loop-chip-x off-focusable"
            aria-label={`Remove Skill ${reference.name}`}
            onClick={() => removeReference(threadId, reference.skillId)}
          >
            <Icon icon={X} size="sm" />
          </button>
        </div>
      ))}
    </div>
  );
}
