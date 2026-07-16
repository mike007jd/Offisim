/**
 * Visual grammar for the loop graph (PR-09). Maps each node/edge kind to an
 * icon + label + line pattern — NEVER color alone. Pure data; the React node /
 * edge components read it. Keeping the grammar here (not inline in JSX) lets the
 * harness, future tests, and the components share one source of truth.
 */

import type { LoopEdgeKind, LoopNodeKind } from '@offisim/shared-types';
import {
  AlertTriangle,
  CircleDot,
  Flag,
  GitBranch,
  type LucideIcon,
  PlayCircle,
  Repeat,
  RotateCcw,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';

export interface NodeGrammar {
  icon: LucideIcon;
  /** Short kind word shown as a badge / aria role text. */
  kindWord: string;
  /** Shape token → CSS class suffix (terminal / card / diamond / gate / loop). */
  shape: 'terminal' | 'card' | 'diamond' | 'gate' | 'approval' | 'loop';
}

export const NODE_GRAMMAR: Record<LoopNodeKind, NodeGrammar> = {
  start: { icon: PlayCircle, kindWord: 'Start', shape: 'terminal' },
  finish: { icon: Flag, kindWord: 'Finish', shape: 'terminal' },
  action: { icon: CircleDot, kindWord: 'Action', shape: 'card' },
  decision: { icon: GitBranch, kindWord: 'Decision', shape: 'diamond' },
  verify: { icon: ShieldCheck, kindWord: 'Verify', shape: 'gate' },
  human_gate: { icon: UserCheck, kindWord: 'Human gate', shape: 'approval' },
  subloop: { icon: Repeat, kindWord: 'Subloop', shape: 'loop' },
};

export interface EdgeGrammar {
  /** Optional icon rendered on the edge badge (feedback/retry/escalate). */
  icon?: LucideIcon;
  /** Line pattern token → SVG dash style on the edge. */
  line: 'solid' | 'dashed' | 'loopback';
  /** Whether the edge is emphasized (thicker / accented) — feedback + escalate. */
  emphasized: boolean;
  /** Default badge word when the IR edge has no explicit label. */
  defaultLabel?: string;
  /** Severity class → warning style for escalate. */
  severity?: 'warn';
}

export const LOOP_GRAPH_GEOMETRY = {
  edgeCornerRadius: 8,
} as const;

export const EDGE_GRAMMAR: Record<LoopEdgeKind, EdgeGrammar> = {
  next: { line: 'solid', emphasized: false },
  feedback: { icon: RotateCcw, line: 'loopback', emphasized: true, defaultLabel: 'feedback' },
  retry: { icon: Repeat, line: 'dashed', emphasized: false, defaultLabel: 'retry' },
  escalate: {
    icon: AlertTriangle,
    line: 'solid',
    emphasized: true,
    defaultLabel: 'escalate',
    severity: 'warn',
  },
};
