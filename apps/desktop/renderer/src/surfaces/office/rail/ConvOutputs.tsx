import { useUiState } from '@/app/ui-state.js';
import { isTauriRuntime } from '@/data/adapters.js';
import { useProjects } from '@/data/queries.js';
import type { Deliverable, Employee } from '@/data/types.js';
import { EmployeeAvatar } from '@/design-system/grammar/EmployeeAvatar.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/design-system/primitives/popover.js';
import { safeErrorMessage } from '@/lib/provider-bridge.js';
import { cn } from '@/lib/utils.js';
import { ChevronDown, Copy, FileCode2, FolderOpen, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
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
  const faces = ids.slice(0, MAX_FACES);
  const overflow = ids.length - faces.length;
  return (
    <span className="off-dlv-contributors">
      {faces.map((id) => {
        const e = employeesById.get(id);
        if (!e) return null;
        return (
          <EmployeeAvatar
            key={id}
            seed={e.id}
            appearance={e.appearance}
            colorA={e.avatarA}
            colorB={e.avatarB}
            size={20}
            brand={e.kind === 'external'}
          />
        );
      })}
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
  const [open, setOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<'save' | 'open' | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  // The card persists across in-place deliverable updates (keyed by id), so a
  // cached savedPath can outlive the content it points at — drop it when the
  // body or name changes so Open re-saves the current output, not a stale file.
  // biome-ignore lint/correctness/useExhaustiveDependencies: preview/name are intentional reset triggers, not values read in the effect body.
  useEffect(() => {
    setSavedPath(null);
  }, [deliverable.preview, deliverable.name]);
  const format = deliverable.format?.trim().toUpperCase() ?? 'TXT';
  const extension = TEXT_OUTPUT_EXTENSIONS[format] ?? null;
  const exportableBody = extension && deliverable.preview?.trim() ? deliverable.preview : null;
  const disabledReason = !isTauriRuntime()
    ? 'Local output actions require the desktop runtime'
    : !projectId || !workspaceBound
      ? 'Bind a project workspace folder to save outputs'
      : !exportableBody
        ? 'This output has no text-backed local artifact body'
        : null;

  function outputFileName() {
    const cleanName = deliverable.name.trim() || deliverable.id;
    if (cleanName.toLowerCase().endsWith(`.${extension}`)) return cleanName;
    return `${cleanName}.${extension}`;
  }

  async function copyPreview() {
    if (!deliverable.preview?.trim()) {
      toast.error('No output body to copy');
      return;
    }
    try {
      await navigator.clipboard.writeText(deliverable.preview);
      toast.success('Copied output');
    } catch (error) {
      toast.error('Copy output failed', { description: safeErrorMessage(error) });
    }
  }

  async function persistOutput(action: 'save' | 'open') {
    if (disabledReason || !projectId || !exportableBody) {
      toast.error(disabledReason ?? 'Output is not ready');
      return;
    }
    setBusyAction(action);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const relativePath =
        action === 'open' && savedPath
          ? savedPath
          : await invoke<string>('save_deliverable_to_local', {
              projectId,
              fileName: outputFileName(),
              content: exportableBody,
            });
      setSavedPath(relativePath);
      if (action === 'open') {
        await invoke('open_local_path', { projectId, path: relativePath });
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
        onClick={() => setOpen((v) => !v)}
      >
        <Icon icon={FileCode2} size="sm" className="off-dlv-icon" />
        <span className="off-dlv-name">{deliverable.name}</span>
        {deliverable.format ? <span className="off-dlv-fmt">{deliverable.format}</span> : null}
        <Contributors ids={deliverable.contributorIds} employeesById={employeesById} />
        <Icon icon={ChevronDown} size="sm" className="off-dlv-caret" />
      </button>
      {open ? (
        <div className="off-dlv-body">
          {deliverable.preview ? (
            <pre className="off-dlv-preview">{deliverable.preview}</pre>
          ) : null}
          <div className="off-dlv-actions">
            <IconButton
              icon={Copy}
              label="Copy output body"
              variant="subtle"
              size="iconSm"
              disabled={!deliverable.preview?.trim()}
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
            <span className="off-dlv-export is-static">Format · {format}</span>
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
            <span className="off-rail-sec-note">Runtime artifacts</span>
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
