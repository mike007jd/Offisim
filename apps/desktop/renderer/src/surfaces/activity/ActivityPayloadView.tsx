import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { ActivityPayloadValue } from './activity-data.js';

function isPlainObject(
  value: ActivityPayloadValue,
): value is { [key: string]: ActivityPayloadValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrimitiveArray(value: ActivityPayloadValue[]): boolean {
  return value.every((v) => v === null || v === undefined || typeof v !== 'object');
}

function PrimitiveValue({ value }: { value: ActivityPayloadValue }) {
  if (value === null || value === undefined) {
    return <span className="off-pv-val is-null">null</span>;
  }
  return <span className="off-pv-val">{String(value)}</span>;
}

interface CollapsibleProps {
  label: string;
  defaultOpen: boolean;
  children: ReactNode;
}

function Collapsible({ label, defaultOpen, children }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <button
        type="button"
        className="off-pv-coll off-focusable"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown aria-hidden className="size-3" />
        ) : (
          <ChevronRight aria-hidden className="size-3" />
        )}
        {label}
      </button>
      {open ? <div className="off-pv-children">{children}</div> : null}
    </>
  );
}

interface PayloadNodeProps {
  name: string;
  value: ActivityPayloadValue;
  depth: number;
}

function PayloadNode({ name, value, depth }: PayloadNodeProps) {
  // Array
  if (Array.isArray(value)) {
    if (value.length <= 5 && isPrimitiveArray(value)) {
      const inline = `[${value.map((v) => (v === null || v === undefined ? 'null' : String(v))).join(', ')}]`;
      return (
        <div className="off-pv-row">
          <span className="off-pv-key">{name}</span>
          <span className="off-pv-val">{inline}</span>
        </div>
      );
    }
    return (
      <Collapsible label={`${name} [${value.length} items]`} defaultOpen={false}>
        {value.map((item, index) => (
          <PayloadNode
            // biome-ignore lint/suspicious/noArrayIndexKey: array order is stable for a static payload
            key={`${name}-${index}`}
            name={String(index)}
            value={item}
            depth={depth + 1}
          />
        ))}
      </Collapsible>
    );
  }

  // Object
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return (
        <div className="off-pv-row">
          <span className="off-pv-key">{name}</span>
          <span className="off-pv-empty">Empty payload</span>
        </div>
      );
    }
    return (
      <Collapsible label={name} defaultOpen={depth < 2}>
        {entries.map(([key, child]) => (
          <PayloadNode key={key} name={key} value={child} depth={depth + 1} />
        ))}
      </Collapsible>
    );
  }

  // Primitive
  return (
    <div className="off-pv-row">
      <span className="off-pv-key">{name}</span>
      <PrimitiveValue value={value} />
    </div>
  );
}

/** Recursive key/value payload tree used by the event detail panel. */
export function ActivityPayloadView({
  payload,
}: {
  payload?: Record<string, ActivityPayloadValue>;
}) {
  const entries = payload ? Object.entries(payload) : [];
  if (entries.length === 0) {
    return <p className="off-pv-empty">Empty payload</p>;
  }
  return (
    <div className="off-pv">
      {entries.map(([key, value]) => (
        <PayloadNode key={key} name={key} value={value} depth={1} />
      ))}
    </div>
  );
}
