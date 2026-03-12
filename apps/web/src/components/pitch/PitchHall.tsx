import { useCallback, useState } from 'react';
import { type Deliverable, useDeliverables } from '../../hooks/useDeliverables';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

// ---------------------------------------------------------------------------
// DeliverableCard
// ---------------------------------------------------------------------------

function DeliverableCard({ item }: { item: Deliverable }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(item.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API may fail in non-secure contexts — silent fallback
    }
  }, [item.content]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([item.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${item.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [item.content, item.title]);

  return (
    <Card className="animate-in fade-in slide-in-from-bottom-2 duration-300 bg-ocean-deep/50 border-ocean-light">
      <CardHeader className="p-3 pb-1">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-xs text-pearl leading-snug">{item.title}</CardTitle>
          <span className="shrink-0 text-[10px] text-shell/60">{timeAgo(item.createdAt)}</span>
        </div>
        {item.contributingEmployees.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {item.contributingEmployees.map((emp) => (
              <Badge
                key={emp.employeeId}
                variant="info"
                className="text-[10px] px-1.5 py-0"
              >
                {emp.employeeName}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-3 pt-1">
        <p className="font-pixel-mono text-[11px] text-shell/80 leading-relaxed whitespace-pre-wrap break-words">
          {truncate(item.content, 200)}
        </p>
        <div className="flex gap-2 mt-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-shell/70 hover:text-pearl"
            onClick={handleCopy}
          >
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-shell/70 hover:text-pearl"
            onClick={handleDownload}
          >
            Download
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// PitchHall
// ---------------------------------------------------------------------------

export function PitchHall() {
  const deliverables = useDeliverables();

  if (deliverables.length === 0) {
    return (
      <div className="flex items-center justify-center p-6 text-sm text-shell">
        No deliverables yet. Outputs will appear here after tasks complete.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-pearl">Deliverables</h3>
        <span className="text-[10px] text-shell">{deliverables.length} total</span>
      </div>
      {deliverables.map((item) => (
        <DeliverableCard key={item.id} item={item} />
      ))}
    </div>
  );
}
