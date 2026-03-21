import {
  FlaskConical, PenTool, Rocket, Briefcase, Brain,
  Loader2, Users, FileText, ChevronRight,
} from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { CompanyTemplate } from '@aics/core/browser';
import { useCompanyCreation } from '../../hooks/useCompanyCreation.js';
import { ZONES } from '../../lib/zone-config.js';

/* ── Template visual config (Lucide icons, no emojis) ── */

const TMPL: Record<string, { icon: ReactNode; accent: string; accentBg: string }> = {
  'rd-company': { icon: <FlaskConical className="h-4 w-4" />, accent: 'text-blue-400', accentBg: 'bg-blue-500/10 border-blue-500/30' },
  'content-studio': { icon: <PenTool className="h-4 w-4" />, accent: 'text-emerald-400', accentBg: 'bg-emerald-500/10 border-emerald-500/30' },
  'product-team': { icon: <Rocket className="h-4 w-4" />, accent: 'text-violet-400', accentBg: 'bg-violet-500/10 border-violet-500/30' },
  'agency-lite': { icon: <Briefcase className="h-4 w-4" />, accent: 'text-amber-400', accentBg: 'bg-amber-500/10 border-amber-500/30' },
  'ai-startup': { icon: <Brain className="h-4 w-4" />, accent: 'text-cyan-400', accentBg: 'bg-cyan-500/10 border-cyan-500/30' },
};

const ROLE_COLORS: Record<string, string> = {
  developer: 'bg-blue-500', backend: 'bg-blue-500', frontend: 'bg-blue-400', fullstack: 'bg-blue-400',
  pm: 'bg-violet-500', manager: 'bg-violet-400',
  designer: 'bg-amber-500', ui_designer: 'bg-amber-400',
  analyst: 'bg-emerald-500', qa: 'bg-emerald-400',
  devops: 'bg-slate-400',
};

/* ── Component ── */

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

  useEffect(() => {
    if (!selectedTemplateId && templates.length > 0) setSelectedTemplateId(templates[0].id);
  }, [selectedTemplateId, templates, setSelectedTemplateId]);

  if (step === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-[#02040a]">
        <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
      </div>
    );
  }
  if (step === 'ready') return null;

  const selected = templates.find((t) => t.id === selectedTemplateId);
  const tmpl = selected ? TMPL[selected.id] : null;

  return (
    <div className="fixed inset-0 z-50 flex bg-[#02040a]">

      {/* ── Left: Template list ── */}
      <div className="w-52 shrink-0 border-r border-white/[0.06] bg-black/40 backdrop-blur-xl flex flex-col">
        <div className="px-4 pt-5 pb-3">
          <h1 className="text-sm font-semibold text-white tracking-tight">New Company</h1>
        </div>

        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {templates.map((t) => {
            const m = TMPL[t.id];
            const active = selectedTemplateId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTemplateId(t.id)}
                className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all ${
                  active
                    ? `border ${m?.accentBg ?? 'bg-white/5 border-white/10'}`
                    : 'border border-transparent hover:bg-white/[0.04]'
                }`}
              >
                <div className={`shrink-0 ${active ? (m?.accent ?? 'text-white') : 'text-slate-500'}`}>
                  {m?.icon ?? <FlaskConical className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`text-xs font-medium truncate ${active ? 'text-white' : 'text-slate-400'}`}>
                    {t.name}
                  </div>
                  <div className="text-[10px] text-slate-600">
                    {t.employees.length} members
                  </div>
                </div>
                {active && <ChevronRight className="h-3 w-3 text-slate-600 shrink-0" />}
              </button>
            );
          })}
        </div>

        {/* Footer: name + start */}
        <div className="p-3 border-t border-white/[0.06] space-y-2">
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="Company name"
            className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-white placeholder:text-slate-700 focus:outline-none focus:border-blue-500/40"
          />
          <button
            type="button"
            onClick={create}
            disabled={!selectedTemplateId || step === 'creating'}
            className="w-full rounded-lg bg-blue-600 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-30 transition-colors"
          >
            {step === 'creating' ? (
              <span className="flex items-center justify-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Setting up...
              </span>
            ) : 'Start Company'}
          </button>
          {error && <p className="text-[10px] text-red-400">{error}</p>}
        </div>
      </div>

      {/* ── Right: Preview ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected && tmpl ? (
          <div className="flex-1 flex flex-col overflow-y-auto">
            {/* Header */}
            <div className="px-8 pt-6 pb-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${tmpl.accentBg}`}>
                  <div className={tmpl.accent}>{tmpl.icon}</div>
                </div>
                <div>
                  <h2 className="text-base font-semibold text-white">{selected.name}</h2>
                  <p className="text-xs text-slate-500">{selected.description}</p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 px-8 py-5 flex gap-6">
              {/* Left column: floor plan + SOPs */}
              <div className="flex-1 space-y-5">
                {/* Floor plan */}
                <section>
                  <h3 className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-3">Layout</h3>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
                    <MiniFloorPlan />
                  </div>
                </section>

                {/* SOPs */}
                {selected.sops.length > 0 && (
                  <section>
                    <h3 className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-3">
                      Workflows ({selected.sops.length})
                    </h3>
                    <div className="space-y-1.5">
                      {selected.sops.map((sop) => (
                        <div key={sop.sop_id} className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                          <FileText className="h-3.5 w-3.5 text-slate-600 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <div className="text-xs text-slate-300 truncate">{sop.name}</div>
                          </div>
                          <span className="text-[10px] text-slate-600 shrink-0">{sop.steps.length} steps</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              {/* Right column: team */}
              <div className="w-64 shrink-0">
                <h3 className="text-[11px] font-medium text-slate-500 uppercase tracking-wider mb-3">
                  Team ({selected.employees.length})
                </h3>
                <div className="space-y-1">
                  {selected.employees.map((emp) => {
                    const dotColor = ROLE_COLORS[emp.role_slug] ?? 'bg-slate-500';
                    return (
                      <div key={emp.name} className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                        <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[9px] font-medium text-slate-300 shrink-0">
                          {emp.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-slate-200 truncate">{emp.name}</div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                          <span className="text-[10px] text-slate-600">{emp.role_slug}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-slate-700">Select a template</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Floor Plan SVG ── */

function MiniFloorPlan() {
  const W = 320;
  const H = 200;
  const scale = 7;
  const ox = W / 2;
  const oy = H / 2 - 8;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <rect width={W} height={H} fill="#060a14" />
      {/* Grid dots */}
      {Array.from({ length: 16 }, (_, i) =>
        Array.from({ length: 10 }, (_, j) => (
          <circle key={`${i}-${j}`} cx={20 + i * 19} cy={20 + j * 18} r={0.4} fill="#1e293b" />
        ))
      )}
      {ZONES.map((z) => {
        const x = ox + z.cx * scale - (z.w * scale) / 2;
        const y = oy + z.cz * scale - (z.d * scale) / 2;
        const w = z.w * scale;
        const h = z.d * scale;
        return (
          <g key={z.id}>
            <rect x={x} y={y} width={w} height={h} rx={3}
              fill={z.accent + '08'} stroke={z.accent} strokeWidth={0.6} strokeOpacity={0.3} />
            <text x={x + w / 2} y={y + h / 2 + 3} textAnchor="middle"
              fontSize={7} fill={z.accent} opacity={0.5} fontFamily="system-ui, sans-serif" fontWeight={500}
            >
              {z.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
