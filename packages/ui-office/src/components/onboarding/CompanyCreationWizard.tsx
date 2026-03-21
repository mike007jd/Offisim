import {
  FlaskConical, PenTool, Rocket, Briefcase, Brain,
  Loader2, ChevronRight,
} from 'lucide-react';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { CompanyTemplate } from '@aics/core/browser';
import { createAvatar } from '@dicebear/core';
import { avataaars } from '@dicebear/collection';
import { useCompanyCreation } from '../../hooks/useCompanyCreation.js';
import { ZONES } from '../../lib/zone-config.js';
import { ROLE_LABELS } from '../../lib/roles.js';

/* ── Template config ── */

const TMPL: Record<string, { icon: ReactNode; accent: string; accentBg: string }> = {
  'rd-company':     { icon: <FlaskConical className="h-4 w-4" />, accent: 'text-blue-400',    accentBg: 'bg-blue-500/10 border-blue-500/30' },
  'content-studio': { icon: <PenTool className="h-4 w-4" />,     accent: 'text-emerald-400',  accentBg: 'bg-emerald-500/10 border-emerald-500/30' },
  'product-team':   { icon: <Rocket className="h-4 w-4" />,      accent: 'text-violet-400',   accentBg: 'bg-violet-500/10 border-violet-500/30' },
  'agency-lite':    { icon: <Briefcase className="h-4 w-4" />,    accent: 'text-amber-400',    accentBg: 'bg-amber-500/10 border-amber-500/30' },
  'ai-startup':     { icon: <Brain className="h-4 w-4" />,        accent: 'text-cyan-400',     accentBg: 'bg-cyan-500/10 border-cyan-500/30' },
};

const ROLE_DOT: Record<string, string> = {
  developer: '#3b82f6', backend: '#3b82f6', frontend: '#60a5fa', fullstack: '#60a5fa',
  pm: '#8b5cf6', manager: '#a78bfa',
  designer: '#f59e0b', ui_designer: '#fbbf24',
  analyst: '#10b981', qa: '#34d399',
  devops: '#94a3b8', engineering_manager: '#a78bfa',
};

/* ── Avatar cache ── */
const avatarCache = new Map<string, string>();
function getAvatar(seed: string, size = 32): string {
  const key = `${seed}-${size}`;
  const cached = avatarCache.get(key);
  if (cached) return cached;
  const uri = createAvatar(avataaars, { seed, size }).toDataUri();
  avatarCache.set(key, uri);
  return uri;
}

/* ── Zone → role mapping for placing employees ── */
function resolveZoneForRole(role: string): string {
  const map: Record<string, string> = {
    developer: 'dev', backend: 'dev', frontend: 'dev', fullstack: 'dev', devops: 'dev', engineering_manager: 'dev',
    pm: 'prod', manager: 'prod', analyst: 'prod',
    designer: 'art', ui_designer: 'art',
  };
  return map[role] ?? 'dev';
}

/* ── Component ── */

interface Props { onComplete?: () => void }

export function CompanyCreationWizard({ onComplete }: Props) {
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
    return <div className="flex h-screen items-center justify-center bg-[#02040a]"><Loader2 className="h-5 w-5 animate-spin text-blue-400" /></div>;
  }
  if (step === 'ready') return null;

  const selected = templates.find((t) => t.id === selectedTemplateId);
  const tmpl = selected ? TMPL[selected.id] : null;

  return (
    <div className="fixed inset-0 z-50 flex bg-[#02040a]">
      {/* ── Left: list ── */}
      <div className="w-48 shrink-0 border-r border-white/[0.06] bg-black/40 backdrop-blur-xl flex flex-col">
        <div className="px-4 pt-5 pb-3">
          <h1 className="text-sm font-semibold text-white tracking-tight">New Company</h1>
        </div>
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {templates.map((t) => {
            const m = TMPL[t.id];
            const active = selectedTemplateId === t.id;
            return (
              <button key={t.id} type="button" onClick={() => setSelectedTemplateId(t.id)}
                className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-all ${active ? `border ${m?.accentBg ?? 'bg-white/5 border-white/10'}` : 'border border-transparent hover:bg-white/[0.04]'}`}>
                <div className={`shrink-0 ${active ? (m?.accent ?? 'text-white') : 'text-slate-600'}`}>
                  {m?.icon ?? <FlaskConical className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`text-xs font-medium truncate ${active ? 'text-white' : 'text-slate-400'}`}>{t.name}</div>
                  <div className="text-[10px] text-slate-600">{t.employees.length} members</div>
                </div>
                {active && <ChevronRight className="h-3 w-3 text-slate-600 shrink-0" />}
              </button>
            );
          })}
        </div>
        <div className="p-3 border-t border-white/[0.06] space-y-2">
          <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company name"
            className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-white placeholder:text-slate-700 focus:outline-none focus:border-blue-500/40" />
          <button type="button" onClick={create} disabled={!selectedTemplateId || step === 'creating'}
            className="w-full rounded-lg bg-blue-600 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-30 transition-colors">
            {step === 'creating' ? <span className="flex items-center justify-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Setting up...</span> : 'Start Company'}
          </button>
          {error && <p className="text-[10px] text-red-400">{error}</p>}
        </div>
      </div>

      {/* ── Right: preview ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selected && tmpl ? <TemplatePreview template={selected} tmpl={tmpl} /> : (
          <div className="flex-1 flex items-center justify-center"><p className="text-sm text-slate-700">Select a template</p></div>
        )}
      </div>
    </div>
  );
}

/* ── Preview panel ── */

function TemplatePreview({ template, tmpl }: { template: CompanyTemplate; tmpl: { icon: ReactNode; accent: string; accentBg: string } }) {
  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 flex items-center gap-3 border-b border-white/[0.06]">
        <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${tmpl.accentBg}`}>
          <div className={tmpl.accent}>{tmpl.icon}</div>
        </div>
        <h2 className="text-sm font-semibold text-white">{template.name}</h2>
        <span className="text-xs text-slate-600">{template.description}</span>
      </div>

      {/* Main content: floor plan (center) + team (right) */}
      <div className="flex-1 flex min-h-0">
        {/* Floor plan */}
        <div className="flex-1 p-4 flex items-center justify-center">
          <Office2DPreview employees={template.employees} />
        </div>

        {/* Team sidebar */}
        <div className="w-56 shrink-0 border-l border-white/[0.06] flex flex-col overflow-y-auto p-3">
          <h3 className="text-[10px] font-medium text-slate-600 uppercase tracking-wider mb-2">
            Team · {template.employees.length}
          </h3>
          <div className="space-y-1">
            {template.employees.map((emp) => (
              <EmployeeRow key={emp.name} name={emp.name} role={emp.role_slug} />
            ))}
          </div>

          {template.sops.length > 0 && (
            <>
              <h3 className="text-[10px] font-medium text-slate-600 uppercase tracking-wider mb-2 mt-4">
                Workflows · {template.sops.length}
              </h3>
              <div className="space-y-1">
                {template.sops.map((sop) => (
                  <div key={sop.sop_id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
                    <div className="text-[11px] text-slate-400 truncate">{sop.name}</div>
                    <div className="text-[9px] text-slate-600">{sop.steps.length} steps</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Employee row with DiceBear ── */

function EmployeeRow({ name, role }: { name: string; role: string }) {
  const avatarUri = useMemo(() => getAvatar(name, 28), [name]);
  const dotColor = ROLE_DOT[role] ?? '#64748b';
  const roleLabel = ROLE_LABELS[role] ?? role;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
      <img src={avatarUri} alt="" className="w-6 h-6 rounded-full shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-slate-300 truncate">{name}</div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dotColor }} />
        <span className="text-[9px] text-slate-600">{roleLabel}</span>
      </div>
    </div>
  );
}

/* ── 2D Office Preview (SVG with furniture + employees) ── */

function Office2DPreview({ employees }: { employees: CompanyTemplate['employees'] }) {
  const SCALE = 8;
  const W = 360;
  const H = 240;
  const ox = W / 2;
  const oy = H / 2 - 5;

  // Place employees into zones
  const empByZone = useMemo(() => {
    const map = new Map<string, typeof employees>();
    for (const emp of employees) {
      const zoneId = resolveZoneForRole(emp.role_slug);
      const list = map.get(zoneId) ?? [];
      list.push(emp);
      map.set(zoneId, list);
    }
    return map;
  }, [employees]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-h-[400px]">
      {/* Background */}
      <rect width={W} height={H} fill="#060a14" rx={6} />

      {/* Subtle grid */}
      <defs>
        <pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="8" cy="8" r="0.3" fill="#1e293b" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" rx={6} />

      {/* Zones */}
      {ZONES.map((z) => {
        const x = ox + z.cx * SCALE - (z.w * SCALE) / 2;
        const y = oy + z.cz * SCALE - (z.d * SCALE) / 2;
        const w = z.w * SCALE;
        const h = z.d * SCALE;
        const zoneEmps = empByZone.get(z.id) ?? [];

        return (
          <g key={z.id}>
            {/* Zone background */}
            <rect x={x} y={y} width={w} height={h} rx={4}
              fill={z.accent + '06'} stroke={z.accent} strokeWidth={0.8} strokeOpacity={0.25} />

            {/* Zone label */}
            <text x={x + 6} y={y + 10} fontSize={6} fill={z.accent} opacity={0.4}
              fontFamily="system-ui" fontWeight={600}>{z.label}</text>

            {/* Desk shapes (small rectangles) */}
            {z.deskSlots > 0 && Array.from({ length: Math.min(z.deskSlots, 4) }, (_, i) => {
              const dw = 14; const dh = 8;
              const cols = 2;
              const row = Math.floor(i / cols);
              const col = i % cols;
              const dx = x + 8 + col * (dw + 6);
              const dy = y + 16 + row * (dh + 10);
              return (
                <g key={i}>
                  <rect x={dx} y={dy} width={dw} height={dh} rx={1.5}
                    fill="#1e293b" stroke="#334155" strokeWidth={0.4} />
                  {/* Monitor on desk */}
                  <rect x={dx + 4} y={dy + 1} width={6} height={3} rx={0.5} fill="#0f172a" stroke="#475569" strokeWidth={0.3} />
                </g>
              );
            })}

            {/* Employee avatars in zone */}
            {zoneEmps.slice(0, 4).map((emp, i) => {
              const cols = 2;
              const row = Math.floor(i / cols);
              const col = i % cols;
              const ex = x + 12 + col * 20 + 14;
              const ey = y + 22 + row * 18;
              const dotColor = ROLE_DOT[emp.role_slug] ?? '#64748b';
              return (
                <g key={emp.name}>
                  <circle cx={ex} cy={ey} r={4.5} fill="#0f172a" stroke={dotColor} strokeWidth={0.6} />
                  <text x={ex} y={ey + 1.5} textAnchor="middle" fontSize={3.5} fill="#e2e8f0"
                    fontFamily="system-ui" fontWeight={500}>
                    {emp.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
