import type { ChatAttachment } from '@/data/types.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/design-system/primitives/popover.js';
import { invokeCommand } from '@/lib/tauri-commands.js';
import { bytesToBase64, parseAttachment } from '@offisim/doc-engine';
import type { ParsedAttachment } from '@offisim/shared-types';
import { FileText, Image as ImageIcon } from 'lucide-react';
import { useState } from 'react';

const PREVIEW_TEXT_MAX_CHARS = 12_000;

function parsedPreviewText(parsed: ParsedAttachment): string | null {
  switch (parsed.kind) {
    case 'text':
    case 'docx':
    case 'pptx':
      return parsed.text;
    case 'pdf':
      return parsed.text;
    case 'xlsx':
      return parsed.sheets
        .map((sheet) => `# ${sheet.name}\n${sheet.csv}`)
        .join('\n\n');
    case 'image':
    case 'binary':
    case 'unsupported':
      return null;
  }
}

export function AttachmentPreviewChip({ attachment }: { attachment: ChatAttachment }) {
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadPreview() {
    if (loading || imageUrl !== null || text !== null || error !== null) return;
    if (!attachment.vaultRef) {
      setError('Preview is unavailable because this attachment has no durable vault reference.');
      return;
    }
    setLoading(true);
    try {
      const payload = await invokeCommand('attachment_read', {
        vaultRef: attachment.vaultRef,
        maxBytes: attachment.byteLength ?? undefined,
      });
      const bytes = new Uint8Array(payload.bytes);
      const mimeType = attachment.mimeType ?? payload.meta.mimeType;
      if (mimeType.startsWith('image/')) {
        setImageUrl(`data:${mimeType};base64,${bytesToBase64(bytes)}`);
        return;
      }
      const parsed = await parseAttachment(bytes, mimeType, attachment.name);
      const body = parsedPreviewText(parsed)?.trim();
      if (!body) {
        setError('This attachment does not have a readable preview.');
        return;
      }
      setText(
        body.length > PREVIEW_TEXT_MAX_CHARS
          ? `${body.slice(0, PREVIEW_TEXT_MAX_CHARS)}\n\n[Preview truncated]`
          : body,
      );
    } catch {
      setError('This attachment could not be loaded from the secure vault.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Popover
      open={opened}
      onOpenChange={(next) => {
        setOpened(next);
        if (next) void loadPreview();
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="off-attachment off-focusable">
          <span className="off-att-icon">
            <Icon icon={attachment.kind === 'image' ? ImageIcon : FileText} size="sm" />
          </span>
          <span className="off-att-text">
            <span className="off-att-name">{attachment.name}</span>
            <span className="off-att-meta">
              {attachment.ext ? <span className="off-fmt-tag">{attachment.ext}</span> : null}
              {[attachment.sizeLabel, attachment.summary].filter(Boolean).join(' · ')}
            </span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="off-attachment-preview" align="start" side="right">
        <div className="off-attachment-preview-head">
          <strong>{attachment.name}</strong>
          <span>{attachment.mimeType ?? 'Unknown file type'}</span>
        </div>
        {loading ? <p className="off-attachment-preview-state">Loading preview…</p> : null}
        {imageUrl ? <img src={imageUrl} alt={attachment.name} /> : null}
        {text ? <pre>{text}</pre> : null}
        {error ? <p className="off-attachment-preview-state">{error}</p> : null}
      </PopoverContent>
    </Popover>
  );
}
