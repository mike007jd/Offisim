import type { MissionStatus } from '@offisim/shared-types';

/**
 * Pure mission status-view derivation (PRD §29 accessibility — never color
 * alone: every status carries a label + a non-color glyph token the view maps
 * to a lucide icon). The Missions → Loops migration removed the Composer /
 * Mission Control surfaces; only the status-tone map survives, used to render
 * the legacy mission rows in `LoopRuns`.
 */

// ---------------------------------------------------------------------------
// Status presentation (§29 — never color alone: every status carries a label +
// a non-color glyph token the view maps to an icon).
// ---------------------------------------------------------------------------

type StatusTone = 'accent' | 'ok' | 'warn' | 'danger' | 'muted';
/** Stable glyph token; the view maps it to a lucide icon so status is legible
 *  without color. */
type StatusGlyph =
  | 'draft'
  | 'ready'
  | 'running'
  | 'verifying'
  | 'paused'
  | 'blocked'
  | 'failed'
  | 'completed'
  | 'cancelled'
  | 'waiting';

export interface MissionStatusView {
  label: string;
  tone: StatusTone;
  glyph: StatusGlyph;
  /** Whether the mission is in a live, work-in-progress phase (animated pill). */
  active: boolean;
}

const STATUS_VIEW: Readonly<Record<MissionStatus, MissionStatusView>> = {
  draft: { label: 'Draft', tone: 'muted', glyph: 'draft', active: false },
  ready: { label: 'Ready', tone: 'accent', glyph: 'ready', active: false },
  running: { label: 'Running', tone: 'accent', glyph: 'running', active: true },
  verifying: { label: 'Verifying', tone: 'accent', glyph: 'verifying', active: true },
  repairing: { label: 'Repairing', tone: 'warn', glyph: 'running', active: true },
  awaiting_user: { label: 'Awaiting you', tone: 'warn', glyph: 'waiting', active: false },
  interrupted: { label: 'Interrupted', tone: 'warn', glyph: 'waiting', active: false },
  ready_to_resume: { label: 'Ready to resume', tone: 'accent', glyph: 'ready', active: false },
  blocked: { label: 'Blocked', tone: 'danger', glyph: 'blocked', active: false },
  failed: { label: 'Failed', tone: 'danger', glyph: 'failed', active: false },
  completed: { label: 'Completed', tone: 'ok', glyph: 'completed', active: false },
  paused: { label: 'Paused', tone: 'muted', glyph: 'paused', active: false },
  cancelled: { label: 'Cancelled', tone: 'muted', glyph: 'cancelled', active: false },
};

export function missionStatusView(status: string): MissionStatusView {
  return (
    STATUS_VIEW[status as MissionStatus] ?? {
      label: status,
      tone: 'muted',
      glyph: 'draft',
      active: false,
    }
  );
}
