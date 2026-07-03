import { useUiState, type StageViewTarget } from '@/app/ui-state.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import {
  formatByteSize,
  viewerKindLabel,
  type ResolvedPreviewTarget,
} from '@/surfaces/office/stage-preview/preview-target.js';
import { Copy, ExternalLink, FolderOpen } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useSetStageChrome } from '@/surfaces/office/stage-viewer/stage-chrome.js';
import {
  type PreviewData,
  loadPreview,
} from './preview-data.js';
import { UnsupportedViewer } from './viewers/UnsupportedViewer.js';

const TextViewer = lazy(() =>
  import('./viewers/TextViewer.js').then((module) => ({ default: module.TextViewer })),
);
const StructuredTextViewer = lazy(() =>
  import('./viewers/StructuredTextViewer.js').then((module) => ({
    default: module.StructuredTextViewer,
  })),
);
const MarkdownViewer = lazy(() =>
  import('./viewers/MarkdownViewer.js').then((module) => ({ default: module.MarkdownViewer })),
);
const ImageViewer = lazy(() =>
  import('./viewers/ImageViewer.js').then((module) => ({ default: module.ImageViewer })),
);
const CsvViewer = lazy(() =>
  import('./viewers/CsvViewer.js').then((module) => ({ default: module.CsvViewer })),
);
const HtmlViewer = lazy(() =>
  import('./viewers/HtmlViewer.js').then((module) => ({ default: module.HtmlViewer })),
);
const PdfViewer = lazy(() =>
  import('./viewers/PdfViewer.js').then((module) => ({ default: module.PdfViewer })),
);
const DocViewer = lazy(() =>
  import('./viewers/DocViewer.js').then((module) => ({ default: module.DocViewer })),
);
const SheetViewer = lazy(() =>
  import('./viewers/SheetViewer.js').then((module) => ({ default: module.SheetViewer })),
);
const SlidesViewer = lazy(() =>
  import('./viewers/SlidesViewer.js').then((module) => ({ default: module.SlidesViewer })),
);
const MediaViewer = lazy(() =>
  import('./viewers/MediaViewer.js').then((module) => ({ default: module.MediaViewer })),
);
const ModelViewer = lazy(() =>
  import('./viewers/ModelViewer.js').then((module) => ({ default: module.ModelViewer })),
);

type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; resolved: ResolvedPreviewTarget; data: PreviewData };

function pathForTarget(target: Extract<StageViewTarget, { kind: 'preview' }>): string | null {
  switch (target.ref.source) {
    case 'workspace-file':
    case 'computer-artifact':
      return target.ref.path;
    default:
      return null;
  }
}

function urlForResolved(resolved: ResolvedPreviewTarget, data: PreviewData): string | null {
  if (data.mode === 'url') return data.url;
  return resolved.meta.url ?? null;
}

const TRUST_BADGES: Partial<Record<ResolvedPreviewTarget['trustLevel'], string>> = {
  generated: 'AI output',
  external: 'External',
  computer: 'Computer Use',
};

async function invokePathCommand(
  command: 'open_local_path' | 'reveal_local_path',
  projectId: string | null,
  path: string,
): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke(command, { projectId, path });
}

async function copyValue(value: string, label: string) {
  await navigator.clipboard.writeText(value);
  toast.success(`${label} copied`);
}

function ViewerDispatch({ resolved, data }: { resolved: ResolvedPreviewTarget; data: PreviewData }) {
  if (data.mode === 'none') return <UnsupportedViewer resolved={resolved} data={data} />;
  if (data.mode === 'text') {
    if (resolved.viewerKind === 'markdown') {
      return <MarkdownViewer text={data.text} truncated={data.truncated} />;
    }
    if (resolved.viewerKind === 'json' || resolved.viewerKind === 'structured-text') {
      return <StructuredTextViewer text={data.text} resolved={resolved} truncated={data.truncated} />;
    }
    if (resolved.viewerKind === 'csv') {
      return <CsvViewer text={data.text} truncated={data.truncated} />;
    }
    return <TextViewer text={data.text} truncated={data.truncated} />;
  }
  if (data.mode === 'inline-html' || data.mode === 'url' || data.mode === 'screenshot') {
    return <HtmlViewer resolved={resolved} data={data} />;
  }
  if (data.mode === 'bytes' && resolved.viewerKind === 'image') {
    return <ImageViewer resolved={resolved} data={data} />;
  }
  if (data.mode === 'bytes' && resolved.viewerKind === 'pdf') {
    return <PdfViewer resolved={resolved} data={data} />;
  }
  if (data.mode === 'bytes' && resolved.viewerKind === 'doc') {
    return <DocViewer resolved={resolved} data={data} />;
  }
  if (data.mode === 'bytes' && resolved.viewerKind === 'spreadsheet') {
    return <SheetViewer resolved={resolved} data={data} />;
  }
  if (data.mode === 'bytes' && resolved.viewerKind === 'slides') {
    return <SlidesViewer resolved={resolved} data={data} />;
  }
  if (data.mode === 'stream' && (resolved.viewerKind === 'video' || resolved.viewerKind === 'audio')) {
    return <MediaViewer resolved={resolved} data={data} />;
  }
  if (data.mode === 'bytes' && resolved.viewerKind === 'model3d') {
    return <ModelViewer resolved={resolved} data={data} />;
  }
  return <UnsupportedViewer resolved={resolved} data={data} />;
}

export function StagePreviewPane({
  target,
}: {
  target: Extract<StageViewTarget, { kind: 'preview' }>;
}) {
  const projectId = useUiState((s) => s.projectId);
  const [state, setState] = useState<PreviewState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: 'loading' });
    void loadPreview(target.ref, projectId)
      .then((result) => {
        if (result.data.mode === 'bytes') objectUrl = result.data.objectUrl;
        if (cancelled) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          return;
        }
        setState({ status: 'ready', ...result });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Preview failed.',
        });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, target.ref]);

  const resolved = state.status === 'ready' ? state.resolved : null;
  const data = state.status === 'ready' ? state.data : null;
  const path = pathForTarget(target);
  const url = resolved && data ? urlForResolved(resolved, data) : null;
  const title = resolved?.meta.title ?? target.title ?? 'Preview';
  const meta = useMemo(() => {
    if (!resolved) return null;
    const kindLabel = viewerKindLabel(resolved.viewerKind);
    const extension = resolved.meta.extension?.toUpperCase();
    return [
      kindLabel,
      extension && !kindLabel.toUpperCase().includes(extension) ? extension : null,
      resolved.meta.byteLength != null ? formatByteSize(resolved.meta.byteLength) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }, [resolved]);
  const trustBadge = resolved ? TRUST_BADGES[resolved.trustLevel] : null;
  const setChrome = useSetStageChrome();

  useEffect(() => {
    setChrome({
      title,
      meta: meta ?? (state.status === 'loading' ? 'Loading…' : undefined),
      badge: trustBadge ?? undefined,
      // A failed preview must not offer copy/reveal/open actions for content
      // that did not load; keep the title so the user still knows what failed.
      actions:
        state.status !== 'error' && (path || url) ? (
          <>
            {path ? (
              <>
                <button type="button" onClick={() => void copyValue(path, 'Path')}>
                  <Icon icon={Copy} size="sm" />
                  <span>Path</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void invokePathCommand('reveal_local_path', projectId, path).catch((error) =>
                      toast.error(error instanceof Error ? error.message : 'Reveal failed'),
                    )
                  }
                >
                  <Icon icon={FolderOpen} size="sm" />
                  <span>Reveal</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void invokePathCommand('open_local_path', projectId, path).catch((error) =>
                      toast.error(error instanceof Error ? error.message : 'Open failed'),
                    )
                  }
                >
                  <Icon icon={ExternalLink} size="sm" />
                  <span>Open</span>
                </button>
              </>
            ) : null}
            {url ? (
              <button type="button" onClick={() => void copyValue(url, 'URL')}>
                <Icon icon={Copy} size="sm" />
                <span>URL</span>
              </button>
            ) : null}
          </>
        ) : undefined,
    });
  }, [meta, path, projectId, setChrome, state.status, title, trustBadge, url]);

  useEffect(() => () => setChrome(null), [setChrome]);

  return (
    <div className="off-preview-pane">
      <div
        className={cn(
          'off-preview-body',
          state.status === 'loading' && 'is-loading',
          state.status === 'error' && 'is-error',
        )}
      >
        {state.status === 'loading' ? (
          <div className="off-stage-empty">
            <strong>Loading preview</strong>
            <span>Reading metadata and selecting the viewer.</span>
          </div>
        ) : null}
        {state.status === 'error' ? (
          <div className="off-stage-empty">
            <strong>Preview failed</strong>
            <span>{state.message}</span>
          </div>
        ) : null}
        {state.status === 'ready' ? (
          <Suspense
            fallback={
              <div className="off-stage-empty">
                <strong>Loading viewer</strong>
                <span>Preparing the preview surface.</span>
              </div>
            }
          >
            <ViewerDispatch resolved={state.resolved} data={state.data} />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}
