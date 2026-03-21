import { Loader2, Users, FileText, MapPin } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { CompanyTemplate } from '@aics/core/browser';
import { useCompanyCreation } from '../../hooks/useCompanyCreation.js';
import { ZONES } from '../../lib/zone-config.js';

// Icon + accent per template
const TMPL_META: Record<string, { icon: string; accent: string; bg: string }> = {
  'rd-company': { icon: '🧪', accent: 'border-blue-500', bg: 'bg-blue-500/10' },
  'content-studio': { icon: '✏️', accent: 'border-emerald-500', bg: 'bg-emerald-500/10' },
  'product-team': { icon: '🚀', accent: 'border-violet-500', bg: 'bg-violet-500/10' },
  'agency-lite': { icon: '💼', accent: 'border-amber-500', bg: 'bg-amber-500/10' },
  'ai-startup': { icon: '🧠', accent: 'border-cyan-500', bg: 'bg-cyan-500/10' },
};

interface CompanyCreationWizardProps {
  onComplete?: () => void;
}

export function CompanyCreationWizard({ onComplete }: CompanyCreationWizardProps) {
  const {
    step, templates, selectedTemplateId, companyName,
    setSelectedTemplateId, setCompanyName, create, error,
  } = useCompanyCreation();

  const prevStepRef = useRef(step);
  useEffect(() => {
    if (prevStepRef.current === 'creating' && step === 'ready') onComplete?.();
    prevStepRef.current = step;
  }, [step, onComplete]);

  // Auto-select first template
  useEffect(() => {
    if (!selectedTemplateId && templates.length > 0) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [selectedTemplateId, templates, setSelectedTemplateId]);

  if (step === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
      </div>
    );
  }

  if (step === 'ready') return null;

  const selected = templates.find((t) => t.id === selectedTemplateId);

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-950/95">
      {/* ── Left: Template List ── */}
      <div className="w-56 shrink-0 border-r border-white/5 flex flex-col">
        <div className="p-4 border-b border-white/5">
          <h1 className="text-sm font-semibold text-white">New Company</h1>
          <p className="text-xs text-slate-500 mt-0.5">Pick a template</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {templates.map((t) => {
            const meta = TMPL_META[t.id] ?? { icon: '📦', accent: 'border-slate-500', bg: 'bg-slate-500/10' };
            const isSelected = selectedTemplateId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTemplateId(t.id)}
                className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-all ${
                  isSelected
                    ? `${meta.bg} border ${meta.accent}`
                    : 'border border-transparent hover:bg-white/5'
                }`}
              >
                <span className="text-lg">{meta.icon}</span>
                <div className="min-w-0">
                  <div className={`text-xs font-medium truncate ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                    {t.name}
                  </div>
                  <div className="text-[10px] text-slate-500">{t.employees.length}人 · {t.sops.length} SOP</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Company name + Start button */}
        <div className="p-3 border-t border-white/5 space-y-2">
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Company name"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50"
          />
          <button
            type="button"
            onClick={create}
            disabled={!selectedTemplateId || step === 'creating'}
            className="w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40 transition-colors"
          >
            {step === 'creating' ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Creating...
              </span>
            ) : (
              'Start Company'
            )}
          </button>
          {error && <p className="text-[10px] text-red-400">{error}</p>}
        </div>
      </div>

      {/* ── Right: Preview ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected ? (
          <TemplatePreview template={selected} />
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">
            Select a template
          </div>
        )}
      </div>
    </div>
  );
}

function TemplatePreview({ template }: { template: CompanyTemplate }) {
  const meta = TMPL_META[template.id] ?? { icon: '📦', accent: 'border-slate-500', bg: 'bg-slate-500/10' };

  // Group employees by role
  const roleGroups = new Map<string, typeof template.employees>();
  for (const emp of template.employees) {
    const list = roleGroups.get(emp.role_slug) ?? [];
    list.push(emp);
    roleGroups.set(emp.role_slug, list);
  }

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="p-6 border-b border-white/5">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{meta.icon}</span>
          <div>
            <h2 className="text-lg font-semibold text-white">{template.name}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{template.description}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 grid grid-cols-2 gap-6">
        {/* Floor Plan (mini zone preview) */}
        <div>
          <h3 className="text-xs font-medium text-slate-400 mb-3 flex items-center gap-1.5">
            <MapPin className="h-3 w-3" /> Office Layout
          </h3>
          <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
            <MiniFloorPlan />
          </div>
        </div>

        {/* Team */}
        <div>
          <h3 className="text-xs font-medium text-slate-400 mb-3 flex items-center gap-1.5">
            <Users className="h-3 w-3" /> Team ({template.employees.length})
          </h3>
          <div className="space-y-2">
            {template.employees.map((emp) => {
              const persona = safeParseJson(emp.persona_json);
              return (
                <div key={emp.name} className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                  <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-[10px] font-medium text-white shrink-0">
                    {emp.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-white truncate">{emp.name}</div>
                    <div className="text-[10px] text-slate-500 truncate">{emp.role_slug}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* SOPs */}
        {template.sops.length > 0 && (
          <div className="col-span-2">
            <h3 className="text-xs font-medium text-slate-400 mb-3 flex items-center gap-1.5">
              <FileText className="h-3 w-3" /> SOPs ({template.sops.length})
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {template.sops.map((sop) => (
                <div key={sop.sop_id} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                  <div className="text-xs font-medium text-white">{sop.name}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{sop.steps.length} steps</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Simple SVG mini floor plan showing zones */
function MiniFloorPlan() {
  const W = 200;
  const H = 140;
  const scale = 4.5;
  const ox = W / 2;
  const oy = H / 2 - 10;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 160 }}>
      <rect x={0} y={0} width={W} height={H} rx={4} fill="#0f172a" />
      {ZONES.map((z) => {
        const x = ox + z.cx * scale - (z.w * scale) / 2;
        const y = oy + z.cz * scale - (z.d * scale) / 2;
        const w = z.w * scale;
        const h = z.d * scale;
        return (
          <g key={z.id}>
            <rect x={x} y={y} width={w} height={h} rx={2} fill={z.accent + '20'} stroke={z.accent} strokeWidth={0.5} strokeOpacity={0.4} />
            <text x={x + w / 2} y={y + h / 2 + 2} textAnchor="middle" fontSize={5} fill={z.accent} opacity={0.8} fontFamily="monospace">
              {z.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function safeParseJson(s: string | undefined): Record<string, unknown> {
  try { return JSON.parse(s ?? '{}'); } catch { return {}; }
}
