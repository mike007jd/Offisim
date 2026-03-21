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
    runtimeReady,
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
          <button type="button" onClick={create} disabled={!selectedTemplateId || step === 'creating' || !runtimeReady}
            className="w-full rounded-lg bg-blue-600 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-30 transition-colors">
            {step === 'creating'
              ? <span className="flex items-center justify-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Setting up...</span>
              : !runtimeReady
                ? <span className="flex items-center justify-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Initializing...</span>
                : 'Start Company'}
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
        <div className="w-64 shrink-0 border-l border-white/[0.06] flex flex-col overflow-y-auto p-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Team · {template.employees.length}
          </h3>
          <div className="space-y-2">
            {template.employees.map((emp) => (
              <EmployeeCard key={emp.name} name={emp.name} role={emp.role_slug} />
            ))}
          </div>

          {template.sops.length > 0 && (
            <>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 mt-5">
                Workflows · {template.sops.length}
              </h3>
              <div className="space-y-2">
                {template.sops.map((sop) => (
                  <div key={sop.sop_id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                    <div className="text-xs text-slate-400 truncate">{sop.name}</div>
                    <div className="text-[10px] text-slate-600 mt-0.5">{sop.steps.length} steps</div>
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

/* ── Employee card with DiceBear (larger, more prominent) ── */

function EmployeeCard({ name, role }: { name: string; role: string }) {
  const avatarUri = useMemo(() => getAvatar(name, 48), [name]);
  const dotColor = ROLE_DOT[role] ?? '#64748b';
  const roleLabel = ROLE_LABELS[role] ?? role;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 hover:bg-white/[0.05] transition-colors">
      <div className="relative shrink-0">
        <img src={avatarUri} alt="" className="w-10 h-10 rounded-full" />
        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#060a14]"
          style={{ backgroundColor: dotColor }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-200 truncate">{name}</div>
        <div className="text-xs text-slate-500 mt-0.5">{roleLabel}</div>
      </div>
    </div>
  );
}

/* ── SVG Furniture for Preview (simplified versions matching Office2DView style) ── */

function PreviewDeskCluster({ x, y }: { x: number; y: number }) {
  // 4-seat desk cluster with glass partition cross, laptops, and chairs
  const S = 28; // cluster size
  const half = S / 2;
  const wsOff = 7;   // workstation offset from center
  const chairOff = 14; // chair offset from center
  const seats: [number, number, number][] = [
    [-wsOff, -wsOff, -chairOff],
    [wsOff, -wsOff, -chairOff],
    [-wsOff, wsOff, chairOff],
    [wsOff, wsOff, chairOff],
  ];
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Desk surface */}
      <rect x={-half} y={-half} width={S} height={S} rx={1.5} fill="#e2e8f0" stroke="#cbd5e1" strokeWidth={0.3} />
      {/* Glass partition cross */}
      <line x1="0" y1={-half} x2="0" y2={half} stroke="#94a3b8" strokeWidth={0.5} strokeOpacity={0.5} />
      <line x1={-half} y1="0" x2={half} y2="0" stroke="#94a3b8" strokeWidth={0.5} strokeOpacity={0.5} />
      {/* Workstations + chairs */}
      {seats.map(([dx, dz, cdz], i) => (
        <g key={i}>
          {/* Laptop on desk */}
          <rect x={dx - 2} y={dz - 1} width={4} height={2} rx={0.3} fill="#334155" />
          {/* Screen */}
          <rect x={dx - 3} y={dz < 0 ? dz - 3 : dz + 1} width={6} height={1.2} rx={0.2} fill="#0ea5e9" opacity={0.5} />
          {/* Chair */}
          <circle cx={dx} cy={cdz} r={2.2} fill="#1e293b" stroke="#334155" strokeWidth={0.2} />
        </g>
      ))}
    </g>
  );
}

function PreviewMeetingTable({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Conference table */}
      <rect x={-18} y={-6} width={36} height={12} rx={3.5} fill="#1e293b" stroke="#334155" strokeWidth={0.3} />
      {/* Inner surface */}
      <rect x={-15} y={-4} width={30} height={8} rx={2} fill="#0f172a" />
      {/* Chairs — 4 on each side */}
      {[-11, -4, 4, 11].map((cx, i) => (
        <g key={i}>
          <circle cx={cx} cy={-9.5} r={2} fill="#0f172a" stroke="#334155" strokeWidth={0.2} />
          <circle cx={cx} cy={9.5} r={2} fill="#0f172a" stroke="#334155" strokeWidth={0.2} />
        </g>
      ))}
      {/* Whiteboard on left */}
      <rect x={-26} y={-4} width={1.2} height={8} rx={0.3} fill="#f1f5f9" stroke="#94a3b8" strokeWidth={0.15} />
    </g>
  );
}

function PreviewBookshelf({ x, y }: { x: number; y: number }) {
  const bookColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#a855f7', '#06b6d4'];
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Shelf frame */}
      <rect x={-5} y={-6} width={10} height={12} rx={0.5} fill="#1e293b" stroke="#334155" strokeWidth={0.2} />
      {/* 3 shelves with books */}
      {[0, 1, 2].map(shelf => (
        <g key={shelf}>
          <rect x={-4.5} y={-5 + shelf * 4} width={9} height={0.2} fill="#334155" />
          {[0, 1, 2, 3, 4].map(b => (
            <rect key={b} x={-4 + b * 1.6} y={-4.5 + shelf * 4} width={1.2} height={3} rx={0.1}
              fill={bookColors[(shelf * 5 + b) % bookColors.length]} />
          ))}
        </g>
      ))}
    </g>
  );
}

function PreviewReadingTable({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Table */}
      <rect x={-10} y={-4} width={20} height={8} rx={1} fill="#064e3b" stroke="#334155" strokeWidth={0.2} />
      {/* 2 chairs per side */}
      {[-5, 5].map((cx, i) => (
        <g key={i}>
          <circle cx={cx} cy={-6.5} r={1.8} fill="#0f172a" stroke="#334155" strokeWidth={0.15} />
          <circle cx={cx} cy={6.5} r={1.8} fill="#0f172a" stroke="#334155" strokeWidth={0.15} />
        </g>
      ))}
    </g>
  );
}

function PreviewSofa({ x, y, color = '#f59e0b' }: { x: number; y: number; color?: string }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Sofa body */}
      <path d="M-9,-3.5 L9,-3.5 L9,1.5 L5,1.5 L5,-1 L-5,-1 L-5,1.5 L-9,1.5 Z" fill={color} />
      {/* Arm rests */}
      <rect x={-10.5} y={-3.5} width={2} height={5} rx={0.8} fill="#0f172a" />
      <rect x={8.5} y={-3.5} width={2} height={5} rx={0.8} fill="#0f172a" />
    </g>
  );
}

function PreviewCoffeeTable({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle cx="0" cy="0" r={4.5} fill="#1e293b" stroke="#334155" strokeWidth={0.2} />
      <circle cx="0" cy="0" r={2} fill="#0f172a" />
    </g>
  );
}

function PreviewServerRack({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Rack frame */}
      <rect x={-3.5} y={-8} width={7} height={16} rx={0.5} fill="#0f172a" stroke="#1e293b" strokeWidth={0.3} />
      {/* Server units with LED indicators */}
      {Array.from({ length: 6 }, (_, i) => (
        <g key={i}>
          <rect x={-2.8} y={-7 + i * 2.5} width={5.6} height={2} rx={0.2} fill="#0c1220" />
          <circle cx={1.5} cy={-6 + i * 2.5} r={0.4} fill={i % 3 === 0 ? '#fbbf24' : '#22c55e'} />
        </g>
      ))}
    </g>
  );
}

function PreviewVendingMachine({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x={-3} y={-5.5} width={6} height={11} rx={0.7} fill="#1e293b" stroke="#334155" strokeWidth={0.2} />
      <rect x={-2.2} y={-4.5} width={4.4} height={4.5} rx={0.3} fill="#0ea5e9" opacity={0.4} />
      <rect x={-1.8} y={1} width={3.6} height={1.5} rx={0.3} fill="#0f172a" />
    </g>
  );
}

function PreviewPlant({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Pot */}
      <circle cx="0" cy="1" r={2.2} fill="#334155" stroke="#475569" strokeWidth={0.15} />
      {/* Leaves */}
      {[0, 72, 144, 216, 288].map(angle => (
        <path key={angle} d="M0,0 C-2,-3.5 2,-3.5 0,0" fill="#10b981"
          transform={`rotate(${angle})`} />
      ))}
    </g>
  );
}

/* ── Employee avatar in floor plan ── */

function PreviewEmployeeAvatar({ x, y, name, role }: { x: number; y: number; name: string; role: string }) {
  const avatarUri = useMemo(() => getAvatar(name, 32), [name]);
  const dotColor = ROLE_DOT[role] ?? '#64748b';
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2);
  return (
    <g transform={`translate(${x}, ${y})`}>
      {/* Status aura */}
      <circle cx="0" cy="0" r={5} fill={dotColor} opacity={0.12} />
      {/* Avatar bg */}
      <circle cx="0" cy="0" r={4} fill="#1e293b" stroke={dotColor} strokeWidth={0.5} />
      {/* Avatar image */}
      <image href={avatarUri} x={-3.2} y={-3.2} width={6.4} height={6.4}
        clipPath={`circle(3.2px at 3.2px 3.2px)`} />
      {/* Fallback initials (renders under image, visible if image fails) */}
      <text x="0" y="1.5" textAnchor="middle" fontSize={3} fill="#e2e8f0"
        fontFamily="system-ui" fontWeight={600} style={{ pointerEvents: 'none' }}>
        {initials}
      </text>
      {/* Name plate */}
      <g transform="translate(0, 6.5)">
        <rect x={-8} y={-2} width={16} height={4} rx={2} fill="#0f172a" opacity={0.8} />
        <text x="0" y="0.8" fill="#f8fafc" fontSize={2.2} fontWeight={600} textAnchor="middle"
          fontFamily="system-ui">{name.split(' ')[0]}</text>
      </g>
    </g>
  );
}

/* ── 2D Office Preview (SVG with real furniture + employee avatars) ── */

function Office2DPreview({ employees }: { employees: CompanyTemplate['employees'] }) {
  const SCALE = 8;
  const W = 380;
  const H = 260;
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

  /** Convert zone def to SVG coordinates */
  function zoneToSVG(z: typeof ZONES[number]) {
    const x = ox + z.cx * SCALE - (z.w * SCALE) / 2;
    const y = oy + z.cz * SCALE - (z.d * SCALE) / 2;
    const w = z.w * SCALE;
    const h = z.d * SCALE;
    const mx = x + w / 2;
    const my = y + h / 2;
    return { x, y, w, h, mx, my };
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-h-[440px]">
      {/* Background */}
      <rect width={W} height={H} fill="#060a14" rx={6} />

      {/* Subtle dot grid */}
      <defs>
        <pattern id="wiz-grid" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="8" cy="8" r="0.25" fill="#1e293b" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#wiz-grid)" rx={6} />

      {/* ── Zone backgrounds + labels ── */}
      {ZONES.map((z) => {
        const s = zoneToSVG(z);
        return (
          <g key={z.id}>
            {/* Zone fill */}
            <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={3}
              fill={z.accent} fillOpacity={0.04}
              stroke={z.accent} strokeWidth={0.6}
              strokeOpacity={0.2}
              strokeDasharray={z.type === 'infra' ? '3 1.5' : 'none'} />
            {/* Zone label — top-left corner */}
            <text x={s.x + 4} y={s.y + 7} fontSize={4.5} fill={z.accent} opacity={0.5}
              fontFamily="system-ui" fontWeight={700} letterSpacing={1}>
              {z.label}
            </text>
          </g>
        );
      })}

      {/* ── Meeting Room (mtg) — conference table + whiteboard ── */}
      {(() => {
        const s = zoneToSVG(ZONES.find(z => z.id === 'mtg')!);
        return (
          <g>
            <PreviewMeetingTable x={s.mx} y={s.my + 3} />
          </g>
        );
      })()}

      {/* ── Server Room (srv) — 3 racks + cable channels + cyan glow ── */}
      {(() => {
        const s = zoneToSVG(ZONES.find(z => z.id === 'srv')!);
        return (
          <g>
            {/* Subtle glow */}
            <circle cx={s.mx} cy={s.my} r={18} fill="#06b6d4" opacity={0.03} />
            {/* Server racks */}
            {[-20, 0, 20].map((dx, i) => (
              <PreviewServerRack key={i} x={s.mx + dx} y={s.my} />
            ))}
            {/* Cable channels */}
            {[-10, 10].map((dx, i) => (
              <rect key={`c${i}`} x={s.mx + dx - 0.5} y={s.my + 9} width={1} height={10}
                rx={0.3} fill="#0c4a6e" opacity={0.35} />
            ))}
          </g>
        );
      })()}

      {/* ── Library (lib) — bookshelves + reading tables + plant ── */}
      {(() => {
        const s = zoneToSVG(ZONES.find(z => z.id === 'lib')!);
        return (
          <g>
            {/* 4 bookshelves along top */}
            {[-22, -9, 4, 17].map((dx, i) => (
              <PreviewBookshelf key={i} x={s.mx + dx} y={s.y + 12} />
            ))}
            {/* 2 reading tables */}
            <PreviewReadingTable x={s.mx - 14} y={s.my + 10} />
            <PreviewReadingTable x={s.mx + 14} y={s.my + 10} />
            {/* Plant */}
            <PreviewPlant x={s.x + s.w - 5} y={s.y + 5} />
          </g>
        );
      })()}

      {/* ── Rest Area (rest) — sofas + coffee table + vending machine + plants ── */}
      {(() => {
        const s = zoneToSVG(ZONES.find(z => z.id === 'rest')!);
        return (
          <g>
            {/* Carpet */}
            <rect x={s.mx - 25} y={s.my - 10} width={50} height={22} rx={2} fill="#334155" opacity={0.15} />
            {/* Sofas */}
            <PreviewSofa x={s.mx - 5} y={s.my - 6} />
            <PreviewSofa x={s.mx + 5} y={s.my + 8} color="#d97706" />
            {/* Coffee table */}
            <PreviewCoffeeTable x={s.mx} y={s.my + 1} />
            {/* Vending machine */}
            <PreviewVendingMachine x={s.x + s.w - 8} y={s.my - 5} />
            {/* Plants */}
            <PreviewPlant x={s.x + 4} y={s.y + 5} />
            <PreviewPlant x={s.x + s.w - 5} y={s.y + s.h - 5} />
          </g>
        );
      })()}

      {/* ── Department zones: desk clusters + employees ── */}
      {(['dev', 'prod', 'art'] as const).map(id => {
        const z = ZONES.find(zz => zz.id === id)!;
        const s = zoneToSVG(z);
        const zoneEmps = empByZone.get(id) ?? [];

        return (
          <g key={id}>
            {/* Desk cluster in center of zone */}
            <PreviewDeskCluster x={s.mx} y={s.my + 2} />

            {/* Employee avatars seated at desks */}
            {zoneEmps.slice(0, 4).map((emp, i) => {
              const cols = 2;
              const row = Math.floor(i / cols);
              const col = i % cols;
              // Position employees at chair positions around the desk cluster
              const chairOff = 14;
              const wsOff = 7;
              const ex = s.mx + (col === 0 ? -wsOff : wsOff);
              const ey = s.my + 2 + (row === 0 ? -chairOff : chairOff);
              return (
                <PreviewEmployeeAvatar
                  key={emp.name}
                  x={ex} y={ey}
                  name={emp.name}
                  role={emp.role_slug}
                />
              );
            })}
          </g>
        );
      })}

      {/* ── Corner plants ── */}
      <PreviewPlant x={12} y={12} />
      <PreviewPlant x={W - 12} y={12} />
      <PreviewPlant x={12} y={H - 12} />
      <PreviewPlant x={W - 12} y={H - 12} />
    </svg>
  );
}
