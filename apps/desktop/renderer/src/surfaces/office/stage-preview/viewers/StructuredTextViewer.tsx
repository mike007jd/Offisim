import { useMemo, useState } from 'react';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import type { ResolvedPreviewTarget } from '../preview-target.js';
import { TextViewer } from './TextViewer.js';

function xmlElementToObject(element: Element): Record<string, unknown> {
  const children = Array.from(element.children);
  const attributes = Object.fromEntries(
    Array.from(element.attributes).map((attr) => [attr.name, attr.value]),
  );
  if (children.length === 0) {
    return Object.keys(attributes).length > 0
      ? { '@attributes': attributes, '#text': element.textContent ?? '' }
      : { '#text': element.textContent ?? '' };
  }
  return {
    ...(Object.keys(attributes).length > 0 ? { '@attributes': attributes } : {}),
    ...children.reduce<Record<string, unknown>>((acc, child) => {
      const value = xmlElementToObject(child);
      const existing = acc[child.tagName];
      if (existing === undefined) acc[child.tagName] = value;
      else if (Array.isArray(existing)) existing.push(value);
      else acc[child.tagName] = [existing, value];
      return acc;
    }, {}),
  };
}

function parseStructured(text: string, resolved: ResolvedPreviewTarget): unknown {
  const extension = resolved.meta.extension?.toLowerCase();
  if (resolved.viewerKind === 'json' || extension === 'json' || extension === 'ndjson') {
    return JSON.parse(text);
  }
  if (extension === 'yaml' || extension === 'yml') return parseYaml(text);
  if (extension === 'toml') return parseToml(text);
  if (extension === 'xml' || resolved.meta.mimeType?.includes('xml')) {
    const parsed = new DOMParser().parseFromString(text, 'application/xml');
    const error = parsed.querySelector('parsererror');
    if (error) throw new Error(error.textContent ?? 'XML parse failed');
    return { [parsed.documentElement.tagName]: xmlElementToObject(parsed.documentElement) };
  }
  return JSON.parse(text);
}

function StructuredNode({
  label,
  value,
  depth = 0,
}: { label: string; value: unknown; depth?: number }) {
  if (value === null || typeof value !== 'object') {
    return (
      <div className="off-structured-row" style={{ paddingLeft: `${depth * 14}px` }}>
        <span>{label}</span>
        <code>{String(value)}</code>
      </div>
    );
  }
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value as Record<string, unknown>);
  return (
    <details className="off-structured-node" open={depth < 2}>
      <summary style={{ paddingLeft: `${depth * 14}px` }}>
        <span>{label}</span>
        <code>{Array.isArray(value) ? `${entries.length} items` : `${entries.length} keys`}</code>
      </summary>
      {entries.map(([key, child]) => (
        <StructuredNode key={key} label={key} value={child} depth={depth + 1} />
      ))}
    </details>
  );
}

export function StructuredTextViewer({
  text,
  resolved,
  truncated,
}: {
  text: string;
  resolved: ResolvedPreviewTarget;
  truncated?: boolean;
}) {
  const [raw, setRaw] = useState(false);
  const parsed = useMemo(() => {
    try {
      return { value: parseStructured(text, resolved), error: null as string | null };
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : 'Structured parse failed',
      };
    }
  }, [resolved, text]);
  if (raw || parsed.error) {
    return (
      <div className="off-structured-shell">
        <div className="off-structured-tools">
          {parsed.error ? <span>Parse failed: {parsed.error}</span> : null}
          <button type="button" onClick={() => setRaw(!raw)} disabled={Boolean(parsed.error)}>
            {raw ? 'Tree' : 'Raw'}
          </button>
        </div>
        <TextViewer text={text} truncated={truncated} />
      </div>
    );
  }
  return (
    <div className="off-structured-shell">
      <div className="off-structured-tools">
        <button type="button" onClick={() => setRaw(true)}>
          Raw
        </button>
      </div>
      <div className="off-structured-scroll">
        <StructuredNode label={resolved.meta.title} value={parsed.value} />
      </div>
    </div>
  );
}
