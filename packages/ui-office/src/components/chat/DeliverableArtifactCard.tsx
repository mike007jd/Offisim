import { Button } from '@offisim/ui-core';
import { useCallback, useState } from 'react';
import type { DeliverableArtifact } from '../../lib/deliverable-artifacts';
import { canPreviewDeliverable } from '../../lib/deliverable-artifacts';

interface DeliverableArtifactCardProps {
  artifact: DeliverableArtifact;
  employeeLabel?: string | null;
}

function triggerDownload(content: string, fileName: string, mimeType: string | null): void {
  const blob = new Blob([content], { type: `${mimeType ?? 'text/plain'};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function openArtifactInNewTab(content: string, mimeType: string | null): void {
  const url = URL.createObjectURL(
    new Blob([content], { type: `${mimeType ?? 'text/plain'};charset=utf-8` }),
  );
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function DeliverableArtifactCard({ artifact, employeeLabel }: DeliverableArtifactCardProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const fileName = artifact.fileName ?? 'deliverable.txt';
  const canOpen = canPreviewDeliverable(artifact);

  const handleCopy = useCallback(async () => {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(artifact.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 2000);
    }
  }, [artifact.content]);

  const handleOpen = useCallback(() => {
    if (!canOpen) return;
    openArtifactInNewTab(artifact.content, artifact.mimeType);
  }, [artifact.content, artifact.mimeType, canOpen]);

  const handleDownload = useCallback(() => {
    triggerDownload(artifact.content, fileName, artifact.mimeType);
  }, [artifact.content, artifact.mimeType, fileName]);

  const copyLabel = copyFailed ? 'Copy failed' : copied ? 'Copied!' : 'Copy';

  return (
    <div className="mt-2 max-w-[94%] rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center rounded bg-emerald-500/15 px-1.5 py-px text-[10px] font-medium text-emerald-200">
          {fileName}
        </span>
        {artifact.mimeType && (
          <span className="text-[10px] text-slate-400">{artifact.mimeType}</span>
        )}
        {employeeLabel && <span className="text-[10px] text-slate-500">· {employeeLabel}</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px] text-slate-300 hover:text-pearl"
          onClick={handleCopy}
        >
          {copyLabel}
        </Button>
        {canOpen && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-slate-300 hover:text-pearl"
            onClick={handleOpen}
          >
            Open
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px] text-slate-300 hover:text-pearl"
          onClick={handleDownload}
        >
          Download
        </Button>
      </div>
    </div>
  );
}
