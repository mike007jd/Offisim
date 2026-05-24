import { Button } from '@offisim/ui-core';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

export interface ActivityPayloadViewProps {
  payload: Record<string, unknown>;
  depth?: number;
}

export function ActivityPayloadView({ payload, depth = 0 }: ActivityPayloadViewProps) {
  const entries = Object.entries(payload);
  if (entries.length === 0) {
    return <p className="text-fs-meta italic text-ink-4">Empty payload</p>;
  }

  return (
    <div className="flex flex-col">
      {entries.map(([key, value]) => (
        <PayloadEntry key={key} entryKey={key} value={value} depth={depth} />
      ))}
    </div>
  );
}

function PayloadEntry({
  entryKey,
  value,
  depth,
}: {
  entryKey: string;
  value: unknown;
  depth: number;
}) {
  if (value === null || value === undefined) {
    return (
      <Row label={entryKey}>
        <span className="italic text-ink-4">null</span>
      </Row>
    );
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return (
      <Row label={entryKey}>
        <span className="text-ink-1">{String(value)}</span>
      </Row>
    );
  }

  if (Array.isArray(value)) {
    if (value.length <= 5) {
      return (
        <Row label={entryKey}>
          <span className="text-ink-1">[{value.map((v) => formatPrimitive(v)).join(', ')}]</span>
        </Row>
      );
    }
    return (
      <CollapsibleSection label={`${entryKey} [${value.length} items]`} defaultOpen={false}>
        {value.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: payload array items have no stable ID
          <PayloadEntry key={i} entryKey={String(i)} value={item} depth={depth + 1} />
        ))}
      </CollapsibleSection>
    );
  }

  if (typeof value === 'object') {
    let safeObj: Record<string, unknown>;
    try {
      safeObj = value as Record<string, unknown>;
    } catch {
      return (
        <Row label={entryKey}>
          <span className="italic text-ink-4">[Unable to display]</span>
        </Row>
      );
    }

    return (
      <CollapsibleSection label={entryKey} defaultOpen={depth < 2}>
        <ActivityPayloadView payload={safeObj} depth={depth + 1} />
      </CollapsibleSection>
    );
  }

  return (
    <Row label={entryKey}>
      <span className="text-ink-1">{String(value)}</span>
    </Row>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="activity-payload-row flex items-baseline">
      <span className="shrink-0 font-mono text-fs-meta text-ink-3">{label}</span>
      <span className="break-all text-fs-meta">{children}</span>
    </div>
  );
}

function CollapsibleSection({
  label,
  defaultOpen,
  children,
}: {
  label: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((prev) => !prev)}
        className="h-auto gap-sp-1 px-0 py-sp-1 font-mono text-fs-meta text-ink-3 hover:text-ink-1"
      >
        {open ? (
          <ChevronDown className="activity-payload-icon" />
        ) : (
          <ChevronRight className="activity-payload-icon" />
        )}
        {label}
      </Button>
      {open && <div className="activity-payload-indent">{children}</div>}
    </div>
  );
}

function formatPrimitive(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  return String(value);
}
