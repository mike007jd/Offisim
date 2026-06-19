import { toast } from 'sonner';

interface DiscardConfirmOptions {
  /** Headline shown in the toast bar. */
  message?: string;
  /** Sub-line explaining what triggered the guard. */
  detail?: string;
  /** Fired when the user confirms discard — resets dirty state + exits. */
  onDiscard: () => void;
}

let activeToastId: string | number | null = null;

/** DiscardConfirmToast — the only path out of a dirty wizard. Renders the V3
 *  hard-dark `.discard-bar` grammar (matches the wizard surface) with
 *  Keep editing / Discard actions. Re-arming while shown is a no-op-replace so
 *  repeated Esc presses never bury or bypass the guard. */
export function showDiscardConfirm({ message, detail, onDiscard }: DiscardConfirmOptions): void {
  // Already armed → keep the single instance (Esc re-arm should not bypass).
  if (activeToastId !== null) {
    toast.dismiss(activeToastId);
  }
  activeToastId = toast.custom(
    (id) => (
      <div className="off-discard-bar" role="alertdialog" aria-label="Discard unsaved changes">
        <div className="off-discard-copy">
          <div className="off-discard-msg">{message ?? 'Discard new company?'}</div>
          <div className="off-discard-esc">{detail ?? 'Your draft will be lost.'}</div>
        </div>
        <div className="off-discard-acts">
          <button
            type="button"
            className="off-discard-keep off-focusable"
            onClick={() => {
              toast.dismiss(id);
              activeToastId = null;
            }}
          >
            Keep editing
          </button>
          <button
            type="button"
            className="off-discard-discard off-focusable"
            onClick={() => {
              toast.dismiss(id);
              activeToastId = null;
              onDiscard();
            }}
          >
            Discard
          </button>
        </div>
      </div>
    ),
    // bottom-center: the confirm bar sits on the same axis as the wizard
    // footer / Esc affordance instead of the top-right notification corner.
    { duration: Number.POSITIVE_INFINITY, dismissible: false, position: 'bottom-center' },
  );
}

/** Clear any armed discard toast (called when the wizard unmounts/commits). */
export function clearDiscardConfirm(): void {
  if (activeToastId !== null) {
    toast.dismiss(activeToastId);
    activeToastId = null;
  }
}
