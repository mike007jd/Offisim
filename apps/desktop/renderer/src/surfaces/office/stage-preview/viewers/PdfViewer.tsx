import { Icon } from '@/design-system/icons/Icon.js';
import { parseAttachment, resolvePdfWorkerSrc } from '@offisim/doc-engine';
import { ChevronDown, ChevronUp, Search, ZoomIn, ZoomOut } from 'lucide-react';
import {
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFPageProxy,
  getDocument,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PreviewData } from '../preview-data.js';
import type { ResolvedPreviewTarget } from '../preview-target.js';
import { UnsupportedViewer } from './UnsupportedViewer.js';

const workerSrc = resolvePdfWorkerSrc();
if (workerSrc) GlobalWorkerOptions.workerSrc = workerSrc;

type PdfState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; doc: PDFDocumentProxy; pages: readonly number[] };

function PdfCanvasPage({
  doc,
  pageNumber,
  scale,
  active,
  pageRef,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  active: boolean;
  pageRef: (node: HTMLDivElement | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [visible, setVisible] = useState(pageNumber <= 2);

  useEffect(() => {
    if (visible) return undefined;
    const root = rootRef.current;
    if (!root) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: '800px' },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    let cancelled = false;
    let page: PDFPageProxy | null = null;
    let renderTask: ReturnType<PDFPageProxy['render']> | null = null;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    void doc.getPage(pageNumber).then((nextPage) => {
      if (cancelled) {
        nextPage.cleanup();
        return;
      }
      page = nextPage;
      const viewport = nextPage.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(viewport.width * dpr));
      canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      setSize({ width: viewport.width, height: viewport.height });
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderTask = nextPage.render({ canvasContext: context, viewport });
      void renderTask.promise.catch(() => undefined);
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      page?.cleanup();
    };
  }, [doc, pageNumber, scale, visible]);

  return (
    <div
      ref={(node) => {
        rootRef.current = node;
        pageRef(node);
      }}
      className={`off-pdf-page${active ? ' is-active' : ''}`}
    >
      <div className="off-pdf-page-meta">
        <span>Page {pageNumber}</span>
        {size ? (
          <span>
            {Math.round(size.width)} x {Math.round(size.height)}
          </span>
        ) : null}
      </div>
      <canvas ref={canvasRef} style={size ? undefined : { minWidth: 320, minHeight: 420 }} />
    </div>
  );
}

export function PdfViewer({
  resolved,
  data,
}: {
  resolved: ResolvedPreviewTarget;
  data: Extract<PreviewData, { mode: 'bytes' }>;
}) {
  const [state, setState] = useState<PdfState>({ status: 'loading' });
  const [scale, setScale] = useState(1);
  const [query, setQuery] = useState('');
  const [parsedPages, setParsedPages] = useState<readonly string[] | null>(null);
  const [activeHit, setActiveHit] = useState(0);
  const pageRefs = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    let cancelled = false;
    let loadedDoc: PDFDocumentProxy | null = null;
    setState({ status: 'loading' });
    const loadingTask = getDocument({
      data: new Uint8Array(data.bytes),
      isEvalSupported: false,
      standardFontDataUrl: '/pdfjs-standard-fonts/',
    });
    void loadingTask.promise
      .then((doc) => {
        if (cancelled) {
          void doc.destroy();
          return;
        }
        loadedDoc = doc;
        setState({
          status: 'ready',
          doc,
          pages: Array.from({ length: doc.numPages }, (_, index) => index + 1),
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
      void loadingTask.destroy().catch(() => undefined);
      void loadedDoc?.destroy().catch(() => undefined);
    };
  }, [data.bytes]);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized || parsedPages) return;
    const controller = new AbortController();
    void parseAttachment(
      new Uint8Array(data.bytes),
      resolved.meta.mimeType ?? 'application/pdf',
      resolved.meta.title,
      controller.signal,
    ).then((parsed) => {
      if (parsed.kind === 'pdf') setParsedPages(parsed.pages);
      else setParsedPages([]);
    });
    return () => controller.abort();
  }, [data.bytes, parsedPages, query, resolved.meta.mimeType, resolved.meta.title]);

  const hits = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized || !parsedPages) return [];
    return parsedPages.reduce<number[]>((acc, text, index) => {
      if (text.toLowerCase().includes(normalized)) acc.push(index + 1);
      return acc;
    }, []);
  }, [parsedPages, query]);

  function jump(delta: number) {
    if (hits.length === 0) return;
    const next = (activeHit + delta + hits.length) % hits.length;
    setActiveHit(next);
    pageRefs.current.get(hits[next] ?? 1)?.scrollIntoView({ block: 'center' });
  }

  if (state.status === 'loading') {
    return (
      <div className="off-stage-empty">
        <strong>Loading PDF</strong>
        <span>Preparing pages and worker-backed rendering.</span>
      </div>
    );
  }
  if (state.status === 'error') {
    return <UnsupportedViewer resolved={resolved} data={{ mode: 'none', reason: state.message }} />;
  }

  const activePage = hits[activeHit] ?? null;

  return (
    <div className="off-pdf-viewer">
      <div className="off-preview-text-tools">
        <span>{state.pages.length.toLocaleString()} pages</span>
        <label className="off-preview-search">
          <Icon icon={Search} size="sm" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveHit(0);
            }}
            placeholder="Search text"
          />
        </label>
        <button type="button" disabled={hits.length === 0} onClick={() => jump(-1)}>
          <Icon icon={ChevronUp} size="sm" />
          Prev
        </button>
        <button type="button" disabled={hits.length === 0} onClick={() => jump(1)}>
          <Icon icon={ChevronDown} size="sm" />
          Next
        </button>
        <output>
          {hits.length > 0
            ? `${activeHit + 1}/${hits.length}`
            : query.trim()
              ? parsedPages
                ? '0/0'
                : 'Indexing…'
              : ''}
        </output>
        <button type="button" onClick={() => setScale((value) => Math.max(0.5, value - 0.15))}>
          <Icon icon={ZoomOut} size="sm" />
        </button>
        <button type="button" onClick={() => setScale(1)}>
          100%
        </button>
        <button type="button" onClick={() => setScale((value) => Math.min(2.6, value + 0.15))}>
          <Icon icon={ZoomIn} size="sm" />
        </button>
        <span>{Math.round(scale * 100)}%</span>
      </div>
      <div className="off-pdf-shell">
        <div className="off-pdf-rail">
          {state.pages.map((page) => (
            <button
              key={page}
              type="button"
              className={activePage === page ? 'is-active' : undefined}
              onClick={() => pageRefs.current.get(page)?.scrollIntoView({ block: 'center' })}
            >
              {page}
            </button>
          ))}
        </div>
        <div className="off-pdf-scroll">
          {state.pages.map((page) => (
            <PdfCanvasPage
              key={page}
              doc={state.doc}
              pageNumber={page}
              scale={scale}
              active={activePage === page}
              pageRef={(node) => {
                if (node) pageRefs.current.set(page, node);
                else pageRefs.current.delete(page);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
