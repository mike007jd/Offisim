import type { CompanyTemplate } from '@offisim/core/browser';
import type { Zone } from '@offisim/shared-types';
import {
  SYSTEM_ZONE_TEMPLATES,
  WIZARD_PREVIEW_COMPANY_ID,
  templateToZone,
} from '@offisim/shared-types';
import { Brain, Briefcase, FlaskConical, PenTool, Rocket, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { createOffisimAvatar } from '../../lib/avatar-seed';

export function getTemplatePreviewZones(template?: CompanyTemplate | null): Zone[] {
  const zoneTemplates = template?.zones ?? SYSTEM_ZONE_TEMPLATES;
  return zoneTemplates.map((zoneTemplate) =>
    templateToZone(zoneTemplate, WIZARD_PREVIEW_COMPANY_ID),
  );
}

export function getTemplateZoneSummary(template: CompanyTemplate): string[] {
  const zoneTemplates = template.zones ?? SYSTEM_ZONE_TEMPLATES;
  return zoneTemplates.map((zoneTemplate) => zoneTemplate.label);
}

export interface TemplateMeta {
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
  /** Zone IDs that are primary for this template — highlighted in the preview. */
  highlightZones: string[];
}

export const TEMPLATE_META: Record<string, TemplateMeta> = {
  'rd-company': {
    icon: <FlaskConical className="h-4 w-4" />,
    iconLg: <FlaskConical className="h-8 w-8" />,
    accent: 'text-blue-400',
    accentHex: '#3b82f6', // raw-hex-allowed
    accentBg: 'bg-blue-500/10 border-blue-500/30',
    tagline: 'Build software with a full engineering team',
    bestFor: ['Software Development', 'Full Stack', 'Enterprise'],
    complexity: 4,
    capabilities: ['Full-stack development', 'Code review & testing', 'Technical documentation'],
    gradient: 'from-blue-500/20 via-blue-600/10 to-transparent',
    highlightZones: ['zone-dev', 'zone-server'],
  },
  'content-studio': {
    icon: <PenTool className="h-4 w-4" />,
    iconLg: <PenTool className="h-8 w-8" />,
    accent: 'text-emerald-400',
    accentHex: '#10b981', // raw-hex-allowed
    accentBg: 'bg-emerald-500/10 border-emerald-500/30',
    tagline: 'Create, edit, and publish content at scale',
    bestFor: ['Content Marketing', 'Publishing', 'Creative'],
    complexity: 2,
    capabilities: ['Article & blog writing', 'Design & illustration', 'Editorial workflow'],
    gradient: 'from-emerald-500/20 via-emerald-600/10 to-transparent',
    highlightZones: ['zone-dev', 'zone-library'],
  },
  'product-team': {
    icon: <Rocket className="h-4 w-4" />,
    iconLg: <Rocket className="h-8 w-8" />,
    accent: 'text-violet-400',
    accentHex: '#8b5cf6', // raw-hex-allowed
    accentBg: 'bg-violet-500/10 border-violet-500/30',
    tagline: 'Design and ship products from research to launch',
    bestFor: ['Product Strategy', 'Design Thinking', 'Agile'],
    complexity: 3,
    capabilities: ['User research', 'Product strategy', 'Design prototyping'],
    gradient: 'from-violet-500/20 via-violet-600/10 to-transparent',
    highlightZones: ['zone-product', 'zone-meeting'],
  },
  'agency-lite': {
    icon: <Briefcase className="h-4 w-4" />,
    iconLg: <Briefcase className="h-8 w-8" />,
    accent: 'text-amber-400',
    accentHex: '#f59e0b', // raw-hex-allowed
    accentBg: 'bg-amber-500/10 border-amber-500/30',
    tagline: 'Lean team for client projects and quick deliveries',
    bestFor: ['Client Work', 'Freelance', 'Fast Delivery'],
    complexity: 2,
    capabilities: ['Fast turnaround', 'Multi-client support', 'Flexible roles'],
    gradient: 'from-amber-500/20 via-amber-600/10 to-transparent',
    highlightZones: ['zone-dev', 'zone-product'],
  },
  'ai-startup': {
    icon: <Brain className="h-4 w-4" />,
    iconLg: <Brain className="h-8 w-8" />,
    accent: 'text-cyan-400',
    accentHex: '#06b6d4', // raw-hex-allowed
    accentBg: 'bg-cyan-500/10 border-cyan-500/30',
    tagline: 'Research-first team pushing the boundaries of AI',
    bestFor: ['Machine Learning', 'Research', 'Data Science'],
    complexity: 5,
    capabilities: ['ML research', 'Data analysis', 'Rapid prototyping'],
    gradient: 'from-cyan-500/20 via-cyan-600/10 to-transparent',
    highlightZones: ['zone-dev', 'zone-server'],
  },
  'create-your-own': {
    icon: <Wrench className="h-4 w-4" />,
    iconLg: <Wrench className="h-8 w-8" />,
    accent: 'text-emerald-400',
    accentHex: '#34d399', // raw-hex-allowed
    accentBg: 'bg-emerald-500/10',
    tagline: 'Design your office from scratch',
    bestFor: ['Custom layout', 'Full creative control'],
    complexity: 0,
    capabilities: ['3D Studio Editor', 'Custom plot size', 'Free placement'],
    gradient: 'from-emerald-600 to-teal-500',
    highlightZones: [],
  },
};

export const ROLE_LABELS: Record<string, string> = {
  developer: 'Lead Developer',
  frontend: 'Frontend Engineer',
  backend: 'Backend Engineer',
  fullstack: 'Full Stack Engineer',
  pm: 'Product Manager',
  product_manager: 'Product Manager',
  analyst: 'Data Analyst',
  designer: 'UI/UX Designer',
  ui_designer: 'UI Designer',
  ux_designer: 'UX Designer',
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

export const ROLE_DOT: Record<string, string> = {
  developer: '#3b82f6', // raw-hex-allowed
  backend: '#3b82f6', // raw-hex-allowed
  frontend: '#60a5fa', // raw-hex-allowed
  fullstack: '#60a5fa', // raw-hex-allowed
  pm: '#8b5cf6', // raw-hex-allowed
  product_manager: '#8b5cf6', // raw-hex-allowed
  manager: '#a78bfa', // raw-hex-allowed
  designer: '#f59e0b', // raw-hex-allowed
  ui_designer: '#fbbf24', // raw-hex-allowed
  ux_designer: '#f97316', // raw-hex-allowed
  artist: '#f97316', // raw-hex-allowed
  analyst: '#10b981', // raw-hex-allowed
  qa: '#34d399', // raw-hex-allowed
  researcher: '#06b6d4', // raw-hex-allowed
  devops: '#94a3b8', // raw-hex-allowed
  engineering_manager: '#a78bfa', // raw-hex-allowed
  writer: '#10b981', // raw-hex-allowed
  seo_specialist: '#f97316', // raw-hex-allowed
  project_manager: '#a78bfa', // raw-hex-allowed
  account_manager: '#ec4899', // raw-hex-allowed
  graphic_designer: '#f97316', // raw-hex-allowed
};

export interface EmployeeBio {
  bio: string;
  expertise: string[];
  style: string;
  helpsWith: string;
}

export const EMPLOYEE_BIOS: Record<string, EmployeeBio> = {
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
    bio: 'Ships clean code with real runtime verification on day one',
    expertise: ['React', 'Verification', 'TypeScript'],
    style: 'Disciplined',
    helpsWith: 'Production-grade implementation with strong live-runtime verification.',
  },
  'Raj Patel': {
    bio: 'Reviews code like a security auditor',
    expertise: ['Code Review', 'Security', 'Performance'],
    style: 'Rigorous',
    helpsWith: 'Code quality analysis, security auditing, and performance profiling.',
  },
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

export const ZONE_TOOLTIPS: Record<string, string> = {
  'zone-meeting': 'Where your team aligns on priorities',
  'zone-server': 'AI model inference and infrastructure',
  'zone-library': 'Knowledge base and reference material',
  'zone-rest': 'Where creative ideas happen',
  'zone-dev': 'Primary maker workspace for focused execution',
  'zone-product': 'Strategy, coordination, and planning hub',
  'zone-art': 'Visual and interaction design workspace',
};

export const CREATE_YOUR_OWN_TEMPLATE: CompanyTemplate = {
  id: 'create-your-own',
  name: 'Create Your Own',
  description: 'Design your office from scratch in the 3D Studio editor',
  icon: '🛠',
  employees: [],
  sops: [],
  layoutPreset: 'custom',
};

const avatarCache = new Map<string, string>();

export function getAvatar(seed: string, size = 32): string {
  const key = `${seed}-${size}`;
  const cached = avatarCache.get(key);
  if (cached) {
    return cached;
  }
  const uri = createOffisimAvatar(seed, size);
  avatarCache.set(key, uri);
  return uri;
}
