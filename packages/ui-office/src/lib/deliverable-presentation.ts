import {
  File,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  type LucideIcon,
} from 'lucide-react';

export function mimeTypeToIcon(mime: string | null): LucideIcon {
  if (!mime) return File;
  if (mime.startsWith('image/')) return FileImage;
  switch (mime) {
    case 'text/html':
    case 'text/javascript':
    case 'text/typescript':
    case 'text/css':
    case 'text/yaml':
    case 'application/xml':
    case 'application/javascript':
      return FileCode;
    case 'application/json':
      return FileJson;
    case 'text/markdown':
    case 'text/plain':
      return FileText;
    case 'text/csv':
      return FileSpreadsheet;
    default:
      return File;
  }
}

export function formatDeliverableBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.floor(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

export function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
