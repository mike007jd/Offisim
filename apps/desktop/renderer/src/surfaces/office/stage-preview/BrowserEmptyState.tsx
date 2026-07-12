import { useUiState } from '@/app/ui-state.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Copy, Globe2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { StageEmpty } from './StageEmpty.js';

function normalizePreviewUrl(value: string): URL | null {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    return new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(candidate) ? candidate : `http://${candidate}`);
  } catch {
    return null;
  }
}

function isCspEmbeddable(url: URL): boolean {
  if (url.protocol === 'http:') {
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  }
  return url.protocol === 'https:' && url.hostname === 'localhost';
}

export function BrowserEmptyState({ sourceId }: { sourceId: string }) {
  const openStageView = useUiState((state) => state.openStageView);
  const [value, setValue] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [copyUrl, setCopyUrl] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = normalizePreviewUrl(value);
    if (!url) {
      setCopyUrl(null);
      setNotice('Enter a valid local URL, for example http://localhost:5173.');
      return;
    }
    if (!isCspEmbeddable(url)) {
      setCopyUrl(url.toString());
      setNotice(
        'Release previews can embed only localhost or 127.0.0.1. Copy this URL to open it in a browser.',
      );
      return;
    }
    setNotice(null);
    setCopyUrl(null);
    openStageView({
      kind: 'preview',
      ref: { source: 'browser', sourceId, url: url.toString() },
      title: url.host,
    });
  };

  const action = (
    <div className="off-browser-empty-actions">
      <form className="off-browser-empty-form" onSubmit={submit}>
        <label htmlFor="off-browser-preview-url">Local preview URL</label>
        <div>
          <input
            id="off-browser-preview-url"
            type="url"
            inputMode="url"
            value={value}
            placeholder="http://localhost:5173"
            onChange={(event) => {
              setValue(event.target.value);
              setNotice(null);
              setCopyUrl(null);
            }}
          />
          <button type="submit" className="off-focusable">
            Go
          </button>
        </div>
      </form>
      {notice ? <output>{notice}</output> : null}
      {copyUrl ? (
        <button
          type="button"
          className="off-browser-copy-url off-focusable"
          onClick={() =>
            void navigator.clipboard.writeText(copyUrl).then(() => toast.success('URL copied'))
          }
        >
          <Icon icon={Copy} size="sm" />
          Copy URL
        </button>
      ) : null}
    </div>
  );

  return (
    <StageEmpty
      icon={Globe2}
      title="Open a browser preview"
      detail="Preview a local dev server by URL. Agent browsing sessions appear here automatically."
      action={action}
    />
  );
}
