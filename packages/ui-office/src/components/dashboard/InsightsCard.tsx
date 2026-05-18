import type { MemoryEntryRow } from '@offisim/core/browser';
import { Card, CardContent, CardHeader, CardTitle, ScrollArea } from '@offisim/ui-core';
import { Lightbulb } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { useCompany } from '../company/CompanyContext.js';

export function InsightsCard() {
  const { repos } = useOffisimRuntime();
  const { activeCompanyId } = useCompany();
  const [memories, setMemories] = useState<MemoryEntryRow[]>([]);

  useEffect(() => {
    if (!repos?.memories || !activeCompanyId) {
      setMemories([]);
      return;
    }
    let cancelled = false;
    void repos.memories
      .findByOwner(activeCompanyId, { category: 'experience', limit: 20 })
      .then((result) => {
        if (!cancelled) setMemories(result);
      });
    return () => {
      cancelled = true;
    };
  }, [repos, activeCompanyId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Lightbulb className="h-4 w-4 text-warning" />
          Company Insights
        </CardTitle>
      </CardHeader>
      <CardContent>
        {memories.length === 0 ? (
          <p className="text-xs text-text-muted italic">
            No insights yet. Complete tasks to generate experience summaries.
          </p>
        ) : (
          <ScrollArea className="max-h-48">
            {memories.map((m) => (
              <div key={m.memory_id} className="px-2 py-1.5 border-b border-white/5 last:border-0">
                <p className="text-caption text-text-secondary leading-relaxed">{m.content}</p>
                <div className="flex items-center gap-2 mt-0.5 text-caption text-text-muted">
                  <span>Importance: {Math.round((m.importance ?? 0.5) * 100)}%</span>
                  {m.reinforcement_count > 0 && (
                    <span>&middot; Reinforced {m.reinforcement_count}x</span>
                  )}
                </div>
              </div>
            ))}
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
