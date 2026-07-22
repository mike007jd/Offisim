import { cn } from '@/lib/utils.js';

/**
 * Engine identity primitive. Offisim-owned glyphs identify runtime lanes without
 * redistributing third-party app icons. Settings (AI Accounts) and the Office
 * TeamDock share this so an engine reads the same everywhere without remote
 * asset dependencies.
 *
 * Color values reference existing semantic tokens only; the repo defines no
 * per-brand tokens and this file introduces none.
 */
export type EngineKind = 'codex' | 'claude' | 'offisim' | 'api';

type EngineMeta = { readonly glyph: string };

const ENGINE_META: Record<EngineKind, EngineMeta> = {
  codex: {
    glyph: '{}',
  },
  claude: {
    glyph: '◇',
  },
  offisim: {
    glyph: 'O',
  },
  api: {
    glyph: 'A',
  },
};

function titleCaseEngine(kind: EngineKind): string {
  return kind === 'api' ? 'API' : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

/**
 * Resolve an engine lane from a runtime engine id, with an optional display
 * label as a secondary signal (external employees may only carry a brand
 * label). Unknown engines degrade to the generic API/Offisim marks instead of
 * rendering nothing.
 */
export function engineKindFromId(
  engineId?: string | null,
  fallbackLabel?: string | null,
): EngineKind {
  const id = (engineId ?? '').toLowerCase();
  if (id.includes('codex')) return 'codex';
  if (id.includes('claude')) return 'claude';
  if (id === 'offisim') return 'offisim';
  if (id === 'api') return 'api';
  const label = (fallbackLabel ?? '').toLowerCase();
  if (label.includes('codex')) return 'codex';
  if (label.includes('claude')) return 'claude';
  if (label.includes('offisim')) return 'offisim';
  return 'api';
}

export function engineLabel(kind: EngineKind): string {
  return `${titleCaseEngine(kind)} engine`;
}

export function engineShortLabel(kind: EngineKind): string {
  return titleCaseEngine(kind);
}

interface EngineMarkProps {
  engine: EngineKind;
  /** Approved square edge. */
  size?: 16 | 32;
  /** Accessible name; defaults to the engine's product label. */
  label?: string;
  /** Native tooltip; defaults to the accessible name. */
  title?: string;
  className?: string;
}

/** Square engine mark. Purely presentational — interactivity belongs to the
 *  wrapping control. */
export function EngineMark({ engine, size = 16, label, title, className }: EngineMarkProps) {
  const meta = ENGINE_META[engine];
  const accessibleName = label ?? engineLabel(engine);
  return (
    <span
      className={cn('off-engine-mark', className)}
      data-engine={engine}
      data-size={size}
      data-visual="glyph"
      role="img"
      aria-label={accessibleName}
      title={title ?? accessibleName}
    >
      <span aria-hidden className="off-engine-mark-glyph">
        {meta.glyph}
      </span>
    </span>
  );
}

interface EngineIdentityProps {
  engine: EngineKind;
  /** Text next to the mark; defaults to the engine's short label. */
  label?: string;
  size?: 16 | 32;
  /** Full label for tooltip/accessibility when the visible text is shortened. */
  title?: string;
  className?: string;
}

/** Mark + short text pairing for rows that identify an engine lane. */
export function EngineIdentity({
  engine,
  label,
  size = 16,
  title,
  className,
}: EngineIdentityProps) {
  const text = label ?? engineShortLabel(engine);
  const accessibleName = title ?? engineLabel(engine);
  return (
    <span
      className={cn('off-engine-identity', className)}
      title={accessibleName}
      aria-label={accessibleName}
    >
      <EngineMark engine={engine} size={size} label={accessibleName} />
      <span className="off-engine-identity-label">{text}</span>
    </span>
  );
}
