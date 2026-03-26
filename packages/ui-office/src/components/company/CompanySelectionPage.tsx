import { Plus } from 'lucide-react';
import { FONT, SP, STUDIO_COLORS } from '../studio/studio-tokens.js';
import { useCompany } from './CompanyContext.js';

interface CompanySelectionPageProps {
  onSelectCompany: (companyId: string) => void;
  onCreateNew: () => void;
}

const ICON_COLORS = [
  STUDIO_COLORS.accent,
  STUDIO_COLORS.warning,
  STUDIO_COLORS.catCollaboration,
  STUDIO_COLORS.error,
  STUDIO_COLORS.catKnowledge,
  STUDIO_COLORS.catDecorative,
];

export function CompanySelectionPage({ onSelectCompany, onCreateNew }: CompanySelectionPageProps) {
  const { companies } = useCompany();

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        background: STUDIO_COLORS.bg,
        fontFamily: FONT.family,
      }}
    >
      {/* Left icon bar */}
      <div
        style={{
          width: 64,
          background: STUDIO_COLORS.surface0,
          borderRight: `1px solid ${STUDIO_COLORS.border}`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: `${SP.lg}px 0`,
          gap: SP.md,
        }}
      >
        {companies.map((c, i) => (
          <button
            key={c.company_id}
            type="button"
            onClick={() => onSelectCompany(c.company_id)}
            aria-label={`Open company: ${c.name}`}
            style={{
              width: 44,
              height: 44,
              background: ICON_COLORS[i % ICON_COLORS.length],
              borderRadius: SP.md,
              border: 'none',
              cursor: 'pointer',
              color: 'white',
              fontWeight: FONT.bold,
              fontSize: FONT.xxl,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: FONT.family,
            }}
            title={c.name}
          >
            {c.name.charAt(0).toUpperCase()}
          </button>
        ))}
        <button
          type="button"
          onClick={onCreateNew}
          aria-label="Create new company"
          style={{
            width: 44,
            height: 44,
            background: 'transparent',
            border: `2px dashed ${STUDIO_COLORS.border}`,
            borderRadius: SP.md,
            cursor: 'pointer',
            color: STUDIO_COLORS.textTertiary,
            fontSize: FONT.xl,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title="Create new company"
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Main area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: SP.lg,
        }}
      >
        <h1
          style={{
            color: STUDIO_COLORS.textPrimary,
            fontSize: SP.xxl,
            fontWeight: FONT.semibold,
            fontFamily: FONT.family,
            margin: 0,
          }}
        >
          OFFISIM
        </h1>
        <p
          style={{
            color: STUDIO_COLORS.textTertiary,
            fontSize: FONT.xl,
            fontFamily: FONT.family,
            margin: 0,
          }}
        >
          {companies.length === 0
            ? 'No companies yet. Create your first one!'
            : 'Select a company to enter, or create a new one.'}
        </p>
        {companies.length === 0 && (
          <button
            type="button"
            onClick={onCreateNew}
            aria-label="Create your first company"
            style={{
              padding: `${SP.md}px ${SP.xxl}px`,
              background: STUDIO_COLORS.accent,
              color: 'white',
              border: 'none',
              borderRadius: SP.sm,
              cursor: 'pointer',
              fontSize: FONT.xl,
              fontWeight: FONT.semibold,
              fontFamily: FONT.family,
            }}
          >
            Create Your First Company
          </button>
        )}
      </div>
    </div>
  );
}
