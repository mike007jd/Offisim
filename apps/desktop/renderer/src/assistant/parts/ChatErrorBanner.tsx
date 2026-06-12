import { Icon } from '@/design-system/icons/Icon.js';
import { AlertTriangle, ChevronDown, RotateCcw, X } from 'lucide-react';
import { useState } from 'react';
import { useRunStore } from '../run-store.js';

/**
 * In-thread recovery banner for a failed run. Surfaces only recovery paths that
 * write to shared run state: Retry appears only while the error carries a real
 * re-dispatch closure; seeded historical errors stay dismiss-only.
 */
export function ChatErrorBanner() {
  const error = useRunStore((s) => s.error);
  const dismissError = useRunStore((s) => s.dismissError);
  const [showDetails, setShowDetails] = useState(false);

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
      {error.retry || error.technicalDetail ? (
        <div className="off-errbanner-actions">
          {error.retry ? (
            <button type="button" className="off-errbanner-act off-focusable" onClick={error.retry}>
              <Icon icon={RotateCcw} size="sm" />
              Retry
            </button>
          ) : null}
          {error.technicalDetail ? (
            <button
              type="button"
              className="off-errbanner-act is-ghost off-focusable"
              aria-expanded={showDetails}
              onClick={() => setShowDetails((v) => !v)}
            >
              Details
              <Icon icon={ChevronDown} size="sm" />
            </button>
          ) : null}
        </div>
      ) : null}
      {showDetails && error.technicalDetail ? (
        <div className="off-errbanner-details">
          <p className="off-errbanner-tech">{error.technicalDetail}</p>
        </div>
      ) : null}
    </div>
  );
}
