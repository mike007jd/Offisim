/**
 * Shared Prompt Enhance review surface (PR-06).
 *
 * Used by EVERY entry point (Office integrates it here; Connect/Loops downstream).
 * Renders the cancelable loading state and the Original / Enhanced preview with
 * concise rationale + warnings, plus Apply / Keep original / Regenerate and — after
 * Apply — a single Undo. It NEVER auto-triggers, never replaces text without this
 * preview, and never injects the rationale or system prompt into the user's text.
 *
 * It is a controlled component: the parent owns the enhance state (via `useEnhance`)
 * and the apply/undo wiring, so the same review works over a composer textarea
 * (Office) or any other input (later surfaces).
 */

import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/design-system/primitives/dialog.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/design-system/primitives/tabs.js';
import { AlertTriangle, Check, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { resultIsApplyable } from './contract.js';
import type { EnhanceState } from './useEnhance.js';

export interface PromptEnhanceReviewProps {
  open: boolean;
  state: EnhanceState;
  /** Apply the enhanced text. Only callable when the result is applyable. */
  onApply: () => void;
  /** Keep the original text unchanged and close. */
  onKeepOriginal: () => void;
  /** Re-run the enhance. */
  onRegenerate: () => void;
  /** Cancel an in-flight enhance. */
  onCancel: () => void;
  /** Close the dialog (Escape / overlay / X). */
  onClose: () => void;
}

export function PromptEnhanceReview({
  open,
  state,
  onApply,
  onKeepOriginal,
  onRegenerate,
  onCancel,
  onClose,
}: PromptEnhanceReviewProps) {
  const result = state.result;
  const applyable = result ? resultIsApplyable(result) : false;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent showClose={false} className="off-enhance-dialog off-dialog-w-md">
        <div className="off-enhance-head">
          <span className="off-enhance-icon">
            <Icon icon={Sparkles} size="sm" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[length:var(--off-fs-sm)] font-[660]">
              Enhance message
            </DialogTitle>
            <DialogDescription className="text-[length:var(--off-fs-meta)]">
              Review the rewrite. Nothing changes until you Apply.
            </DialogDescription>
          </div>
          <button
            type="button"
            className="off-enhance-close off-focusable"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon icon={X} size="sm" />
          </button>
        </div>

        {state.phase === 'loading' ? (
          <div className="off-enhance-loading" role="status">
            <Icon icon={Loader2} size="sm" className="off-spin" />
            <span>Enhancing…</span>
            <Button variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        ) : null}

        {state.phase === 'error' ? (
          <div className="off-enhance-error" role="alert">
            <Icon icon={AlertTriangle} size="sm" />
            <span>{state.error}</span>
          </div>
        ) : null}

        {state.phase === 'ready' && result ? (
          <>
            {!applyable ? (
              <div className="off-set-callout is-warn off-enhance-invalid" role="alert">
                <Icon icon={AlertTriangle} size="sm" />
                A protected element (mention, code, path, or reference) was lost in the rewrite.
                Apply is disabled — try Regenerate or keep the original.
              </div>
            ) : null}

            <Tabs defaultValue="enhanced" className="off-enhance-tabs">
              <TabsList className="off-enhance-tablist">
                <TabsTrigger value="enhanced" className="off-enhance-tab">
                  Enhanced
                </TabsTrigger>
                <TabsTrigger value="original" className="off-enhance-tab">
                  Original
                </TabsTrigger>
              </TabsList>
              <TabsContent value="enhanced" className="off-enhance-panel">
                <pre className="off-enhance-text">{result.enhanced}</pre>
              </TabsContent>
              <TabsContent value="original" className="off-enhance-panel">
                <pre className="off-enhance-text is-muted">{result.original}</pre>
              </TabsContent>
            </Tabs>

            {result.rationale.length > 0 ? (
              <ul className="off-enhance-rationale">
                {result.rationale.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" size="md" onClick={onKeepOriginal}>
            Keep original
          </Button>
          <Button
            variant="outline"
            size="md"
            onClick={onRegenerate}
            disabled={state.phase === 'loading'}
          >
            <Icon icon={RefreshCw} size="sm" />
            Regenerate
          </Button>
          <Button
            size="md"
            onClick={onApply}
            disabled={state.phase !== 'ready' || !applyable}
            title={
              result && !applyable
                ? 'A protected element was lost — cannot apply'
                : 'Replace your message with the enhanced version'
            }
          >
            <Icon icon={Check} size="sm" />
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
