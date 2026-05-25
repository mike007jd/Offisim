import { useEmployees } from '@/data/queries.js';
import { Icon } from '@/design-system/icons/Icon.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import { relativeTime } from '@/lib/utils.js';
import { AlertTriangle, ChevronDown, Cpu, RotateCcw, UserCog, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useRunStore } from '../run-store.js';

const MODEL_OPTIONS = ['MiniMax-M2.7', 'MiniMax-M2.7 · Pro', 'MiniMax-M2.7 · Lite'];

/**
 * In-thread recovery banner for a failed run. Surfaces the four prototype
 * recovery paths — Retry, Swap person, Swap model, Details (with error history)
 * — instead of a dead-ended error. Reads/writes the shared run-state store.
 */
export function ChatErrorBanner() {
  const error = useRunStore((s) => s.error);
  const retry = useRunStore((s) => s.retry);
  const dismissError = useRunStore((s) => s.dismissError);
  const swapPerson = useRunStore((s) => s.swapPerson);
  const employees = useEmployees();
  const [showDetails, setShowDetails] = useState(false);

  const candidates = useMemo(
    () => (employees.data ?? []).filter((e) => error?.swapCandidateIds.includes(e.id)),
    [employees.data, error?.swapCandidateIds],
  );

  if (!error) return null;

  return (
    <div className="off-errbanner" role="alert">
      <div className="off-errbanner-main">
        <span className="off-errbanner-glyph">
          <Icon icon={AlertTriangle} size="sm" />
        </span>
        <span className="off-errbanner-msg">{error.message}</span>
        <button
          type="button"
          className="off-errbanner-x off-focusable"
          aria-label="Dismiss"
          onClick={dismissError}
        >
          <Icon icon={X} size="sm" />
        </button>
      </div>
      <div className="off-errbanner-actions">
        <button type="button" className="off-errbanner-act off-focusable" onClick={retry}>
          <Icon icon={RotateCcw} size="sm" />
          Retry
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="off-errbanner-act off-focusable">
              <Icon icon={UserCog} size="sm" />
              Swap person
              <Icon icon={ChevronDown} size="sm" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {candidates.map((c) => (
              <DropdownMenuItem key={c.id} onSelect={() => swapPerson(c.id)}>
                {c.name} · {c.role}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="off-errbanner-act off-focusable">
              <Icon icon={Cpu} size="sm" />
              Swap model
              <Icon icon={ChevronDown} size="sm" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {MODEL_OPTIONS.map((m) => (
              <DropdownMenuItem key={m} onSelect={() => retry()}>
                {m}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          className="off-errbanner-act is-ghost off-focusable"
          aria-expanded={showDetails}
          onClick={() => setShowDetails((v) => !v)}
        >
          Details
          <Icon icon={ChevronDown} size="sm" />
        </button>
      </div>
      {showDetails ? (
        <div className="off-errbanner-details">
          <p className="off-errbanner-tech">{error.technicalDetail}</p>
          <ul className="off-errbanner-history">
            {error.history.map((entry) => (
              <li key={entry.id}>
                <span className="off-errbanner-hist-reason">{entry.reason}</span>
                <span className="off-errbanner-hist-msg">{entry.message}</span>
                <span className="off-errbanner-hist-at">{relativeTime(entry.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
