import { Icon } from '@/design-system/icons/Icon.js';
import type { LoopCompileStatus, LoopIR, LoopValidationFinding } from '@offisim/shared-types';
import { CircleSlash, Info, TriangleAlert } from 'lucide-react';
import { buildGeneratedDetails } from './loop-generated-details.js';

/**
 * Advanced drawer (PR-08) — GENERATED, read-only details derived from the compiled
 * IR. To change anything here the user edits the prompt and recompiles; there is no
 * editable form and NO raw evaluator JSON / criteria fields. When there is no legal
 * IR yet (needs_input / invalid / not compiled) the drawer shows a hint and the
 * compile findings instead of empty cards.
 */

interface LoopAdvancedDrawerProps {
  ir: LoopIR | null;
  status: LoopCompileStatus | null;
  findings: LoopValidationFinding[];
  profileId: string | null;
  revisionNumber: number | null;
}

export function LoopAdvancedDrawer({
  ir,
  status,
  findings,
  profileId,
  revisionNumber,
}: LoopAdvancedDrawerProps) {
  const sections = buildGeneratedDetails(ir);
  const errorFindings = findings.filter((f) => f.severity === 'error');
  const warnFindings = findings.filter((f) => f.severity === 'warning');

  return (
    <div className="off-loop-details" aria-label="Generated loop details">
      <header className="off-loop-details-head">
        <span className="off-loop-details-title">Details</span>
        {profileId ? <span className="off-loop-details-profile">{profileId}</span> : null}
        {revisionNumber ? <span className="off-loop-details-rev">v{revisionNumber}</span> : null}
      </header>

      {errorFindings.length > 0 ? (
        <div className="off-loop-details-findings is-error" role="alert">
          <Icon icon={TriangleAlert} size="sm" />
          <ul>
            {errorFindings.map((f, i) => (
              <li key={`${f.code}:${f.ref ?? ''}:${i}`}>{f.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {warnFindings.length > 0 ? (
        <div className="off-loop-details-findings is-warn" role="status">
          <Icon icon={Info} size="sm" />
          <ul>
            {warnFindings.map((f, i) => (
              <li key={`${f.code}:${f.ref ?? ''}:${i}`}>{f.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {sections.length === 0 ? (
        <div className="off-loop-details-empty">
          <Icon icon={CircleSlash} size="sm" />
          <p>
            {status === 'needs_input'
              ? 'Answer the questions and recompile to generate the details.'
              : 'Compile this Loop to see its generated outcome, budget, gates, and oracles.'}
          </p>
          <p className="off-loop-details-empty-sub">
            To change any of these, edit the description and recompile.
          </p>
        </div>
      ) : (
        <div className="off-loop-details-body">
          {sections.map((section) => (
            <section key={section.key} className="off-loop-details-section">
              <h4 className="off-loop-details-sectiontitle">{section.title}</h4>
              <dl className="off-loop-details-rows">
                {section.rows.map((row, i) => (
                  <div key={i} className="off-loop-details-row">
                    <dt>{row.label}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <p className="off-loop-details-note">
            These are generated from your description. Edit the prompt and recompile to change them.
          </p>
        </div>
      )}
    </div>
  );
}
