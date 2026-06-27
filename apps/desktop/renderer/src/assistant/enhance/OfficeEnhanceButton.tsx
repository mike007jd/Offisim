/**
 * Office composer Enhance button (PR-06).
 *
 * The first (and, in this PR, only) entry point into the shared Prompt Enhance
 * platform. It sits in the dense composer HUD between ThinkingControl and
 * ModeControl. Pressing it:
 *   1. reads the current composer text (via assistant-ui's composer runtime),
 *   2. extracts protected spans from the live roster (so @mentions, code, paths,
 *      and attachment/loop tokens are guarded),
 *   3. runs the isolated, no-tools, no-persistence Pi enhance path,
 *   4. opens the shared review dialog — and only on Apply replaces the text.
 *
 * It NEVER auto-triggers and NEVER replaces the text without the preview. Apply
 * swaps the text and offers a single Undo (Sonner) that restores the original.
 * Disabled while a run is in flight or the input is empty.
 */

import type { Employee } from '@/data/types.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { useComposer, useComposerRuntime } from '@assistant-ui/react';
import { Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { toMentionRoster } from '../composer/composer-triggers.js';
import { PromptEnhanceReview } from './PromptEnhanceReview.js';
import { extractProtectedSpans } from './protected-spans.js';
import { buildEnhanceRequest } from './service.js';
import { createTauriEnhanceTransport } from './tauri-enhance-transport.js';
import { useEnhance } from './useEnhance.js';

export function OfficeEnhanceButton({
  threadId,
  projectName,
  scopeEmployeeId,
  employees,
}: {
  threadId: string;
  projectName: string;
  scopeEmployeeId: string | null;
  employees: readonly Employee[];
}) {
  const composer = useComposerRuntime();
  // Subscribe to the composer text so the button's disabled state tracks typing.
  const text = useComposer((c) => c.text);
  const [open, setOpen] = useState(false);

  // One transport per button instance; the live preview deltas are ignored here
  // (the review shows the final text), but the seam stays open for a streaming UI.
  const transport = useMemo(() => createTauriEnhanceTransport({ threadId }), [threadId]);
  const enhance = useEnhance(transport);

  const roster = useMemo(
    () => toMentionRoster(employees.map((e) => ({ id: e.id, name: e.name, role: e.role }))),
    [employees],
  );

  const trimmed = text.trim();
  const disabled = trimmed.length === 0 || enhance.state.phase === 'loading';

  function openAndRun() {
    const current = composer.getState().text;
    if (!current.trim()) return;
    const spans = extractProtectedSpans(current, roster);
    const request = buildEnhanceRequest({
      profile: 'office_instruction',
      text: current,
      protectedSpans: spans,
      context: {
        surface: 'office',
        projectName,
        scope: scopeEmployeeId ? 'direct' : 'team',
      },
    });
    setOpen(true);
    enhance.start(request);
  }

  function applyEnhanced() {
    const result = enhance.state.result;
    if (!result) return;
    const original = composer.getState().text;
    composer.setText(result.enhanced);
    setOpen(false);
    enhance.reset();
    toast.success('Message enhanced', {
      description: 'Applied the enhanced version.',
      action: {
        label: 'Undo',
        onClick: () => composer.setText(original),
      },
    });
  }

  function keepOriginal() {
    setOpen(false);
    enhance.reset();
  }

  function close() {
    if (enhance.state.phase === 'loading') enhance.cancel();
    setOpen(false);
    enhance.reset();
  }

  return (
    <>
      <button
        type="button"
        className="off-composer-chip off-focusable off-enhance-trigger"
        aria-label="Enhance message"
        title="Enhance message"
        disabled={disabled}
        onClick={openAndRun}
      >
        <Icon icon={Sparkles} size="sm" />
        <span className="off-composer-chip-text">Enhance</span>
      </button>
      <PromptEnhanceReview
        open={open}
        state={enhance.state}
        onApply={applyEnhanced}
        onKeepOriginal={keepOriginal}
        onRegenerate={() => enhance.regenerate()}
        onCancel={() => enhance.cancel()}
        onClose={close}
      />
    </>
  );
}
