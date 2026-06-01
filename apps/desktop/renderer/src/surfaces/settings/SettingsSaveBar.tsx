import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { AlertTriangle, Check, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'post-save' | 'error';

interface SettingsSaveBarProps {
  status: SaveStatus;
  dirtyScopes: readonly string[];
  validationBlocked: boolean;
  errorMessage?: string | null;
  onSave: () => void;
  onRetry: () => void;
}

function scopeLabel(scopes: readonly string[]): string {
  if (scopes.length === 0) return 'Save changes';
  return `Save ${scopes.join(' + ')} changes`;
}

export function SettingsSaveBar({
  status,
  dirtyScopes,
  validationBlocked,
  errorMessage,
  onSave,
  onRetry,
}: SettingsSaveBarProps) {
  const isDirty = status === 'dirty';
  const isSaving = status === 'saving' || status === 'post-save';
  const isError = status === 'error';
  const disabled = status === 'idle' || validationBlocked;

  let label: ReactNode;
  let tip: string;
  let tipTone: '' | 'err' | 'warn' = '';

  if (isError) {
    label = (
      <>
        <Icon icon={RefreshCw} size="sm" />
        Save failed — retry
      </>
    );
    tip = errorMessage ?? 'Last attempt failed · retry';
    tipTone = 'err';
  } else if (status === 'post-save') {
    label = (
      <>
        <Icon icon={Check} size="sm" />
        Saved
      </>
    );
    tip = 'Settings saved';
  } else if (status === 'saving') {
    label = (
      <>
        <span className="off-set-spin-inline" />
        Saving…
      </>
    );
    tip = 'Persisting to the desktop settings repository';
  } else if (validationBlocked) {
    label = (
      <>
        <Icon icon={AlertTriangle} size="sm" />
        Save changes
      </>
    );
    tip = 'Resolve validation issues before saving';
    tipTone = 'warn';
  } else if (isDirty) {
    label = (
      <>
        <Icon icon={Check} size="sm" />
        {scopeLabel(dirtyScopes)}
      </>
    );
    tip = `${dirtyScopes.length} ${dirtyScopes.length === 1 ? 'section has' : 'sections have'} unsaved changes · ⌘S to save`;
  } else {
    label = (
      <>
        <Icon icon={Check} size="sm" />
        Save changes
      </>
    );
    tip = 'No changes to save';
  }

  const barTone = isError ? 'is-error' : isSaving ? 'is-busy' : isDirty ? 'is-dirty' : 'is-idle';

  return (
    <div className="off-set-savebar-wrap">
      {isError && errorMessage ? (
        <div className="off-set-err-banner off-set-err-banner-detached">
          <Icon icon={AlertTriangle} size="sm" />
          <div>
            <div className="off-set-err-title">Save failed</div>
            <div className="off-set-err-msg">{errorMessage}</div>
          </div>
          <Button variant="outline" size="sm" className="ml-auto" onClick={onRetry}>
            <Icon icon={RefreshCw} size="sm" />
            Retry
          </Button>
        </div>
      ) : null}
      <div className={`off-set-savebar ${barTone}`}>
        <div className="off-set-savebar-inner">
          <button
            type="button"
            className="off-set-btn-save"
            disabled={disabled && !isError}
            onClick={isError ? onRetry : onSave}
          >
            {label}
          </button>
          <div className={`off-set-save-tip${tipTone ? ` is-${tipTone}` : ''}`}>{tip}</div>
        </div>
      </div>
    </div>
  );
}
