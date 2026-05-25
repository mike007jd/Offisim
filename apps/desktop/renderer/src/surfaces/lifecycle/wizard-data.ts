import type { CompanyTemplate } from '@/data/types.js';
import {
  Brain,
  Briefcase,
  FlaskConical,
  type LucideIcon,
  PenTool,
  Rocket,
  Wrench,
} from 'lucide-react';

/** Template presentation metadata — ported from the legacy create-company wizard. */
export interface TemplateMeta {
  icon: LucideIcon;
  accentHex: string;
  tagline: string;
  bestFor: string[];
  capabilities: string[];
}

export const TEMPLATE_META: Record<string, TemplateMeta> = {
  'rd-company': {
    icon: FlaskConical,
    accentHex: '#3b82f6',
    tagline: 'Build software with a full engineering team',
    bestFor: ['Software Development', 'Full Stack', 'Enterprise'],
    capabilities: ['Full-stack development', 'Code review & testing', 'Technical documentation'],
  },
  'content-studio': {
    icon: PenTool,
    accentHex: '#10b981',
    tagline: 'Create, edit, and publish content at scale',
    bestFor: ['Content Marketing', 'Publishing', 'Creative'],
    capabilities: ['Article & blog writing', 'Design & illustration', 'Editorial workflow'],
  },
  'product-team': {
    icon: Rocket,
    accentHex: '#8b5cf6',
    tagline: 'Design and ship products from research to launch',
    bestFor: ['Product Strategy', 'Design Thinking', 'Agile'],
    capabilities: ['User research', 'Product strategy', 'Design prototyping'],
  },
  'agency-lite': {
    icon: Briefcase,
    accentHex: '#f59e0b',
    tagline: 'Lean team for client projects and quick deliveries',
    bestFor: ['Client Work', 'Freelance', 'Fast Delivery'],
    capabilities: ['Fast turnaround', 'Multi-client support', 'Flexible roles'],
  },
  'ai-startup': {
    icon: Brain,
    accentHex: '#06b6d4',
    tagline: 'Research-first team pushing the boundaries of AI',
    bestFor: ['Machine Learning', 'Research', 'Data Science'],
    capabilities: ['ML research', 'Data analysis', 'Rapid prototyping'],
  },
  'create-your-own': {
    icon: Wrench,
    accentHex: '#34d399',
    tagline: 'Design your office from scratch in the 3D Studio editor',
    bestFor: ['Custom layout', 'Full creative control'],
    capabilities: ['3D Studio Editor', 'Custom plot size', 'Free placement'],
  },
};

export const CREATE_YOUR_OWN_TEMPLATE: CompanyTemplate = {
  id: 'create-your-own',
  name: 'Create Your Own',
  description: 'Design your office from scratch in the 3D Studio editor',
  icon: '🛠',
  layoutPreset: 'custom',
  employees: [],
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
