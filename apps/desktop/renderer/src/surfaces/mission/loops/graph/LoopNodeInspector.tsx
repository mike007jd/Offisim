/**
 * Read-only node inspector (PR-09). Renders the {@link NodeInspector} summary the
 * adapter derived from the IR: instruction, inputs/outputs, completion/gate,
 * skills, retry/budget. NEVER edits business steps — editing is prompt/recompile
 * (PR-08). Pure presentation over projected data.
 */

import type { ProjectedNode } from './loop-graph-adapter.js';
import { NODE_GRAMMAR } from './loop-graph-grammar.js';

export interface LoopNodeInspectorProps {
  node: ProjectedNode | null;
}

export function LoopNodeInspector({ node }: LoopNodeInspectorProps) {
  if (!node) {
    return (
      <aside className="off-loopinspector off-loopinspector--empty" aria-label="Node inspector">
        <p className="off-loopinspector-hint">
          Select a node to inspect its instruction, ports, and gates.
        </p>
      </aside>
    );
  }

  const grammar = NODE_GRAMMAR[node.kind];
  const Icon = grammar.icon;
  const insp = node.inspector;

  return (
    <aside className="off-loopinspector" aria-label={`Inspector: ${node.label}`}>
      <header className="off-loopinspector-head">
        <Icon className="off-loopinspector-icon" aria-hidden="true" />
        <div className="off-loopinspector-titles">
          <span className="off-loopinspector-kind">{grammar.kindWord}</span>
          <h3 className="off-loopinspector-title">{node.label}</h3>
        </div>
      </header>

      {insp.instruction ? (
        <section className="off-loopinspector-section">
          <span className="off-loopinspector-key">Instruction</span>
          <p className="off-loopinspector-text">{insp.instruction}</p>
        </section>
      ) : null}

      {node.referencedRevisionId ? (
        <section className="off-loopinspector-section">
          <span className="off-loopinspector-key">References</span>
          <p className="off-loopinspector-text off-loopinspector-mono">
            {node.referencedRevisionId}
          </p>
        </section>
      ) : null}

      {insp.gate ? (
        <section className="off-loopinspector-section off-loopinspector-section--gate">
          <span className="off-loopinspector-key">Human gate</span>
          <p className="off-loopinspector-text">{insp.gate.prompt}</p>
          <p className="off-loopinspector-sub">Why human-owned: {insp.gate.reason}</p>
        </section>
      ) : null}

      {insp.completion.length > 0 ? (
        <section className="off-loopinspector-section">
          <span className="off-loopinspector-key">Completion</span>
          <ul className="off-loopinspector-list">
            {insp.completion.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static positional display list; items are never reordered
              <li key={i} className="off-loopinspector-item">
                {line}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="off-loopinspector-ports">
        <section className="off-loopinspector-section">
          <span className="off-loopinspector-key">Inputs</span>
          {insp.inputs.length > 0 ? (
            <ul className="off-loopinspector-chips">
              {insp.inputs.map((p, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static positional display list; items are never reordered
                <li key={i} className="off-loopinspector-chip">
                  {p}
                </li>
              ))}
            </ul>
          ) : (
            <p className="off-loopinspector-sub">None</p>
          )}
        </section>
        <section className="off-loopinspector-section">
          <span className="off-loopinspector-key">Outputs</span>
          {insp.outputs.length > 0 ? (
            <ul className="off-loopinspector-chips">
              {insp.outputs.map((p, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static positional display list; items are never reordered
                <li key={i} className="off-loopinspector-chip">
                  {p}
                </li>
              ))}
            </ul>
          ) : (
            <p className="off-loopinspector-sub">None</p>
          )}
        </section>
      </div>

      {insp.skills.length > 0 ? (
        <section className="off-loopinspector-section">
          <span className="off-loopinspector-key">Skills</span>
          <ul className="off-loopinspector-chips">
            {insp.skills.map((s, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static positional display list; items are never reordered
              <li key={i} className="off-loopinspector-chip off-loopinspector-mono">
                {s}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="off-loopinspector-section">
        <span className="off-loopinspector-key">Retry &amp; budget</span>
        <p className="off-loopinspector-sub">{insp.retrySummary}</p>
        <p className="off-loopinspector-sub">{insp.budgetSummary}</p>
      </section>
    </aside>
  );
}
