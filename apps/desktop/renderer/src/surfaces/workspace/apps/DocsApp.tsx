import { useUiState } from '@/app/ui-state.js';
import { useEmployees } from '@/data/queries.js';
import type { Employee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { SegmentedControl } from '@/design-system/grammar/SegmentedControl.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { EmptyState } from '@/surfaces/shared/SurfaceStates.js';
import {
  Activity,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Layers,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { type DocFormat, type WsDoc, useWsDocs } from '../workspace-data.js';

type Segment = 'all' | 'documents' | 'files';

const SEGMENTS: ReadonlyArray<{ value: Segment; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'documents', label: 'Documents' },
  { value: 'files', label: 'Files' },
];

const FORMAT_ICON: Record<DocFormat, LucideIcon> = {
  DOCX: FileText,
  MD: FileText,
  PDF: FileText,
  TXT: FileText,
  HTML: FileText,
  CSV: FileSpreadsheet,
  PPTX: Layers,
};

function contributorSummary(doc: WsDoc, byId: Map<string, Employee>): string {
  const names = doc.contributorIds.map((id) => byId.get(id)?.name?.split(' ')[0] ?? '—');
  if (names.length <= 2) return names.join(' · ');
  return `${names.slice(0, 2).join(' · ')} +${names.length - 2}`;
}

export function DocsApp() {
  const docs = useWsDocs();
  const employees = useEmployees();
  const selectedId = useUiState((s) => s.workspaceSelectedId);
  const selectItem = useUiState((s) => s.selectWorkspaceItem);
  const [segment, setSegment] = useState<Segment>('all');
  const [query, setQuery] = useState('');

  const byId = useMemo(
    () => new Map((employees.data ?? []).map((e) => [e.id, e])),
    [employees.data],
  );

  const list = docs.data ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((d) => {
      if (segment === 'documents' && d.kind !== 'document') return false;
      if (segment === 'files' && d.kind !== 'file') return false;
      if (!q) return true;
      const contribs = d.contributorIds
        .map((id) => byId.get(id)?.name?.toLowerCase() ?? '')
        .join(' ');
      return d.title.toLowerCase().includes(q) || contribs.includes(q);
    });
  }, [list, segment, query, byId]);

  const groups = useMemo(() => {
    const map = new Map<string, WsDoc[]>();
    for (const d of filtered) {
      const arr = map.get(d.group) ?? [];
      arr.push(d);
      map.set(d.group, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  const activeId =
    selectedId && filtered.some((d) => d.id === selectedId)
      ? selectedId
      : (filtered[0]?.id ?? null);
  const active = list.find((d) => d.id === activeId) ?? null;
  const total = list.length;

  return (
    <>
      <div className="off-ws-list">
        <div className="off-ws-list-head off-ws-list-head-col">
          <span className="off-ws-list-title">Docs</span>
          <SegmentedControl
            options={SEGMENTS.map((s) => ({
              value: s.value,
              label:
                s.value === 'all' ? (
                  <>
                    {s.label}
                    <span className="off-ws-seg-ct">{total}</span>
                  </>
                ) : (
                  s.label
                ),
            }))}
            value={segment}
            onChange={setSegment}
            ariaLabel="Doc segments"
          />
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search title or contributor"
          />
        </div>
        <div className="off-ws-rows off-ws-doc-rows">
          {groups.map(([group, items]) => (
            <div key={group} className="off-ws-doc-grp">
              <div className="off-ws-im-sec">{group}</div>
              {items.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={cn('off-ws-doc-row off-focusable', d.id === activeId && 'is-active')}
                  onClick={() => selectItem(d.id)}
                >
                  <span className="off-ws-doc-ic">
                    <Icon icon={FORMAT_ICON[d.format]} size="sm" />
                  </span>
                  <span className="off-ws-doc-copy">
                    <span className="off-ws-doc-nm">{d.title}</span>
                    <span className="off-ws-doc-sub">
                      {contributorSummary(d, byId)} · {d.updatedLabel}
                    </span>
                  </span>
                  <span className="off-ws-doc-fmt">{d.format}</span>
                </button>
              ))}
            </div>
          ))}
          {filtered.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No docs"
              description="Nothing matches your filter."
            />
          ) : null}
        </div>
      </div>

      <div className="off-ws-detail off-ws-doc-view">
        {active ? (
          <>
            <div className="off-ws-doc-view-h">
              <div className="off-ws-doc-view-headrow">
                <div className="off-ws-doc-view-id">
                  <div className="off-ws-doc-view-title">{active.title}</div>
                  <div className="off-ws-doc-view-meta">
                    <span className="off-ws-dlv-stack">
                      {active.contributorIds.slice(0, 3).map((id) => {
                        const e = byId.get(id);
                        if (!e) return null;
                        return (
                          <EmployeeAvatar
                            key={id}
                            seed={e.id}
                            appearance={e.appearance}
                            colorA={e.avatarA}
                            colorB={e.avatarB}
                            size={18}
                            brand={e.kind === 'external'}
                            className="off-ws-dlv-av"
                          />
                        );
                      })}
                      {active.contributorIds.length > 3 ? (
                        <span className="off-ws-dlv-more">+{active.contributorIds.length - 3}</span>
                      ) : null}
                    </span>
                    <span>
                      {active.contributorIds.length} contributor
                      {active.contributorIds.length === 1 ? '' : 's'} · {active.sizeLabel} ·
                      produced in <b>{active.sourceThread}</b> · {active.updatedLabel}
                    </span>
                  </div>
                </div>
                <div className="off-ws-doc-view-actions">
                  <button
                    type="button"
                    className="off-ws-dlv-btn off-focusable"
                    onClick={() => toast.success('Copied to clipboard')}
                  >
                    Copy
                  </button>
                  <span className="off-ws-dlv-fmt">
                    {active.format}
                    <Icon icon={ChevronDown} size="sm" />
                  </span>
                  <button
                    type="button"
                    className="off-ws-dlv-btn off-focusable"
                    onClick={() => toast.success(`Exported as ${active.format}`)}
                  >
                    <Icon icon={Download} size="sm" />
                    Export
                  </button>
                  {active.contributorIds.length >= 2 ? (
                    <button
                      type="button"
                      className="off-ws-dlv-btn is-sop off-focusable"
                      title="Promoted when ≥2 contributors"
                      onClick={() => toast.success('Saved as SOP')}
                    >
                      <Icon icon={Activity} size="sm" />
                      Save as SOP
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="off-ws-doc-view-body">
              {active.body ? (
                <div className="off-ws-doc-paper">
                  <h1>{active.body.h1}</h1>
                  {active.body.sections.map((sec, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static rendered sections
                    <div key={i}>
                      {sec.h2 ? <h2>{sec.h2}</h2> : null}
                      {sec.p ? <p>{sec.p}</p> : null}
                      {sec.bullets ? (
                        <ul>
                          {sec.bullets.map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="off-ws-doc-paper is-file">
                  <h1>{active.title}</h1>
                  <p>
                    {active.format} file · {active.sizeLabel}. Binary artifacts open in their
                    associated app — use Export to download a copy.
                  </p>
                </div>
              )}
            </div>
          </>
        ) : (
          <EmptyState icon={FileText} title="No document" description="Pick a doc to preview." />
        )}
      </div>
    </>
  );
}
