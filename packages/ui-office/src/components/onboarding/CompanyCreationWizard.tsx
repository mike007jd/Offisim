import {
  FlaskConical, PenTool, Rocket, Briefcase, Brain,
  Loader2, ChevronDown, ChevronUp, Building2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CompanyTemplate } from '@aics/core/browser';
import { createAvatar } from '@dicebear/core';
import { avataaars } from '@dicebear/collection';
import { useCompanyCreation } from '../../hooks/useCompanyCreation.js';
import { resolveZone } from '../../lib/zone-config.js';

/* ══════════════════════════════════════════════════════════════════════════
   Template metadata — UI-only, not stored in core
   ══════════════════════════════════════════════════════════════════════════ */

interface TemplateMeta {
  icon: ReactNode;
  iconLg: ReactNode;
  accent: string;
  accentHex: string;
  accentBg: string;
  tagline: string;
  bestFor: string[];
  complexity: number;
  capabilities: string[];
  gradient: string;
}

const TMPL: Record<string, TemplateMeta> = {
  'rd-company': {
    icon: <FlaskConical className="h-4 w-4" />,
    iconLg: <FlaskConical className="h-8 w-8" />,
    accent: 'text-blue-400',
    accentHex: '#3b82f6',
    accentBg: 'bg-blue-500/10 border-blue-500/30',
    tagline: 'Build software with a full engineering team',
    bestFor: ['Software Development', 'Full Stack', 'Enterprise'],
    complexity: 4,
    capabilities: ['Full-stack development', 'Code review & testing', 'Technical documentation'],
    gradient: 'from-blue-500/20 via-blue-600/10 to-transparent',
  },
  'content-studio': {
    icon: <PenTool className="h-4 w-4" />,
    iconLg: <PenTool className="h-8 w-8" />,
    accent: 'text-emerald-400',
    accentHex: '#10b981',
    accentBg: 'bg-emerald-500/10 border-emerald-500/30',
    tagline: 'Create, edit, and publish content at scale',
    bestFor: ['Content Marketing', 'Publishing', 'Creative'],
    complexity: 2,
    capabilities: ['Article & blog writing', 'Design & illustration', 'Editorial workflow'],
    gradient: 'from-emerald-500/20 via-emerald-600/10 to-transparent',
  },
  'product-team': {
    icon: <Rocket className="h-4 w-4" />,
    iconLg: <Rocket className="h-8 w-8" />,
    accent: 'text-violet-400',
    accentHex: '#8b5cf6',
    accentBg: 'bg-violet-500/10 border-violet-500/30',
    tagline: 'Design and ship products from research to launch',
    bestFor: ['Product Strategy', 'Design Thinking', 'Agile'],
    complexity: 3,
    capabilities: ['User research', 'Product strategy', 'Design prototyping'],
    gradient: 'from-violet-500/20 via-violet-600/10 to-transparent',
  },
  'agency-lite': {
    icon: <Briefcase className="h-4 w-4" />,
    iconLg: <Briefcase className="h-8 w-8" />,
    accent: 'text-amber-400',
    accentHex: '#f59e0b',
    accentBg: 'bg-amber-500/10 border-amber-500/30',
    tagline: 'Lean team for client projects and quick deliveries',
    bestFor: ['Client Work', 'Freelance', 'Fast Delivery'],
    complexity: 2,
    capabilities: ['Fast turnaround', 'Multi-client support', 'Flexible roles'],
    gradient: 'from-amber-500/20 via-amber-600/10 to-transparent',
  },
  'ai-startup': {
    icon: <Brain className="h-4 w-4" />,
    iconLg: <Brain className="h-8 w-8" />,
    accent: 'text-cyan-400',
    accentHex: '#06b6d4',
    accentBg: 'bg-cyan-500/10 border-cyan-500/30',
    tagline: 'Research-first team pushing the boundaries of AI',
    bestFor: ['Machine Learning', 'Research', 'Data Science'],
    complexity: 5,
    capabilities: ['ML research', 'Data analysis', 'Rapid prototyping'],
    gradient: 'from-cyan-500/20 via-cyan-600/10 to-transparent',
  },
};

/* ══════════════════════════════════════════════════════════════════════════
   Role labels — human-readable, with department colors
   ══════════════════════════════════════════════════════════════════════════ */

const ROLE_LABELS: Record<string, string> = {
  developer: 'Lead Developer',
  frontend: 'Frontend Engineer',
  backend: 'Backend Engineer',
  fullstack: 'Full Stack Engineer',
  pm: 'Product Manager',
  product_manager: 'Product Manager',
  analyst: 'Data Analyst',
  designer: 'UI/UX Designer',
  ui_designer: 'UI Designer',
  artist: 'Visual Artist',
  researcher: 'Research Scientist',
  devops: 'DevOps Engineer',
  manager: 'Team Manager',
  qa: 'QA Engineer',
  engineering_manager: 'Engineering Manager',
};

const ROLE_DOT: Record<string, string> = {
  developer: '#3b82f6', backend: '#3b82f6', frontend: '#60a5fa', fullstack: '#60a5fa',
  pm: '#8b5cf6', product_manager: '#8b5cf6', manager: '#a78bfa',
  designer: '#f59e0b', ui_designer: '#fbbf24', artist: '#f97316',
  analyst: '#10b981', qa: '#34d399', researcher: '#06b6d4',
  devops: '#94a3b8', engineering_manager: '#a78bfa',
};

/* ══════════════════════════════════════════════════════════════════════════
   Employee bios — personality and expertise for character profiles
   ══════════════════════════════════════════════════════════════════════════ */

interface EmployeeBio {
  bio: string;
  expertise: string[];
  style: string;
  helpsWith: string;
}

const EMPLOYEE_BIOS: Record<string, EmployeeBio> = {
  // ── R&D Company ──
  'Alex Chen':      { bio: 'Architectural thinker who loves clean code', expertise: ['System Design', 'TypeScript', 'Testing'], style: 'Methodical', helpsWith: 'Complex system architecture, code organization, and technical leadership across the full stack.' },
  'Maya Lin':       { bio: 'Pixel-perfect UI with a passion for animation', expertise: ['React', 'CSS', 'Animation'], style: 'Creative', helpsWith: 'Beautiful user interfaces, smooth interactions, and accessible component design.' },
  'Marcus Johnson': { bio: 'Database whisperer and API craftsman', expertise: ['PostgreSQL', 'APIs', 'DevOps'], style: 'Reliable', helpsWith: 'Scalable backend systems, database optimization, and robust infrastructure.' },
  'Kai Nakamura':   { bio: 'Bridge builder between frontend and backend', expertise: ['TypeScript', 'APIs', 'Monorepos'], style: 'Collaborative', helpsWith: 'Cross-stack integration, API contracts, and developer tooling.' },
  'Sophie Park':    { bio: 'Turns chaos into roadmaps', expertise: ['Strategy', 'User Research', 'OKRs'], style: 'Strategic', helpsWith: 'Product vision, requirement analysis, and stakeholder alignment.' },
  'Ryan Torres':    { bio: 'Finds the story hidden in the data', expertise: ['Analytics', 'SQL', 'Dashboards'], style: 'Analytical', helpsWith: 'Data-driven decisions, quality assurance, and performance analysis.' },
  'Zara Okafor':    { bio: 'Makes complex things feel simple', expertise: ['Figma', 'UX Research', 'Design Systems'], style: 'Empathetic', helpsWith: 'User experience design, interaction patterns, and design system development.' },
  'Jamie Reeves':   { bio: 'Typography nerd and accessibility advocate', expertise: ['Visual Design', 'Motion', 'Branding'], style: 'Experimental', helpsWith: 'Visual identity, micro-interactions, and scalable asset pipelines.' },

  // ── Content Studio ──
  'Dana Rivera':    { bio: 'Investigative mind with a nose for truth', expertise: ['Research', 'Analysis', 'Fact-checking'], style: 'Thorough', helpsWith: 'Deep research, source verification, and comprehensive briefing documents.' },
  'Leo Zhang':      { bio: 'Words that hook readers and never let go', expertise: ['Copywriting', 'Storytelling', 'SEO'], style: 'Versatile', helpsWith: 'Compelling content drafts, audience-tuned copy, and narrative structure.' },
  'Carmen Flores':  { bio: 'Editor with a sixth sense for weak prose', expertise: ['Editing', 'Style Guides', 'Publishing'], style: 'Sharp', helpsWith: 'Editorial polish, voice consistency, and publication-ready quality.' },
  'Priya Sharma':   { bio: 'Connects every piece to business impact', expertise: ['Content Strategy', 'Analytics', 'Auditing'], style: 'Strategic', helpsWith: 'Content performance analysis, strategic alignment, and quality standards.' },
  'Marco Rossi':    { bio: 'SEO wizard who thinks in search intent', expertise: ['SEO', 'Distribution', 'Analytics'], style: 'Data-driven', helpsWith: 'Search optimization, content formatting, and multi-channel distribution.' },

  // ── Product Team ──
  'Ava Mitchell':   { bio: 'Specs so clear they practically code themselves', expertise: ['PRDs', 'Prioritization', 'User Stories'], style: 'Precise', helpsWith: 'Requirements engineering, edge case identification, and acceptance criteria.' },
  'Noah Kim':       { bio: 'Designs systems that age like fine wine', expertise: ['Architecture', 'APIs', 'Databases'], style: 'Thoughtful', helpsWith: 'Technical architecture, data modeling, and scalable API design.' },
  'Elena Volkov':   { bio: 'Ships clean code with tests on day one', expertise: ['React', 'Testing', 'TypeScript'], style: 'Disciplined', helpsWith: 'Production-grade implementation with comprehensive test coverage.' },
  'Raj Patel':      { bio: 'Reviews code like a security auditor', expertise: ['Code Review', 'Security', 'Performance'], style: 'Rigorous', helpsWith: 'Code quality analysis, security auditing, and performance profiling.' },

  // ── Agency Lite ──
  'Nina Vasquez':   { bio: 'Clients trust her before they trust the work', expertise: ['Client Relations', 'Proposals', 'SOWs'], style: 'Diplomatic', helpsWith: 'Client communication, expectation management, and project handoffs.' },
  'Ray Chen':       { bio: 'Juggles five projects without dropping one', expertise: ['Project Management', 'Agile', 'Scheduling'], style: 'Organized', helpsWith: 'Multi-project coordination, deadline tracking, and team workload balance.' },
  'Amara Obi':      { bio: 'Bold visuals that stop the scroll', expertise: ['Brand Identity', 'Layout', 'Campaign Design'], style: 'Bold', helpsWith: 'Visual design, creative direction, and brand-aligned campaign assets.' },
  'Liam Burke':     { bio: 'Ships demos before you finish the brief', expertise: ['React', 'CMS', 'Landing Pages'], style: 'Pragmatic', helpsWith: 'Rapid prototyping, client demos, and production deployments.' },
  'Suki Tanaka':    { bio: 'Catches the bug you didn\'t know existed', expertise: ['QA', 'Accessibility', 'Cross-browser'], style: 'Meticulous', helpsWith: 'Quality assurance, brand compliance, and cross-platform testing.' },

  // ── AI Startup ──
  'Dmitri Volkov':  { bio: 'Reads papers for breakfast, writes them for lunch', expertise: ['Transformers', 'PyTorch', 'Research'], style: 'Rigorous', helpsWith: 'ML research, experiment design, and architecture innovation.' },
  'Aria Patel':     { bio: 'Obsessed with shaving milliseconds off inference', expertise: ['Model Serving', 'Optimization', 'GPUs'], style: 'Performance-driven', helpsWith: 'Inference optimization, model fine-tuning, and serving infrastructure.' },
  'Leo Chen':       { bio: 'Builds pipelines that never break at 3AM', expertise: ['Data Pipelines', 'Vector DBs', 'ETL'], style: 'Systematic', helpsWith: 'Data engineering, pipeline reliability, and ML infrastructure.' },
  'Sam Rivera':     { bio: 'Translates ML magic into product value', expertise: ['AI Products', 'User Research', 'Pricing'], style: 'Visionary', helpsWith: 'AI product strategy, responsible AI practices, and market positioning.' },
  'Nia Williams':   { bio: 'Makes AI feel natural in the interface', expertise: ['Streaming UI', 'React', 'WebSockets'], style: 'User-focused', helpsWith: 'AI-powered UIs, real-time interfaces, and graceful error handling.' },
  'Chloe Kim':      { bio: 'Designs trust into every AI interaction', expertise: ['AI UX', 'Data Viz', 'Explainability'], style: 'Trust-first', helpsWith: 'AI interaction design, confidence displays, and human-AI collaboration patterns.' },
};

/* ══════════════════════════════════════════════════════════════════════════
   Zone tooltips
   ══════════════════════════════════════════════════════════════════════════ */

const ZONE_TOOLTIPS: Record<string, string> = {
  mtg: 'Where your team aligns on priorities',
  srv: 'AI model inference & MCP integrations',
  lib: 'Knowledge base and document storage',
  rest: 'Where creative ideas happen',
  dev: 'Where code gets written',
  prod: 'Strategy and planning hub',
  art: 'Visual creation workspace',
};

/* ══════════════════════════════════════════════════════════════════════════
   Avatar cache
   ══════════════════════════════════════════════════════════════════════════ */

const avatarCache = new Map<string, string>();
function getAvatar(seed: string, size = 32): string {
  const key = `${seed}-${size}`;
  const cached = avatarCache.get(key);
  if (cached) return cached;
  const uri = createAvatar(avataaars, { seed, size }).toDataUri();
  avatarCache.set(key, uri);
  return uri;
}

/* ══════════════════════════════════════════════════════════════════════════
   CSS Keyframes — injected once
   ══════════════════════════════════════════════════════════════════════════ */

const KEYFRAMES_ID = 'wizard-keyframes';
function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = `
    @keyframes wiz-glow-pulse {
      0%, 100% { opacity: 0.2; }
      50% { opacity: 0.45; }
    }
    @keyframes wiz-idle-bob {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-0.8px); }
    }
    @keyframes wiz-card-in {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes wiz-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes wiz-slide-up {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes wiz-building-pulse {
      0%, 100% { transform: scale(1); opacity: 0.8; }
      50% { transform: scale(1.08); opacity: 1; }
    }
    @keyframes wiz-cta-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4); }
      50% { box-shadow: 0 0 20px 4px rgba(59, 130, 246, 0.15); }
    }
    @keyframes wiz-step-flow {
      from { width: 0; }
      to { width: 100%; }
    }
    @keyframes wiz-icon-glow {
      0%, 100% { filter: drop-shadow(0 0 6px currentColor); }
      50% { filter: drop-shadow(0 0 16px currentColor); }
    }
  `;
  document.head.appendChild(style);
}

/* ══════════════════════════════════════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════════════════════════════════════ */

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
    if (!selectedTemplateId && templates.length > 0) setSelectedTemplateId(templates[0]!.id);
  }, [selectedTemplateId, templates, setSelectedTemplateId]);

  useEffect(() => { ensureKeyframes(); }, []);

  if (step === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-[#02040a]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
          <p className="text-xs text-slate-600">Loading templates...</p>
        </div>
      </div>
    );
  }
  if (step === 'ready') return null;

  const selected = templates.find((t) => t.id === selectedTemplateId);
  const meta = selected ? TMPL[selected.id] : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#02040a] overflow-hidden">
      {/* Background dot grid */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'radial-gradient(circle, #1e293b 0.5px, transparent 0.5px)',
        backgroundSize: '24px 24px',
      }} />

      {/* ── Header ── */}
      <div className="relative z-10 px-6 pt-5 pb-4 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <Building2 className="h-5 w-5 text-slate-400" />
          <h1 className="text-lg font-bold text-white tracking-tight">New Company</h1>
        </div>
        <p className="text-xs text-slate-500 mt-1">Select a template to build your AI company around</p>
      </div>

      {/* ── Template selector tabs ── */}
      <div className="relative z-10 px-6 pt-4 pb-2">
        <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
          {templates.map((t) => {
            const m = TMPL[t.id];
            const active = selectedTemplateId === t.id;
            if (!m) return null;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedTemplateId(t.id)}
                className={`shrink-0 flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-300 border ${
                  active
                    ? `${m.accentBg} shadow-lg`
                    : 'border-transparent bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.08]'
                }`}
                style={active ? { boxShadow: `0 0 24px 2px ${m.accentHex}15` } : undefined}
              >
                <div className={`shrink-0 ${active ? m.accent : 'text-slate-600'} transition-colors duration-300`}
                  style={active ? { animation: 'wiz-icon-glow 3s ease-in-out infinite' } : undefined}>
                  {m.icon}
                </div>
                <div className="text-left">
                  <div className={`text-xs font-semibold ${active ? 'text-white' : 'text-slate-400'} transition-colors`}>
                    {t.name}
                  </div>
                  <div className="text-[10px] text-slate-600">{t.employees.length} members</div>
                </div>
                {active && (
                  <div className="flex gap-0.5 ml-1">
                    {Array.from({ length: 5 }, (_, i) => (
                      <div key={i} className={`w-1.5 h-1.5 rounded-full ${
                        i < m.complexity ? 'bg-current' : 'bg-white/10'
                      }`} style={{ color: i < m.complexity ? m.accentHex : undefined }} />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="relative z-10 flex-1 overflow-y-auto px-6 pb-4">
        {selected && meta ? (
          <div key={selected.id} style={{ animation: 'wiz-fade-in 0.4s ease-out' }}>
            <TemplateHero template={selected} meta={meta} />
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center py-20">
            <p className="text-sm text-slate-700">Select a template above</p>
          </div>
        )}
      </div>

      {/* ── Bottom CTA bar ── */}
      <div className="relative z-10 border-t border-white/[0.06] bg-black/60 backdrop-blur-xl px-6 py-4">
        {step === 'creating' ? (
          <BuildingAnimation />
        ) : (
          <div className="flex items-center gap-4 max-w-3xl mx-auto">
            <div className="flex-1">
              <label htmlFor="company-name" className="text-[10px] font-medium text-slate-500 uppercase tracking-wider block mb-1.5">
                Company Name
              </label>
              <input
                id="company-name"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="My AI Company"
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm text-white placeholder:text-slate-700 focus:outline-none focus:border-blue-500/40 transition-all focus:shadow-[0_0_16px_2px_rgba(59,130,246,0.1)]"
              />
            </div>
            <button
              type="button"
              onClick={create}
              disabled={!selectedTemplateId || !runtimeReady}
              className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-8 py-3 text-sm font-semibold text-white hover:from-blue-500 hover:to-blue-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all mt-5"
              style={
                runtimeReady && selectedTemplateId
                  ? { animation: 'wiz-cta-pulse 3s ease-in-out infinite' }
                  : undefined
              }
            >
              {!runtimeReady ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Initializing...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Start Company
                </span>
              )}
            </button>
          </div>
        )}
        {error && <p className="text-xs text-red-400 text-center mt-2">{error}</p>}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Building animation — shown during company creation
   ══════════════════════════════════════════════════════════════════════════ */

function BuildingAnimation() {
  return (
    <div className="flex flex-col items-center gap-3 py-2" style={{ animation: 'wiz-fade-in 0.5s ease-out' }}>
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
        <span className="text-sm font-medium text-white" style={{ animation: 'wiz-building-pulse 2s ease-in-out infinite' }}>
          Building your office...
        </span>
      </div>
      <p className="text-[10px] text-slate-600">Setting up employees, workflows, and office layout</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Template Hero — expanded detail view for the selected template
   ══════════════════════════════════════════════════════════════════════════ */

function TemplateHero({ template, meta }: { template: CompanyTemplate; meta: TemplateMeta }) {
  return (
    <div className="space-y-5 pt-2">
      {/* ── Hero banner ── */}
      <div className={`relative rounded-2xl border border-white/[0.06] overflow-hidden bg-gradient-to-br ${meta.gradient}`}>
        <div className="px-6 py-5 flex items-start gap-5">
          <div className={`shrink-0 w-14 h-14 rounded-xl border flex items-center justify-center ${meta.accentBg}`}
            style={{ animation: 'wiz-icon-glow 3s ease-in-out infinite' }}>
            <div className={meta.accent}>{meta.iconLg}</div>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-white">{template.name}</h2>
            <p className="text-sm text-slate-400 mt-0.5">{meta.tagline}</p>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {meta.bestFor.map((tag) => (
                <span key={tag} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-400 border border-white/[0.06]">
                  {tag}
                </span>
              ))}
              <span className="text-[10px] text-slate-600 ml-1">
                {template.employees.length} members
              </span>
              <span className="text-[10px] text-slate-700 mx-1">/</span>
              <span className="text-[10px] text-slate-600">
                {template.sops.length} workflow{template.sops.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="flex gap-4 mt-3">
              {meta.capabilities.map((cap) => (
                <div key={cap} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <div className="w-1 h-1 rounded-full" style={{ backgroundColor: meta.accentHex }} />
                  {cap}
                </div>
              ))}
            </div>
          </div>
          {/* Complexity meter */}
          <div className="shrink-0 flex flex-col items-center gap-1 pt-1">
            <span className="text-[9px] font-medium text-slate-600 uppercase tracking-wider">Complexity</span>
            <div className="flex gap-1">
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="w-2 h-2 rounded-full transition-colors" style={{
                  backgroundColor: i < meta.complexity ? meta.accentHex : 'rgba(255,255,255,0.06)',
                }} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Office Layout — full width ── */}
      <div>
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Office Layout</h3>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] overflow-hidden">
          <Office2DPreview employees={template.employees} />
        </div>
      </div>

      {/* ── Team + Workflows side by side ── */}
      <div className="grid grid-cols-[1fr_300px] gap-5 items-start">
        {/* Left: Team */}
        <div>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span>Your Team</span>
            <span className="text-[10px] font-normal text-slate-700 normal-case tracking-normal">
              {template.employees.length} members
            </span>
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {template.employees.map((emp, idx) => (
              <div key={emp.name} style={{ animation: `wiz-card-in 0.4s ease-out ${idx * 60}ms both` }}>
                <EmployeeCard name={emp.name} role={emp.role_slug} />
              </div>
            ))}
          </div>
        </div>

        {/* Right: Workflows */}
        {template.sops.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
              Workflows
            </h3>
            <div className="space-y-2">
              {template.sops.map((sop) => (
                <WorkflowVisual key={sop.sop_id} sop={sop} accentHex={meta.accentHex} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Employee Card — character profile with expandable detail
   ══════════════════════════════════════════════════════════════════════════ */

function EmployeeCard({ name, role }: { name: string; role: string }) {
  const [expanded, setExpanded] = useState(false);
  const avatarUri = useMemo(() => getAvatar(name, 64), [name]);
  const dotColor = ROLE_DOT[role] ?? '#64748b';
  const roleLabel = ROLE_LABELS[role] ?? role;
  const bio = EMPLOYEE_BIOS[name];

  const toggleExpand = useCallback(() => setExpanded((v) => !v), []);

  return (
    <div
      className="rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] transition-all duration-200 cursor-pointer overflow-hidden"
      onClick={toggleExpand}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(); } }}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="relative shrink-0">
          <img src={avatarUri} alt="" className="w-11 h-11 rounded-full" />
          <div
            className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[#060a14]"
            style={{ backgroundColor: dotColor }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-slate-200 truncate">{name}</div>
          <div className="text-[11px] mt-0.5" style={{ color: dotColor }}>{roleLabel}</div>
          {bio && <div className="text-[10px] text-slate-600 mt-0.5 truncate italic">{bio.bio}</div>}
        </div>
        <div className="shrink-0 text-slate-700">
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && bio && (
        <div className="px-3 pb-3 pt-0 border-t border-white/[0.04]" style={{ animation: 'wiz-slide-up 0.25s ease-out' }}>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {bio.expertise.map((tag) => (
              <span key={tag} className="text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.06]"
                style={{ color: dotColor }}>
                {tag}
              </span>
            ))}
            <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-white/[0.03] text-slate-600 border border-white/[0.04]">
              {bio.style}
            </span>
          </div>
          <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">{bio.helpsWith}</p>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Workflow Visual — horizontal step flow with role indicators
   ══════════════════════════════════════════════════════════════════════════ */

function WorkflowVisual({ sop, accentHex }: { sop: CompanyTemplate['sops'][0]; accentHex: string }) {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <div className="text-xs font-medium text-slate-300 mb-2">{sop.name}</div>
      <div className="flex items-center gap-0">
        {sop.steps.map((step, idx) => {
          const stepColor = ROLE_DOT[step.role_slug] ?? '#64748b';
          const stepRole = ROLE_LABELS[step.role_slug] ?? step.role_slug;
          const isHovered = hovered === idx;
          return (
            <div key={step.step_id} className="flex items-center flex-1 min-w-0">
              {/* Step node */}
              <div
                className="relative flex flex-col items-center"
                onMouseEnter={() => setHovered(idx)}
                onMouseLeave={() => setHovered(null)}
              >
                <div
                  className="w-6 h-6 rounded-full border-2 flex items-center justify-center text-[8px] font-bold transition-all duration-200"
                  style={{
                    borderColor: stepColor,
                    backgroundColor: isHovered ? stepColor : 'transparent',
                    color: isHovered ? '#0f172a' : stepColor,
                    transform: isHovered ? 'scale(1.2)' : 'scale(1)',
                  }}
                >
                  {idx + 1}
                </div>
                <div className="text-[8px] text-slate-600 mt-1 text-center whitespace-nowrap max-w-[56px] truncate">
                  {stepRole}
                </div>
                {/* Tooltip on hover */}
                {isHovered && (
                  <div className="absolute bottom-full mb-2 px-2 py-1 rounded-md bg-slate-800 border border-white/[0.08] text-[9px] text-slate-300 whitespace-nowrap z-20 shadow-xl"
                    style={{ animation: 'wiz-fade-in 0.15s ease-out' }}>
                    {step.label}
                  </div>
                )}
              </div>
              {/* Connector line */}
              {idx < sop.steps.length - 1 && (
                <div className="flex-1 h-px mx-1" style={{ backgroundColor: `${accentHex}30` }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SVG Furniture Components (kept from original — they work)
   ══════════════════════════════════════════════════════════════════════════ */

function PreviewDeskCluster({ x, y }: { x: number; y: number }) {
  const S = 28;
  const half = S / 2;
  const wsOff = 7;
  const chairOff = 14;
  const seats: [number, number, number][] = [
    [-wsOff, -wsOff, -chairOff],
    [wsOff, -wsOff, -chairOff],
    [-wsOff, wsOff, chairOff],
    [wsOff, wsOff, chairOff],
  ];
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x={-half} y={-half} width={S} height={S} rx={1.5} fill="#e2e8f0" stroke="#cbd5e1" strokeWidth={0.3} />
      <line x1="0" y1={-half} x2="0" y2={half} stroke="#94a3b8" strokeWidth={0.5} strokeOpacity={0.5} />
      <line x1={-half} y1="0" x2={half} y2="0" stroke="#94a3b8" strokeWidth={0.5} strokeOpacity={0.5} />
      {seats.map(([dx, dz, cdz], i) => (
        <g key={i}>
          <rect x={dx - 2} y={dz - 1} width={4} height={2} rx={0.3} fill="#334155" />
          <rect x={dx - 3} y={dz < 0 ? dz - 3 : dz + 1} width={6} height={1.2} rx={0.2} fill="#0ea5e9" opacity={0.5} />
          <circle cx={dx} cy={cdz} r={2.2} fill="#1e293b" stroke="#334155" strokeWidth={0.2} />
        </g>
      ))}
    </g>
  );
}

function PreviewMeetingTable({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x={-18} y={-6} width={36} height={12} rx={3.5} fill="#1e293b" stroke="#334155" strokeWidth={0.3} />
      <rect x={-15} y={-4} width={30} height={8} rx={2} fill="#0f172a" />
      {[-11, -4, 4, 11].map((cx, i) => (
        <g key={i}>
          <circle cx={cx} cy={-9.5} r={2} fill="#0f172a" stroke="#334155" strokeWidth={0.2} />
          <circle cx={cx} cy={9.5} r={2} fill="#0f172a" stroke="#334155" strokeWidth={0.2} />
        </g>
      ))}
      <rect x={-26} y={-4} width={1.2} height={8} rx={0.3} fill="#f1f5f9" stroke="#94a3b8" strokeWidth={0.15} />
    </g>
  );
}

function PreviewBookshelf({ x, y }: { x: number; y: number }) {
  const bookColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#a855f7', '#06b6d4'];
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x={-5} y={-6} width={10} height={12} rx={0.5} fill="#1e293b" stroke="#334155" strokeWidth={0.2} />
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
      <rect x={-10} y={-4} width={20} height={8} rx={1} fill="#064e3b" stroke="#334155" strokeWidth={0.2} />
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
      <path d="M-9,-3.5 L9,-3.5 L9,1.5 L5,1.5 L5,-1 L-5,-1 L-5,1.5 L-9,1.5 Z" fill={color} />
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
      <rect x={-3.5} y={-8} width={7} height={16} rx={0.5} fill="#0f172a" stroke="#1e293b" strokeWidth={0.3} />
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
      <circle cx="0" cy="1" r={2.2} fill="#334155" stroke="#475569" strokeWidth={0.15} />
      {[0, 72, 144, 216, 288].map(angle => (
        <path key={angle} d="M0,0 C-2,-3.5 2,-3.5 0,0" fill="#10b981"
          transform={`rotate(${angle})`} />
      ))}
    </g>
  );
}

/* ── Employee avatar in floor plan (with idle bob animation) ── */

function PreviewEmployeeAvatar({ x, y, name, role }: { x: number; y: number; name: string; role: string }) {
  const avatarUri = useMemo(() => getAvatar(name, 32), [name]);
  const dotColor = ROLE_DOT[role] ?? '#64748b';
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2);
  return (
    <g transform={`translate(${x}, ${y})`} style={{ animation: `wiz-idle-bob 3s ease-in-out ${Math.random() * 2}s infinite` }}>
      {/* Status aura */}
      <circle cx="0" cy="0" r={5} fill={dotColor} opacity={0.12} />
      {/* Avatar bg */}
      <circle cx="0" cy="0" r={4} fill="#1e293b" stroke={dotColor} strokeWidth={0.5} />
      {/* Avatar image */}
      <image href={avatarUri} x={-3.2} y={-3.2} width={6.4} height={6.4}
        clipPath={`circle(3.2px at 3.2px 3.2px)`} />
      {/* Fallback initials */}
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

/* ══════════════════════════════════════════════════════════════════════════
   2D Office Preview — SVG with animated zone borders and tooltips
   ══════════════════════════════════════════════════════════════════════════ */

function computeTemplateZones(employees: CompanyTemplate['employees']) {
  const deptMap = new Map<string, number>();
  for (const emp of employees) {
    const dept = resolveZone(emp.role_slug);
    deptMap.set(dept, (deptMap.get(dept) ?? 0) + 1);
  }
  const activeDepts = [...deptMap.keys()];
  const totalEmps = employees.length;

  const hasServer = totalEmps >= 5;
  const hasMeeting = totalEmps >= 3;
  const hasLibrary = totalEmps >= 4;
  const hasRest = totalEmps >= 3;

  const zones: Array<{
    id: string; label: string; accent: string; type: string;
    x: number; y: number; w: number; h: number;
    deptId?: string; empCount?: number;
  }> = [];

  const PAD = 10;
  const W = 640;
  const H = 440;

  const infraZones: typeof zones = [];
  if (hasMeeting) infraZones.push({ id: 'mtg', label: 'MEETING ROOM', accent: '#94a3b8', type: 'infra', x: 0, y: 0, w: 0, h: 0 });
  if (hasServer) infraZones.push({ id: 'srv', label: 'SERVER ROOM', accent: '#06b6d4', type: 'infra', x: 0, y: 0, w: 0, h: 0 });

  const infraW = infraZones.length > 0 ? (W - PAD * 2 - (infraZones.length - 1) * PAD) / infraZones.length : 0;
  const infraH = 100;
  infraZones.forEach((z, i) => {
    z.x = PAD + i * (infraW + PAD);
    z.y = PAD;
    z.w = infraW;
    z.h = infraH;
  });
  zones.push(...infraZones);

  const supportZones: typeof zones = [];
  if (hasLibrary) supportZones.push({ id: 'lib', label: 'LIBRARY', accent: '#10b981', type: 'support', x: 0, y: 0, w: 0, h: 0 });
  if (hasRest) supportZones.push({ id: 'rest', label: 'REST AREA', accent: '#f59e0b', type: 'support', x: 0, y: 0, w: 0, h: 0 });

  const row2Y = infraZones.length > 0 ? PAD + infraH + PAD : PAD;
  const supportW = supportZones.length > 0 ? (W - PAD * 2 - (supportZones.length - 1) * PAD) / supportZones.length : 0;
  const supportH = 120;
  supportZones.forEach((z, i) => {
    z.x = PAD + i * (supportW + PAD);
    z.y = row2Y;
    z.w = supportW;
    z.h = supportH;
  });
  zones.push(...supportZones);

  const row3Y = row2Y + (supportZones.length > 0 ? supportH + PAD : 0);
  const deptW = activeDepts.length > 0 ? (W - PAD * 2 - (activeDepts.length - 1) * PAD) / activeDepts.length : 0;
  const deptH = H - row3Y - PAD;

  const DEPT_META: Record<string, { label: string; accent: string }> = {
    dev: { label: 'DEVELOPMENT', accent: '#3b82f6' },
    prod: { label: 'PRODUCT', accent: '#a855f7' },
    art: { label: 'ART & DESIGN', accent: '#f97316' },
  };

  activeDepts.forEach((deptId, i) => {
    const deptMeta = DEPT_META[deptId] ?? { label: deptId.toUpperCase(), accent: '#64748b' };
    zones.push({
      id: deptId,
      label: deptMeta.label,
      accent: deptMeta.accent,
      type: 'dept',
      x: PAD + i * (deptW + PAD),
      y: row3Y,
      w: deptW,
      h: deptH,
      deptId,
      empCount: deptMap.get(deptId) ?? 0,
    });
  });

  return zones;
}

function Office2DPreview({ employees }: { employees: CompanyTemplate['employees'] }) {
  const W = 640;
  const H = 440;
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);

  const zones = useMemo(() => computeTemplateZones(employees), [employees]);
  const empByZone = useMemo(() => {
    const map = new Map<string, typeof employees>();
    for (const emp of employees) {
      const zoneId = resolveZone(emp.role_slug);
      const list = map.get(zoneId) ?? [];
      list.push(emp);
      map.set(zoneId, list);
    }
    return map;
  }, [employees]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: '280px' }}>
      <rect width={W} height={H} fill="#060a14" rx={6} />
      <defs>
        <pattern id="wiz-grid" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="8" cy="8" r="0.25" fill="#1e293b" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#wiz-grid)" rx={6} />

      {zones.map((z) => {
        const mx = z.x + z.w / 2;
        const my = z.y + z.h / 2;
        const sc = Math.min(z.w, z.h) / 55;
        const isHovered = hoveredZone === z.id;
        const tooltip = ZONE_TOOLTIPS[z.id];

        return (
          <g key={z.id}
            onMouseEnter={() => setHoveredZone(z.id)}
            onMouseLeave={() => setHoveredZone(null)}>
            {/* Zone background */}
            <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={3}
              fill={z.accent} fillOpacity={isHovered ? 0.08 : 0.04}
              stroke={z.accent} strokeWidth={isHovered ? 1 : 0.6}
              strokeOpacity={isHovered ? 0.5 : 0.2}
              strokeDasharray={z.type === 'infra' ? '3 1.5' : 'none'}
              style={{ transition: 'fill-opacity 0.3s, stroke-width 0.3s, stroke-opacity 0.3s' }} />

            {/* Breathing glow on zone borders */}
            <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={3}
              fill="none" stroke={z.accent} strokeWidth={1.5}
              style={{ animation: 'wiz-glow-pulse 4s ease-in-out infinite', animationDelay: `${z.x * 10}ms` }} />

            {/* Zone label */}
            <text x={z.x + 6} y={z.y + 14} fontSize={7} fill={z.accent} opacity={0.5}
              fontFamily="system-ui" fontWeight={700} letterSpacing={0.8}>
              {z.label}
            </text>

            {/* Hover tooltip */}
            {isHovered && tooltip && (
              <g>
                <rect x={mx - 50} y={z.y - 16} width={100} height={13} rx={3}
                  fill="#1e293b" stroke={z.accent} strokeWidth={0.3} strokeOpacity={0.5} />
                <text x={mx} y={z.y - 7.5} fontSize={3.5} fill="#e2e8f0" textAnchor="middle"
                  fontFamily="system-ui">{tooltip}</text>
              </g>
            )}

            {/* ── Furniture per zone type ── */}
            {z.id === 'mtg' && (
              <g transform={`translate(${mx}, ${my + 2}) scale(${sc})`}>
                <PreviewMeetingTable x={0} y={0} />
              </g>
            )}
            {z.id === 'srv' && (
              <g transform={`translate(${mx}, ${my}) scale(${sc})`}>
                <circle cx={0} cy={0} r={18} fill="#06b6d4" opacity={0.04} />
                {[-15, 0, 15].map((dx, i) => (
                  <PreviewServerRack key={i} x={dx} y={0} />
                ))}
              </g>
            )}
            {z.id === 'lib' && (
              <g transform={`translate(${mx}, ${my}) scale(${sc})`}>
                {[-15, -5, 5, 15].map((dx, i) => (
                  <PreviewBookshelf key={i} x={dx} y={-12} />
                ))}
                <PreviewReadingTable x={0} y={8} />
                <PreviewPlant x={22} y={-16} />
              </g>
            )}
            {z.id === 'rest' && (
              <g transform={`translate(${mx}, ${my}) scale(${sc})`}>
                <rect x={-20} y={-10} width={40} height={20} rx={2} fill="#334155" opacity={0.1} />
                <PreviewSofa x={0} y={-5} />
                <PreviewCoffeeTable x={0} y={2} />
                <PreviewVendingMachine x={18} y={-4} />
                <PreviewPlant x={-18} y={-8} />
              </g>
            )}

            {/* ── Department zones: desks + employees ── */}
            {z.type === 'dept' && (() => {
              const zoneEmps = empByZone.get(z.id) ?? [];
              const dsc = Math.min(z.w, z.h) / 55;
              return (
                <g transform={`translate(${mx}, ${my + 2}) scale(${dsc})`}>
                  <PreviewDeskCluster x={0} y={0} />
                  {zoneEmps.slice(0, 4).map((emp, i) => {
                    const row = Math.floor(i / 2);
                    const col = i % 2;
                    const ex = (col === 0 ? -7 : 7);
                    const ey = (row === 0 ? -14 : 14);
                    return <PreviewEmployeeAvatar key={emp.name} x={ex} y={ey} name={emp.name} role={emp.role_slug} />;
                  })}
                </g>
              );
            })()}
          </g>
        );
      })}

      {/* Corner plants */}
      <PreviewPlant x={12} y={12} />
      <PreviewPlant x={W - 12} y={H - 12} />
    </svg>
  );
}
