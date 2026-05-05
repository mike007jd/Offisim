import type { AttachmentKind } from '@offisim/shared-types';
import { FileSpreadsheet, FileText, Image, Paperclip, Presentation } from 'lucide-react';

/** Kind → lucide icon component map. Shared by Staged + Sent chips. */
export const ATTACHMENT_KIND_ICONS: Record<AttachmentKind, typeof FileText> = {
  pdf: FileText,
  docx: FileText,
  xlsx: FileSpreadsheet,
  pptx: Presentation,
  image: Image,
  document: FileText,
  code: FileText,
  data: FileSpreadsheet,
  other: Paperclip,
};

export function formatAttachmentBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
