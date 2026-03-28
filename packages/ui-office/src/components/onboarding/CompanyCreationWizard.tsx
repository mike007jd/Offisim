import type { CompanyTemplate } from '@offisim/core/browser';
import { avataaars } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import {
  Brain,
  Briefcase,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FlaskConical,
  Loader2,
  PenTool,
  Rocket,
  Wrench,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCompanyCreation } from '../../hooks/useCompanyCreation.js';
import type { RoleSlug, Zone } from '@offisim/shared-types';
import { SYSTEM_ZONE_TEMPLATES, templateToZone, resolveZoneForRole, UNASSIGNED_ZONE_ID } from '@offisim/shared-types';

/** Static Zone objects from templates — used only for wizard preview. */
const _previewZones: Zone[] = SYSTEM_ZONE_TEMPLATES.map((t) => templateToZone(t, ''));

/** Local shim matching old resolveZone(role) signature for minimal churn. */
function resolveZone(role: string): string {
  return resolveZoneForRole(role as RoleSlug, _previewZones)?.zoneId ?? UNASSIGNED_ZONE_ID;
}

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
  'create-your-own': {
    icon: <Wrench className="h-4 w-4" />,
    iconLg: <Wrench className="h-8 w-8" />,
    accent: 'text-emerald-400',
    accentHex: '#34d399',
    accentBg: 'bg-emerald-500/10',
    tagline: 'Design your office from scratch',
    bestFor: ['Custom layout', 'Full creative control'],
    complexity: 0,
    capabilities: ['3D Studio Editor', 'Custom plot size', 'Free placement'],
    gradient: 'from-emerald-600 to-teal-500',
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
  writer: 'Content Writer',
  seo_specialist: 'SEO Specialist',
  project_manager: 'Project Manager',
  account_manager: 'Account Manager',
  graphic_designer: 'Graphic Designer',
};

const ROLE_DOT: Record<string, string> = {
  developer: '#3b82f6',
  backend: '#3b82f6',
  frontend: '#60a5fa',
  fullstack: '#60a5fa',
  pm: '#8b5cf6',
  product_manager: '#8b5cf6',
  manager: '#a78bfa',
  designer: '#f59e0b',
  ui_designer: '#fbbf24',
  artist: '#f97316',
  analyst: '#10b981',
  qa: '#34d399',
  researcher: '#06b6d4',
  devops: '#94a3b8',
  engineering_manager: '#a78bfa',
  writer: '#10b981',
  seo_specialist: '#f97316',
  project_manager: '#a78bfa',
  account_manager: '#ec4899',
  graphic_designer: '#f97316',
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
  'Alex Chen': {
    bio: 'Architectural thinker who loves clean code',
    expertise: ['System Design', 'TypeScript', 'Testing'],
    style: 'Methodical',
    helpsWith:
      'Complex system architecture, code organization, and technical leadership across the full stack.',
  },
  'Maya Lin': {
    bio: 'Pixel-perfect UI with a passion for animation',
    expertise: ['React', 'CSS', 'Animation'],
    style: 'Creative',
    helpsWith: 'Beautiful user interfaces, smooth interactions, and accessible component design.',
  },
  'Marcus Johnson': {
    bio: 'Database whisperer and API craftsman',
    expertise: ['PostgreSQL', 'APIs', 'DevOps'],
    style: 'Reliable',
    helpsWith: 'Scalable backend systems, database optimization, and robust infrastructure.',
  },
  'Kai Nakamura': {
    bio: 'Bridge builder between frontend and backend',
    expertise: ['TypeScript', 'APIs', 'Monorepos'],
    style: 'Collaborative',
    helpsWith: 'Cross-stack integration, API contracts, and developer tooling.',
  },
  'Sophie Park': {
    bio: 'Turns chaos into roadmaps',
    expertise: ['Strategy', 'User Research', 'OKRs'],
    style: 'Strategic',
    helpsWith: 'Product vision, requirement analysis, and stakeholder alignment.',
  },
  'Ryan Torres': {
    bio: 'Finds the story hidden in the data',
    expertise: ['Analytics', 'SQL', 'Dashboards'],
    style: 'Analytical',
    helpsWith: 'Data-driven decisions, quality assurance, and performance analysis.',
  },
  'Zara Okafor': {
    bio: 'Makes complex things feel simple',
    expertise: ['Figma', 'UX Research', 'Design Systems'],
    style: 'Empathetic',
    helpsWith: 'User experience design, interaction patterns, and design system development.',
  },
  'Jamie Reeves': {
    bio: 'Typography nerd and accessibility advocate',
    expertise: ['Visual Design', 'Motion', 'Branding'],
    style: 'Experimental',
    helpsWith: 'Visual identity, micro-interactions, and scalable asset pipelines.',
  },

  // ── Content Studio ──
  'Dana Rivera': {
    bio: 'Investigative mind with a nose for truth',
    expertise: ['Research', 'Analysis', 'Fact-checking'],
    style: 'Thorough',
    helpsWith: 'Deep research, source verification, and comprehensive briefing documents.',
  },
  'Leo Zhang': {
    bio: 'Words that hook readers and never let go',
    expertise: ['Copywriting', 'Storytelling', 'SEO'],
    style: 'Versatile',
    helpsWith: 'Compelling content drafts, audience-tuned copy, and narrative structure.',
  },
  'Carmen Flores': {
    bio: 'Editor with a sixth sense for weak prose',
    expertise: ['Editing', 'Style Guides', 'Publishing'],
    style: 'Sharp',
    helpsWith: 'Editorial polish, voice consistency, and publication-ready quality.',
  },
  'Priya Sharma': {
    bio: 'Connects every piece to business impact',
    expertise: ['Content Strategy', 'Analytics', 'Auditing'],
    style: 'Strategic',
    helpsWith: 'Content performance analysis, strategic alignment, and quality standards.',
  },
  'Marco Rossi': {
    bio: 'SEO wizard who thinks in search intent',
    expertise: ['SEO', 'Distribution', 'Analytics'],
    style: 'Data-driven',
    helpsWith: 'Search optimization, content formatting, and multi-channel distribution.',
  },

  // ── Product Team ──
  'Ava Mitchell': {
    bio: 'Specs so clear they practically code themselves',
    expertise: ['PRDs', 'Prioritization', 'User Stories'],
    style: 'Precise',
    helpsWith: 'Requirements engineering, edge case identification, and acceptance criteria.',
  },
  'Noah Kim': {
    bio: 'Designs systems that age like fine wine',
    expertise: ['Architecture', 'APIs', 'Databases'],
    style: 'Thoughtful',
    helpsWith: 'Technical architecture, data modeling, and scalable API design.',
  },
  'Elena Volkov': {
    bio: 'Ships clean code with tests on day one',
    expertise: ['React', 'Testing', 'TypeScript'],
    style: 'Disciplined',
    helpsWith: 'Production-grade implementation with comprehensive test coverage.',
  },
  'Raj Patel': {
    bio: 'Reviews code like a security auditor',
    expertise: ['Code Review', 'Security', 'Performance'],
    style: 'Rigorous',
    helpsWith: 'Code quality analysis, security auditing, and performance profiling.',
  },

  // ── Agency Lite ──
  'Nina Vasquez': {
    bio: 'Clients trust her before they trust the work',
    expertise: ['Client Relations', 'Proposals', 'SOWs'],
    style: 'Diplomatic',
    helpsWith: 'Client communication, expectation management, and project handoffs.',
  },
  'Ray Chen': {
    bio: 'Juggles five projects without dropping one',
    expertise: ['Project Management', 'Agile', 'Scheduling'],
    style: 'Organized',
    helpsWith: 'Multi-project coordination, deadline tracking, and team workload balance.',
  },
  'Amara Obi': {
    bio: 'Bold visuals that stop the scroll',
    expertise: ['Brand Identity', 'Layout', 'Campaign Design'],
    style: 'Bold',
    helpsWith: 'Visual design, creative direction, and brand-aligned campaign assets.',
  },
  'Liam Burke': {
    bio: 'Ships demos before you finish the brief',
    expertise: ['React', 'CMS', 'Landing Pages'],
    style: 'Pragmatic',
    helpsWith: 'Rapid prototyping, client demos, and production deployments.',
  },
  'Suki Tanaka': {
    bio: "Catches the bug you didn't know existed",
    expertise: ['QA', 'Accessibility', 'Cross-browser'],
    style: 'Meticulous',
    helpsWith: 'Quality assurance, brand compliance, and cross-platform testing.',
  },

  // ── AI Startup ──
  'Dmitri Volkov': {
    bio: 'Reads papers for breakfast, writes them for lunch',
    expertise: ['Transformers', 'PyTorch', 'Research'],
    style: 'Rigorous',
    helpsWith: 'ML research, experiment design, and architecture innovation.',
  },
  'Aria Patel': {
    bio: 'Obsessed with shaving milliseconds off inference',
    expertise: ['Model Serving', 'Optimization', 'GPUs'],
    style: 'Performance-driven',
    helpsWith: 'Inference optimization, model fine-tuning, and serving infrastructure.',
  },
  'Leo Chen': {
    bio: 'Builds pipelines that never break at 3AM',
    expertise: ['Data Pipelines', 'Vector DBs', 'ETL'],
    style: 'Systematic',
    helpsWith: 'Data engineering, pipeline reliability, and ML infrastructure.',
  },
  'Sam Rivera': {
    bio: 'Translates ML magic into product value',
    expertise: ['AI Products', 'User Research', 'Pricing'],
    style: 'Visionary',
    helpsWith: 'AI product strategy, responsible AI practices, and market positioning.',
  },
  'Nia Williams': {
    bio: 'Makes AI feel natural in the interface',
    expertise: ['Streaming UI', 'React', 'WebSockets'],
    style: 'User-focused',
    helpsWith: 'AI-powered UIs, real-time interfaces, and graceful error handling.',
  },
  'Chloe Kim': {
    bio: 'Designs trust into every AI interaction',
    expertise: ['AI UX', 'Data Viz', 'Explainability'],
    style: 'Trust-first',
    helpsWith: 'AI interaction design, confidence displays, and human-AI collaboration patterns.',
  },
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
   Synthetic "Create Your Own" template — appended client-side, not in core
   ══════════════════════════════════════════════════════════════════════════ */

const CREATE_YOUR_OWN_TEMPLATE: CompanyTemplate = {
  id: 'create-your-own',
  name: 'Create Your Own',
  description: 'Design your office from scratch in the 3D Studio editor',
  icon: '🛠',
  employees: [],
  sops: [],
  layoutPreset: 'custom',
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

interface Props {
  onComplete?: () => void;
  onCreateYourOwn?: () => void;
}

export function CompanyCreationWizard({ onComplete, onCreateYourOwn }: Props) {
  const {
    step,
    templates: coreTemplates,
    selectedTemplateId,
    companyName,
    setSelectedTemplateId,
    setCompanyName,
    create,
    error,
    runtimeReady,
  } = useCompanyCreation();

  // Append synthetic "Create Your Own" to core templates
  const templates = useMemo(() => [...coreTemplates, CREATE_YOUR_OWN_TEMPLATE], [coreTemplates]);

  const isCreateYourOwn = selectedTemplateId === 'create-your-own';

  const prevStepRef = useRef(step);
  const [infoTab, setInfoTab] = useState<'team' | 'workflows'>('team');
  useEffect(() => {
    if (prevStepRef.current === 'creating' && step === 'ready') onComplete?.();
    prevStepRef.current = step;
  }, [step, onComplete]);

  useEffect(() => {
    const defaultTemplateId = templates[0]?.id;
    if (!selectedTemplateId && typeof defaultTemplateId === 'string') {
      setSelectedTemplateId(defaultTemplateId);
    }
  }, [selectedTemplateId, templates, setSelectedTemplateId]);

  // Reset tab when template changes
  useEffect(() => {
    if (selectedTemplateId) {
      setInfoTab('team');
    }
  }, [selectedTemplateId]);

  useEffect(() => {
    ensureKeyframes();
  }, []);

  const currentTemplateIdx = useMemo(
    () => templates.findIndex((t) => t.id === selectedTemplateId),
    [templates, selectedTemplateId],
  );
  const switchTemplate = useCallback(
    (dir: -1 | 1) => {
      if (templates.length === 0) return;
      const idx = templates.findIndex((t) => t.id === selectedTemplateId);
      const next = (idx + dir + templates.length) % templates.length;
      const nextTemplate = templates[next];
      if (nextTemplate) {
        setSelectedTemplateId(nextTemplate.id);
      }
    },
    [selectedTemplateId, templates, setSelectedTemplateId],
  );

  if (step === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-surface">
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
    <div className="fixed inset-0 z-50 flex flex-col bg-surface overflow-hidden">
      {/* Background dot grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle, var(--surface-lighter) 0.5px, transparent 0.5px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* ── Main content: left panel + right floor plan ── */}
      <div className="relative z-10 flex-1 flex min-h-0 overflow-hidden">
        {selected && meta ? (
          <>
            {/* LEFT panel — fixed header + scrollable content */}
            <div
              className="w-[340px] shrink-0 border-r border-white/[0.06] flex flex-col"
              key={`info-${selected.id}`}
              style={{ animation: 'wiz-fade-in 0.3s ease-out' }}
            >
              {/* ── Fixed header ── */}
              <div className="shrink-0 px-4 pt-4 pb-3 space-y-3 border-b border-white/[0.06]">
                {/* Template switcher */}
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-2 py-2.5 flex flex-col items-center gap-2">
                  <div className="flex items-center w-full">
                    <button
                      type="button"
                      onClick={() => switchTemplate(-1)}
                      className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors"
                    >
                      <ChevronLeft className="h-6 w-6" />
                    </button>
                    <div className="flex-1 flex items-center justify-center gap-2.5 min-w-0">
                      <div className={`shrink-0 ${meta.accent}`}>{meta.icon}</div>
                      <h2 className="text-lg font-semibold text-white truncate">{selected.name}</h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => switchTemplate(1)}
                      className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors"
                    >
                      <ChevronRight className="h-6 w-6" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {templates.map((t, i) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setSelectedTemplateId(t.id)}
                        className="rounded-full transition-all"
                        style={{
                          width: i === currentTemplateIdx ? 16 : 6,
                          height: 6,
                          backgroundColor:
                            i === currentTemplateIdx ? meta.accentHex : 'rgba(255,255,255,0.12)',
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Tab bar */}
                {!isCreateYourOwn && (
                  <div className="flex">
                    <button
                      type="button"
                      onClick={() => setInfoTab('team')}
                      className={`pb-2 pr-4 text-xs font-semibold uppercase tracking-wider transition-colors ${
                        infoTab === 'team'
                          ? 'text-white border-b-2 border-blue-400'
                          : 'text-slate-600 hover:text-slate-400'
                      }`}
                    >
                      Team · {selected.employees.length}
                    </button>
                    {selected.sops.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setInfoTab('workflows')}
                        className={`pb-2 px-4 text-xs font-semibold uppercase tracking-wider transition-colors ${
                          infoTab === 'workflows'
                            ? 'text-white border-b-2 border-blue-400'
                            : 'text-slate-600 hover:text-slate-400'
                        }`}
                      >
                        Workflows · {selected.sops.length}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* ── Scrollable content ── */}
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {isCreateYourOwn ? (
                  <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-4">
                    <div className="text-emerald-400">{meta.iconLg}</div>
                    <p className="text-sm text-slate-400">{meta.tagline}</p>
                    <div className="space-y-2 w-full">
                      {meta.capabilities.map((cap) => (
                        <div
                          key={cap}
                          className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                          <span className="text-xs text-slate-300">{cap}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : infoTab === 'team' || selected.sops.length === 0 ? (
                  <div className="space-y-1.5">
                    {selected.employees.map((emp, idx) => (
                      <div
                        key={emp.name}
                        style={{ animation: `wiz-card-in 0.4s ease-out ${idx * 50}ms both` }}
                      >
                        <EmployeeCard name={emp.name} role={emp.role_slug} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <ProductionWorkflow sops={selected.sops} accentHex={meta.accentHex} />
                )}
              </div>
            </div>

            {/* RIGHT: Floor plan — fixed, fills space */}
            <div
              className="flex-1 min-w-0 p-4 flex items-center justify-center"
              key={`fp-${selected.id}`}
              style={{ animation: 'wiz-fade-in 0.4s ease-out' }}
            >
              <div className="w-full h-full rounded-xl border border-white/[0.06] bg-white/[0.01] flex items-center justify-center p-2 overflow-hidden">
                {isCreateYourOwn ? (
                  <div className="flex flex-col items-center gap-3 text-center">
                    <Wrench className="h-12 w-12 text-emerald-400/40" />
                    <p className="text-sm text-slate-600">
                      Your custom office will be designed in the 3D Studio editor
                    </p>
                  </div>
                ) : (
                  <Office2DPreview employees={selected.employees} />
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
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
              <label
                htmlFor="company-name"
                className="text-xs font-medium text-slate-500 uppercase tracking-wider block mb-1.5"
              >
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
              onClick={isCreateYourOwn ? onCreateYourOwn : create}
              disabled={
                !selectedTemplateId || (!isCreateYourOwn && !runtimeReady) || !companyName.trim()
              }
              className="rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-8 py-3 text-sm font-semibold text-white hover:from-blue-500 hover:to-blue-400 disabled:opacity-30 disabled:cursor-not-allowed transition-all mt-5"
              style={
                (isCreateYourOwn || runtimeReady) && selectedTemplateId
                  ? { animation: 'wiz-cta-pulse 3s ease-in-out infinite' }
                  : undefined
              }
            >
              {isCreateYourOwn ? (
                'Open Studio Editor'
              ) : !runtimeReady ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Initializing...
                </span>
              ) : (
                'Start Company'
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
    <div
      className="flex flex-col items-center gap-3 py-2"
      style={{ animation: 'wiz-fade-in 0.5s ease-out' }}
    >
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-blue-400" />
        <span
          className="text-sm font-medium text-white"
          style={{ animation: 'wiz-building-pulse 2s ease-in-out infinite' }}
        >
          Building your office...
        </span>
      </div>
      <p className="text-xs text-slate-600">Setting up employees, workflows, and office layout</p>
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
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.04] transition-all duration-200"
        onClick={toggleExpand}
      >
        <div className="relative shrink-0">
          <img src={avatarUri} alt="" className="w-11 h-11 rounded-full" />
          <div
            className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-surface"
            style={{ backgroundColor: dotColor }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium text-slate-200 truncate">{name}</div>
          <div className="text-[13px] mt-0.5" style={{ color: dotColor }}>
            {roleLabel}
          </div>
          {bio && <div className="text-xs text-slate-600 mt-0.5 truncate italic">{bio.bio}</div>}
        </div>
        <div className="shrink-0 text-slate-700">
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && bio && (
        <div
          className="px-3 pb-3 pt-0 border-t border-white/[0.04]"
          style={{ animation: 'wiz-slide-up 0.25s ease-out' }}
        >
          <div className="flex flex-wrap gap-1.5 mt-2">
            {bio.expertise.map((tag) => (
              <span
                key={tag}
                className="text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.06]"
                style={{ color: dotColor }}
              >
                {tag}
              </span>
            ))}
            <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-white/[0.03] text-slate-600 border border-white/[0.04]">
              {bio.style}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">{bio.helpsWith}</p>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Workflow Visual — horizontal step flow with role indicators
   ══════════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════════
   Production Workflow — unified multi-phase flow with step detail
   ══════════════════════════════════════════════════════════════════════════ */

function ProductionWorkflow({
  sops,
  accentHex,
}: { sops: CompanyTemplate['sops']; accentHex: string }) {
  return (
    <div className="flex flex-col items-center">
      {sops.map((sop, sopIdx) => (
        <div key={sop.sop_id} className="w-full flex flex-col items-center">
          {/* Phase divider (between phases) */}
          {sops.length > 1 && sopIdx > 0 && (
            <div className="flex items-center gap-2 w-[90%] my-2">
              <div className="flex-1 h-px" style={{ backgroundColor: `${accentHex}15` }} />
              <span
                className="text-[11px] font-medium uppercase tracking-wider"
                style={{ color: `${accentHex}80` }}
              >
                Phase {sopIdx + 1}
              </span>
              <div className="flex-1 h-px" style={{ backgroundColor: `${accentHex}15` }} />
            </div>
          )}
          {sops.length > 1 && sopIdx === 0 && (
            <div
              className="text-[11px] font-medium uppercase tracking-wider mb-2"
              style={{ color: `${accentHex}80` }}
            >
              Phase 1
            </div>
          )}

          {/* Steps as flow chart boxes */}
          {sop.steps.map((step, idx) => {
            const stepColor = ROLE_DOT[step.role_slug] ?? '#64748b';
            const stepRole = ROLE_LABELS[step.role_slug] ?? step.role_slug;
            const isLastGlobal = sopIdx === sops.length - 1 && idx === sop.steps.length - 1;
            return (
              <div key={step.step_id} className="w-full flex flex-col items-center">
                {/* Step box */}
                <div
                  className="w-[90%] rounded-lg border px-3 py-2 relative overflow-hidden"
                  style={{ borderColor: `${stepColor}20`, backgroundColor: `${stepColor}06` }}
                >
                  <div
                    className="absolute left-0 top-0 bottom-0 w-[3px]"
                    style={{ backgroundColor: stepColor }}
                  />
                  <div className="pl-2.5">
                    <div className="text-xs font-medium text-slate-200">{step.label}</div>
                    <div className="text-[11px] mt-0.5 flex items-center gap-1.5">
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: stepColor }}
                      />
                      <span style={{ color: stepColor }}>{stepRole}</span>
                    </div>
                  </div>
                </div>
                {/* Connector arrow */}
                {!isLastGlobal && (
                  <svg className="shrink-0" width="8" height="16" viewBox="0 0 8 16">
                    <title>Workflow connector</title>
                    <line
                      x1="4"
                      y1="0"
                      x2="4"
                      y2="12"
                      stroke="rgba(255,255,255,0.08)"
                      strokeWidth={1}
                    />
                    <path
                      d="M2 10l2 4 2-4"
                      fill="none"
                      stroke="rgba(255,255,255,0.2)"
                      strokeWidth={0.8}
                    />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      ))}
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
      <rect
        x={-half}
        y={-half}
        width={S}
        height={S}
        rx={1.5}
        fill="var(--surface-mid)"
        stroke="var(--surface-mid)"
        strokeWidth={0.3}
      />
      <line
        x1="0"
        y1={-half}
        x2="0"
        y2={half}
        stroke="var(--text-secondary-val)"
        strokeWidth={0.5}
        strokeOpacity={0.5}
      />
      <line
        x1={-half}
        y1="0"
        x2={half}
        y2="0"
        stroke="var(--text-secondary-val)"
        strokeWidth={0.5}
        strokeOpacity={0.5}
      />
      {seats.map(([dx, dz, cdz]) => (
        <g key={`${dx}-${dz}-${cdz}`}>
          <rect x={dx - 2} y={dz - 1} width={4} height={2} rx={0.3} fill="var(--surface-mid)" />
          <rect
            x={dx - 3}
            y={dz < 0 ? dz - 3 : dz + 1}
            width={6}
            height={1.2}
            rx={0.2}
            fill="#0ea5e9"
            opacity={0.5}
          />
          <circle
            cx={dx}
            cy={cdz}
            r={2.2}
            fill="var(--surface-lighter)"
            stroke="var(--surface-mid)"
            strokeWidth={0.2}
          />
        </g>
      ))}
    </g>
  );
}

function PreviewMeetingTable({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x={-18}
        y={-6}
        width={36}
        height={12}
        rx={3.5}
        fill="var(--surface-lighter)"
        stroke="var(--surface-mid)"
        strokeWidth={0.3}
      />
      <rect x={-15} y={-4} width={30} height={8} rx={2} fill="var(--surface-light)" />
      {[-11, -4, 4, 11].map((cx) => (
        <g key={cx}>
          <circle
            cx={cx}
            cy={-9.5}
            r={2}
            fill="var(--surface-light)"
            stroke="var(--surface-mid)"
            strokeWidth={0.2}
          />
          <circle
            cx={cx}
            cy={9.5}
            r={2}
            fill="var(--surface-light)"
            stroke="var(--surface-mid)"
            strokeWidth={0.2}
          />
        </g>
      ))}
      <rect
        x={-26}
        y={-4}
        width={1.2}
        height={8}
        rx={0.3}
        fill="var(--surface-lighter)"
        stroke="var(--text-secondary-val)"
        strokeWidth={0.15}
      />
    </g>
  );
}

function PreviewBookshelf({ x, y }: { x: number; y: number }) {
  const bookColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#a855f7', '#06b6d4'];
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x={-5}
        y={-6}
        width={10}
        height={12}
        rx={0.5}
        fill="var(--surface-lighter)"
        stroke="var(--surface-mid)"
        strokeWidth={0.2}
      />
      {[0, 1, 2].map((shelf) => (
        <g key={shelf}>
          <rect x={-4.5} y={-5 + shelf * 4} width={9} height={0.2} fill="var(--surface-mid)" />
          {[0, 1, 2, 3, 4].map((b) => (
            <rect
              key={b}
              x={-4 + b * 1.6}
              y={-4.5 + shelf * 4}
              width={1.2}
              height={3}
              rx={0.1}
              fill={bookColors[(shelf * 5 + b) % bookColors.length]}
            />
          ))}
        </g>
      ))}
    </g>
  );
}

function PreviewReadingTable({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x={-10}
        y={-4}
        width={20}
        height={8}
        rx={1}
        fill="#064e3b"
        stroke="var(--surface-mid)"
        strokeWidth={0.2}
      />
      {[-5, 5].map((cx) => (
        <g key={cx}>
          <circle
            cx={cx}
            cy={-6.5}
            r={1.8}
            fill="var(--surface-light)"
            stroke="var(--surface-mid)"
            strokeWidth={0.15}
          />
          <circle
            cx={cx}
            cy={6.5}
            r={1.8}
            fill="var(--surface-light)"
            stroke="var(--surface-mid)"
            strokeWidth={0.15}
          />
        </g>
      ))}
    </g>
  );
}

function PreviewSofa({ x, y, color = '#f59e0b' }: { x: number; y: number; color?: string }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <path d="M-9,-3.5 L9,-3.5 L9,1.5 L5,1.5 L5,-1 L-5,-1 L-5,1.5 L-9,1.5 Z" fill={color} />
      <rect x={-10.5} y={-3.5} width={2} height={5} rx={0.8} fill="var(--surface-light)" />
      <rect x={8.5} y={-3.5} width={2} height={5} rx={0.8} fill="var(--surface-light)" />
    </g>
  );
}

function PreviewCoffeeTable({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle
        cx="0"
        cy="0"
        r={4.5}
        fill="var(--surface-lighter)"
        stroke="var(--surface-mid)"
        strokeWidth={0.2}
      />
      <circle cx="0" cy="0" r={2} fill="var(--surface-light)" />
    </g>
  );
}

function PreviewServerRack({ x, y }: { x: number; y: number }) {
  const rackRows = [-7, -4.5, -2, 0.5, 3, 5.5] as const;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x={-3.5}
        y={-8}
        width={7}
        height={16}
        rx={0.5}
        fill="var(--surface-light)"
        stroke="var(--surface-lighter)"
        strokeWidth={0.3}
      />
      {rackRows.map((row, index) => (
        <g key={`server-rack-${row}`}>
          <rect x={-2.8} y={row} width={5.6} height={2} rx={0.2} fill="var(--surface)" />
          <circle cx={1.5} cy={row + 1} r={0.4} fill={index % 3 === 0 ? '#fbbf24' : '#22c55e'} />
        </g>
      ))}
    </g>
  );
}

function PreviewVendingMachine({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x={-3}
        y={-5.5}
        width={6}
        height={11}
        rx={0.7}
        fill="var(--surface-lighter)"
        stroke="var(--surface-mid)"
        strokeWidth={0.2}
      />
      <rect x={-2.2} y={-4.5} width={4.4} height={4.5} rx={0.3} fill="#0ea5e9" opacity={0.4} />
      <rect x={-1.8} y={1} width={3.6} height={1.5} rx={0.3} fill="var(--surface-light)" />
    </g>
  );
}

function PreviewPlant({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle
        cx="0"
        cy="1"
        r={2.2}
        fill="var(--surface-mid)"
        stroke="var(--text-muted-val)"
        strokeWidth={0.15}
      />
      {[0, 72, 144, 216, 288].map((angle) => (
        <path
          key={angle}
          d="M0,0 C-2,-3.5 2,-3.5 0,0"
          fill="#10b981"
          transform={`rotate(${angle})`}
        />
      ))}
    </g>
  );
}

/* ── Employee avatar in floor plan (with idle bob animation) ── */

function PreviewEmployeeAvatar({
  x,
  y,
  name,
  role,
}: { x: number; y: number; name: string; role: string }) {
  const avatarUri = useMemo(() => getAvatar(name, 32), [name]);
  const dotColor = ROLE_DOT[role] ?? '#64748b';
  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2);
  return (
    <g transform={`translate(${x}, ${y})`}>
      <g style={{ animation: `wiz-idle-bob 3s ease-in-out ${Math.random() * 2}s infinite` }}>
        {/* Status aura */}
        <circle cx="0" cy="0" r={5} fill={dotColor} opacity={0.12} />
        {/* Avatar bg */}
        <circle
          cx="0"
          cy="0"
          r={4}
          fill="var(--surface-lighter)"
          stroke={dotColor}
          strokeWidth={0.5}
        />
        {/* Avatar image */}
        <image
          href={avatarUri}
          x={-3.2}
          y={-3.2}
          width={6.4}
          height={6.4}
          clipPath={'circle(3.2px at 3.2px 3.2px)'}
        />
        {/* Fallback initials */}
        <text
          x="0"
          y="1.5"
          textAnchor="middle"
          fontSize={3}
          fill="var(--text-primary-val)"
          fontFamily="system-ui"
          fontWeight={600}
          style={{ pointerEvents: 'none' }}
        >
          {initials}
        </text>
        {/* Name plate */}
        <g transform="translate(0, 6.5)">
          <rect
            x={-8}
            y={-2}
            width={16}
            height={4}
            rx={2}
            fill="var(--surface-light)"
            opacity={0.8}
          />
          <text
            x="0"
            y="0.8"
            fill="var(--text-primary-val)"
            fontSize={2.2}
            fontWeight={600}
            textAnchor="middle"
            fontFamily="system-ui"
          >
            {name.split(' ')[0]}
          </text>
        </g>
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
    id: string;
    label: string;
    accent: string;
    type: string;
    x: number;
    y: number;
    w: number;
    h: number;
    deptId?: string;
    empCount?: number;
  }> = [];

  const PAD = 10;
  const W = 640;
  const H = 440;

  const infraZones: typeof zones = [];
  if (hasMeeting)
    infraZones.push({
      id: 'mtg',
      label: 'MEETING ROOM',
      accent: '#94a3b8',
      type: 'infra',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
  if (hasServer)
    infraZones.push({
      id: 'srv',
      label: 'SERVER ROOM',
      accent: '#06b6d4',
      type: 'infra',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });

  const infraW =
    infraZones.length > 0 ? (W - PAD * 2 - (infraZones.length - 1) * PAD) / infraZones.length : 0;
  const infraH = 100;
  infraZones.forEach((z, i) => {
    z.x = PAD + i * (infraW + PAD);
    z.y = PAD;
    z.w = infraW;
    z.h = infraH;
  });
  zones.push(...infraZones);

  const supportZones: typeof zones = [];
  if (hasLibrary)
    supportZones.push({
      id: 'lib',
      label: 'LIBRARY',
      accent: '#10b981',
      type: 'support',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });
  if (hasRest)
    supportZones.push({
      id: 'rest',
      label: 'REST AREA',
      accent: '#f59e0b',
      type: 'support',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    });

  const row2Y = infraZones.length > 0 ? PAD + infraH + PAD : PAD;
  const supportW =
    supportZones.length > 0
      ? (W - PAD * 2 - (supportZones.length - 1) * PAD) / supportZones.length
      : 0;
  const supportH = 120;
  supportZones.forEach((z, i) => {
    z.x = PAD + i * (supportW + PAD);
    z.y = row2Y;
    z.w = supportW;
    z.h = supportH;
  });
  zones.push(...supportZones);

  const row3Y = row2Y + (supportZones.length > 0 ? supportH + PAD : 0);
  const deptW =
    activeDepts.length > 0
      ? (W - PAD * 2 - (activeDepts.length - 1) * PAD) / activeDepts.length
      : 0;
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
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
      aria-label="Company office preview"
    >
      <title>Company office preview</title>
      <rect width={W} height={H} fill="var(--surface)" rx={6} />
      <defs>
        <pattern id="wiz-grid" width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="8" cy="8" r="0.25" fill="var(--surface-lighter)" />
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
          <g
            key={z.id}
            onMouseEnter={() => setHoveredZone(z.id)}
            onMouseLeave={() => setHoveredZone(null)}
          >
            {/* Zone background */}
            <rect
              x={z.x}
              y={z.y}
              width={z.w}
              height={z.h}
              rx={3}
              fill={z.accent}
              fillOpacity={isHovered ? 0.08 : 0.04}
              stroke={z.accent}
              strokeWidth={isHovered ? 1 : 0.6}
              strokeOpacity={isHovered ? 0.5 : 0.2}
              strokeDasharray={z.type === 'infra' ? '3 1.5' : 'none'}
              style={{ transition: 'fill-opacity 0.3s, stroke-width 0.3s, stroke-opacity 0.3s' }}
            />

            {/* Breathing glow on zone borders */}
            <rect
              x={z.x}
              y={z.y}
              width={z.w}
              height={z.h}
              rx={3}
              fill="none"
              stroke={z.accent}
              strokeWidth={1.5}
              style={{
                animation: 'wiz-glow-pulse 4s ease-in-out infinite',
                animationDelay: `${z.x * 10}ms`,
              }}
            />

            {/* Zone label */}
            <text
              x={z.x + 6}
              y={z.y + 14}
              fontSize={7}
              fill={z.accent}
              opacity={0.5}
              fontFamily="system-ui"
              fontWeight={700}
              letterSpacing={0.8}
            >
              {z.label}
            </text>

            {/* Hover tooltip */}
            {isHovered && tooltip && (
              <g>
                <rect
                  x={mx - 50}
                  y={z.y - 16}
                  width={100}
                  height={13}
                  rx={3}
                  fill="var(--surface-lighter)"
                  stroke={z.accent}
                  strokeWidth={0.3}
                  strokeOpacity={0.5}
                />
                <text
                  x={mx}
                  y={z.y - 7.5}
                  fontSize={3.5}
                  fill="var(--text-primary-val)"
                  textAnchor="middle"
                  fontFamily="system-ui"
                >
                  {tooltip}
                </text>
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
                {[-15, 0, 15].map((dx) => (
                  <PreviewServerRack key={dx} x={dx} y={0} />
                ))}
              </g>
            )}
            {z.id === 'lib' && (
              <g transform={`translate(${mx}, ${my}) scale(${sc})`}>
                {[-15, -5, 5, 15].map((dx) => (
                  <PreviewBookshelf key={dx} x={dx} y={-12} />
                ))}
                <PreviewReadingTable x={0} y={8} />
                <PreviewPlant x={22} y={-16} />
              </g>
            )}
            {z.id === 'rest' && (
              <g transform={`translate(${mx}, ${my}) scale(${sc})`}>
                <rect
                  x={-20}
                  y={-10}
                  width={40}
                  height={20}
                  rx={2}
                  fill="var(--surface-mid)"
                  opacity={0.1}
                />
                <PreviewSofa x={0} y={-5} />
                <PreviewCoffeeTable x={0} y={2} />
                <PreviewVendingMachine x={18} y={-4} />
                <PreviewPlant x={-18} y={-8} />
              </g>
            )}

            {/* ── Department zones: desks + employees ── */}
            {z.type === 'dept' &&
              (() => {
                const zoneEmps = empByZone.get(z.id) ?? [];
                const dsc = Math.min(z.w, z.h) / 55;
                return (
                  <g transform={`translate(${mx}, ${my + 2}) scale(${dsc})`}>
                    <PreviewDeskCluster x={0} y={0} />
                    {zoneEmps.slice(0, 4).map((emp, i) => {
                      const row = Math.floor(i / 2);
                      const col = i % 2;
                      const ex = col === 0 ? -7 : 7;
                      const ey = row === 0 ? -14 : 14;
                      return (
                        <PreviewEmployeeAvatar
                          key={emp.name}
                          x={ex}
                          y={ey}
                          name={emp.name}
                          role={emp.role_slug}
                        />
                      );
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
