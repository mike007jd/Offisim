import { useCompany } from './CompanyContext.js';

interface CompanySelectionPageProps {
  onSelectCompany: (companyId: string) => void;
  onCreateNew: () => void;
}

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'];

export function CompanySelectionPage({ onSelectCompany, onCreateNew }: CompanySelectionPageProps) {
  const { companies } = useCompany();

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0f0f1a' }}>
      {/* Left icon bar */}
      <div style={{
        width: 64, background: '#16162a', borderRight: '1px solid #222',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '16px 0', gap: 12,
      }}>
        {companies.map((c, i) => (
          <button
            key={c.company_id}
            onClick={() => onSelectCompany(c.company_id)}
            style={{
              width: 44, height: 44,
              background: COLORS[i % COLORS.length],
              borderRadius: 12, border: 'none', cursor: 'pointer',
              color: 'white', fontWeight: 700, fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            title={c.name}
          >
            {c.name.charAt(0).toUpperCase()}
          </button>
        ))}
        <button
          onClick={onCreateNew}
          style={{
            width: 44, height: 44,
            background: 'transparent', border: '2px dashed #444',
            borderRadius: 12, cursor: 'pointer',
            color: '#666', fontSize: 20,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="Create new company"
        >
          +
        </button>
      </div>

      {/* Main area */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 16,
      }}>
        <h1 style={{ color: '#fff', fontSize: 24, fontWeight: 600 }}>OFFISIM</h1>
        <p style={{ color: '#888', fontSize: 14 }}>
          {companies.length === 0
            ? 'No companies yet. Create your first one!'
            : 'Select a company to enter, or create a new one.'}
        </p>
        {companies.length === 0 && (
          <button
            onClick={onCreateNew}
            style={{
              padding: '12px 24px', background: '#6366f1', color: 'white',
              border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14,
            }}
          >
            Create Your First Company
          </button>
        )}
      </div>
    </div>
  );
}
