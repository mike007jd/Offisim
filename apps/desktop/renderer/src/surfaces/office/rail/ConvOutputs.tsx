import { useUiState } from '@/app/ui-state.js';
import { isTauriRuntime } from '@/data/adapters.js';
import { loadDeliverableBody, useProjects } from '@/data/queries.js';
import type { Deliverable, Employee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/design-system/primitives/popover.js';
import { safeErrorMessage } from '@/lib/error-message.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import { cn } from '@/lib/utils.js';
import { ChevronDown, Copy, FileCode2, FolderOpen, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

const MAX_FACES = 3;
const TEXT_OUTPUT_EXTENSIONS: Record<string, string> = {
  TS: 'ts',
  JS: 'js',
  JSX: 'jsx',
  TSX: 'tsx',
  MD: 'md',
  TXT: 'txt',
  CSV: 'csv',
  JSON: 'json',
  HTML: 'html',
  PY: 'py',
  YAML: 'yaml',
  YML: 'yml',
  XML: 'xml',
  SH: 'sh',
  CSS: 'css',
  SCSS: 'scss',
  SQL: 'sql',
  GO: 'go',
  RS: 'rs',
  JAVA: 'java',
  RB: 'rb',
  TOML: 'toml',
  INI: 'ini',
  LOG: 'log',
  CONF: 'conf',
  SVG: 'svg',
};

interface ConvOutputsProps {
  deliverables: Deliverable[];
  employeesById: Map<string, Employee>;
}

function Contributors({
  ids,
  employeesById,
}: {
  ids: string[];
  employeesById: Map<string, Employee>;
}) {
  const resolved = ids.map((id) => employeesById.get(id)).filter((e): e is Employee => Boolean(e));
  const faces = resolved.slice(0, MAX_FACES);
  const overflow = resolved.length - faces.length;
  return (
    <span className="off-dlv-contributors">
      {faces.map((e) => (
        <EmployeeAvatar
          key={e.id}
          seed={e.id}
          appearance={e.appearance}
          colorA={e.avatarA}
          colorB={e.avatarB}
          size={20}
          brand={e.kind === 'external'}
        />
      ))}
      {overflow > 0 ? <span className="off-dlv-more">+{overflow}</span> : null}
    </span>
  );
}

function DeliverableCard({
  deliverable,
  employeesById,
  projectId,
  workspaceBound,
}: {
  deliverable: Deliverable;
  employeesById: Map<string, Employee>;
  projectId: string | null;
  workspaceBound: boolean;
}) {
  const openStageView = useUiState((s) => s.openStageView);
  // J1 provenance: who produced it (first contributor) and which run it came
  // from, so an output explains why it exists and where it originated.
  const producerName = deliverable.contributorIds[0]
    ? (employeesById.get(deliverable.contributorIds[0])?.name ?? null)
    : null;
  const provenance = [
    producerName ? `By ${producerName}` : null,
    deliverable.kind,
    deliverable.runId ? `run ${deliverable.runId.slice(0, 8)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const [open, setOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<'save' | 'open' | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(deliverable.preview ?? null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const deliverableReset = useMemo(
    () => ({
      body: deliverable.preview ?? null,
      key: `${deliverable.id}\u0000${deliverable.name}\u0000${deliverable.preview ?? ''}`,
    }),
    [deliverable.id, deliverable.name, deliverable.preview],
  );
  // The card persists across in-place deliverable updates (keyed by id), so a
  // cached savedPath/body can outlive the row they point at — drop it when the
  // identity or content changes so Open re-saves the current output.
  useEffect(() => {
    setSavedPath(null);
    setBody(deliverableReset.body);
  }, [deliverableReset]);
  const format = deliverable.format?.trim().toUpperCase() ?? 'TXT';
  const extension = TEXT_OUTPUT_EXTENSIONS[format] ?? null;
  const outputBody = body ?? deliverable.preview ?? '';
  const hasOutputBody = Boolean(outputBody.trim()) || (deliverable.contentSize ?? 0) > 0;
  const disabledReason = !isTauriRuntime()
    ? 'Saving needs the desktop app'
    : !projectId || !workspaceBound
      ? 'Bind a workspace folder first'
      : !extension
        ? 'Unsupported text format'
        : !hasOutputBody
          ? 'No text to save'
          : null;

  function outputFileName() {
    const cleanName = deliverable.name.trim() || deliverable.id;
    if (cleanName.toLowerCase().endsWith(`.${extension}`)) return cleanName;
    return `${cleanName}.${extension}`;
  }

  async function ensureOutputBody() {
    if (body !== null) return body;
    setBodyLoading(true);
    try {
      const nextBody = await loadDeliverableBody(deliverable);
      setBody(nextBody);
      return nextBody;
    } catch (error) {
      toast.error('Load output failed', { description: safeErrorMessage(error) });
      return '';
    } finally {
      setBodyLoading(false);
    }
  }

  async function copyPreview() {
    const nextBody = await ensureOutputBody();
    if (!nextBody.trim()) {
      toast.error('No output body to copy');
      return;
    }
    try {
      await navigator.clipboard.writeText(nextBody);
      toast.success('Copied output');
    } catch (error) {
      toast.error('Copy output failed', { description: safeErrorMessage(error) });
    }
  }

  async function persistOutput(action: 'save' | 'open') {
    if (disabledReason || !projectId || !extension) {
      toast.error(disabledReason ?? 'Output is not ready');
      return;
    }
    setBusyAction(action);
    try {
      const exportableBody = await ensureOutputBody();
      if (!exportableBody.trim()) {
        toast.error('No text to save');
        return;
      }
      const relativePath =
        action === 'open' && savedPath
          ? savedPath
          : await invokeCommand('save_deliverable_to_local', {
              projectId,
              fileName: outputFileName(),
              content: exportableBody,
            });
      setSavedPath(relativePath);
      if (action === 'open') {
        await invokeCommand('open_local_path', { projectId, path: relativePath });
        toast.success('Opened output', { description: relativePath });
      } else {
        toast.success('Saved output', { description: relativePath });
      }
    } catch (error) {
      toast.error(action === 'open' ? 'Open output failed' : 'Save output failed', {
        description: safeErrorMessage(error),
      });
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className={cn('off-dlv', open && 'is-open')}>
      <button
        type="button"
        className="off-dlv-head off-focusable"
        onClick={() => {
          const nextOpen = !open;
          setOpen(nextOpen);
          if (nextOpen) void ensureOutputBody();
          openStageView({
            kind: 'preview',
            ref: {
              source: 'deliverable',
              deliverableId: deliverable.id,
              threadId: deliverable.threadId ?? null,
              format: deliverable.format ?? undefined,
              name: deliverable.name,
            },
            title: deliverable.name,
          });
        }}
      >
        <Icon icon={FileCode2} size="sm" className="off-dlv-icon" />
        <span className="off-dlv-name">{deliverable.name}</span>
        {deliverable.format ? <span className="off-fmt-tag">{deliverable.format}</span> : null}
        <Contributors ids={deliverable.contributorIds} employeesById={employeesById} />
        <Icon icon={ChevronDown} size="sm" className="off-dlv-caret" />
      </button>
      {open ? (
        <div className="off-dlv-body">
          {provenance ? <div className="off-dlv-provenance">{provenance}</div> : null}
          <pre className="off-dlv-preview">
            {bodyLoading ? 'Loading output…' : outputBody || 'No output body.'}
          </pre>
          <div className="off-dlv-actions">
            <IconButton
              icon={Copy}
              label="Copy output body"
              variant="subtle"
              size="iconSm"
              disabled={bodyLoading || !hasOutputBody}
              onClick={() => void copyPreview()}
            />
            <IconButton
              icon={Save}
              label={busyAction === 'save' ? 'Saving output' : 'Save locally'}
              variant="subtle"
              size="iconSm"
              disabled={Boolean(disabledReason) || busyAction !== null}
              title={disabledReason ?? undefined}
              onClick={() => void persistOutput('save')}
            />
            <IconButton
              icon={FolderOpen}
              label={busyAction === 'open' ? 'Opening output' : 'Open local output'}
              variant="subtle"
              size="iconSm"
              disabled={Boolean(disabledReason) || busyAction !== null}
              title={disabledReason ?? undefined}
              onClick={() => void persistOutput('open')}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ConvOutputs({ deliverables, employeesById }: ConvOutputsProps) {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const projects = useProjects(companyId);
  const activeProject = projects.data?.find((p) => p.id === projectId) ?? null;
  const workspaceBound = Boolean(activeProject?.workspaceRoot);

  if (deliverables.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="off-thread-pit off-focusable">
          <Icon icon={FileCode2} size="sm" />
          Outputs
          <span className="off-thread-pit-count">{deliverables.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="off-thread-pit-pop" align="start">
        <section className="off-conv-outputs">
          <div className="off-rail-sec-head">
            Outputs
            <span className="off-rail-sec-count">{deliverables.length}</span>
          </div>
          {deliverables.map((deliverable) => (
            <DeliverableCard
              key={deliverable.id}
              deliverable={deliverable}
              employeesById={employeesById}
              projectId={projectId}
              workspaceBound={workspaceBound}
            />
          ))}
        </section>
      </PopoverContent>
    </Popover>
  );
}
