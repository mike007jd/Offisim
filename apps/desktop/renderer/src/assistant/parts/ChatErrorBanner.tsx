import { Icon } from '@/design-system/icons/Icon.js';
import { AlertTriangle, ChevronDown, X } from 'lucide-react';
import { useState } from 'react';
import { useRunStore } from '../run-store.js';

/**
 * In-thread recovery banner for a failed run. Surfaces only recovery paths that
 * write to shared run state instead of presenting model changes that cannot yet
 * be re-dispatched.
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
      {error.technicalDetail ? (
        <div className="off-errbanner-actions">
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
      ) : null}
      {showDetails && error.technicalDetail ? (
        <div className="off-errbanner-details">
          <p className="off-errbanner-tech">{error.technicalDetail}</p>
        </div>
      ) : null}
    </div>
  );
}
