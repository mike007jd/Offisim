/**
 * Showcase data displayed when the platform API is unavailable or returns empty.
 * This gives the homepage life even without a running backend.
 */

export interface ShowcaseListing {
  listing_id: string;
  slug: string;
  title: string;
  kind: 'employee' | 'skill' | 'sop' | 'company_template' | 'office_layout' | 'bundle';
  summary: string;
  creator_handle: string;
  creator_name: string;
  install_count: number;
  rating: number;
  tags: string[];
  latest_version: string;
}

export const SHOWCASE_LISTINGS: ShowcaseListing[] = [
  {
    listing_id: 'sc-001',
    slug: 'senior-react-architect',
    title: 'Senior React Architect',
    kind: 'employee',
    summary:
      'Deep expertise in React 19, server components, and performance optimization. Excels at code reviews, mentoring, and building scalable frontend architectures.',
    creator_handle: 'aics-official',
    creator_name: 'AICS Official',
    install_count: 2847,
    rating: 4.8,
    tags: ['react', 'typescript', 'architecture', 'mentoring'],
    latest_version: '1.2.0',
  },
  {
    listing_id: 'sc-002',
    slug: 'code-review-protocol',
    title: 'Code Review Protocol',
    kind: 'sop',
    summary:
      'Multi-stage review SOP with automated checks, context-aware feedback, and approval gates. Reduces bugs by 40% in simulated environments.',
    creator_handle: 'workflow-labs',
    creator_name: 'Workflow Labs',
    install_count: 1923,
    rating: 4.6,
    tags: ['code-review', 'quality', 'workflow', 'automation'],
    latest_version: '2.0.1',
  },
  {
    listing_id: 'sc-003',
    slug: 'typescript-debugging-mastery',
    title: 'TypeScript Debugging Mastery',
    kind: 'skill',
    summary:
      'Advanced debugging skill covering type inference issues, generic constraints, conditional types, and runtime error patterns.',
    creator_handle: 'type-forge',
    creator_name: 'TypeForge',
    install_count: 1456,
    rating: 4.9,
    tags: ['typescript', 'debugging', 'diagnostics'],
    latest_version: '1.0.3',
  },
  {
    listing_id: 'sc-004',
    slug: 'product-team-starter',
    title: 'Product Team Starter',
    kind: 'company_template',
    summary:
      'Complete product team with PM, 3 developers, designer, and QA. Pre-configured sprints, standups, and retrospective SOPs.',
    creator_handle: 'aics-official',
    creator_name: 'AICS Official',
    install_count: 3201,
    rating: 4.7,
    tags: ['product', 'team', 'agile', 'starter'],
    latest_version: '1.1.0',
  },
  {
    listing_id: 'sc-005',
    slug: 'open-studio-layout',
    title: 'Open Studio Layout',
    kind: 'office_layout',
    summary:
      'Modern open-plan office with collaborative zones, focus pods, meeting rooms, and a lounge area. Optimized for teams of 6-15.',
    creator_handle: 'space-design',
    creator_name: 'Space Design Co.',
    install_count: 892,
    rating: 4.5,
    tags: ['open-plan', 'collaborative', 'modern'],
    latest_version: '1.0.0',
  },
  {
    listing_id: 'sc-006',
    slug: 'fullstack-development-bundle',
    title: 'Full-Stack Dev Bundle',
    kind: 'bundle',
    summary:
      'Everything you need: 5 specialized developers, debugging skills, code review SOP, and a startup office layout. One-click setup.',
    creator_handle: 'aics-official',
    creator_name: 'AICS Official',
    install_count: 4102,
    rating: 4.8,
    tags: ['fullstack', 'bundle', 'starter', 'complete'],
    latest_version: '2.1.0',
  },
];

export const SHOWCASE_STATS = {
  totalAssets: 580,
  totalCreators: 127,
  totalInstalls: 42_300,
  categories: 6,
};

export const CATEGORIES = [
  {
    kind: 'employee' as const,
    title: 'AI Employees',
    description: 'Skilled AI agents with defined roles, expertise, and working styles.',
    count: 234,
    gradient: 'from-blue-500/20 to-blue-600/5',
    border: 'border-blue-500/30',
    icon: 'user',
    accent: 'text-blue-400',
  },
  {
    kind: 'skill' as const,
    title: 'Skills',
    description: 'Specialized capabilities that enhance employee performance.',
    count: 156,
    gradient: 'from-emerald-500/20 to-emerald-600/5',
    border: 'border-emerald-500/30',
    icon: 'zap',
    accent: 'text-emerald-400',
  },
  {
    kind: 'sop' as const,
    title: 'SOPs',
    description: 'Standard operating procedures for repeatable team workflows.',
    count: 89,
    gradient: 'from-amber-500/20 to-amber-600/5',
    border: 'border-amber-500/30',
    icon: 'workflow',
    accent: 'text-amber-400',
  },
  {
    kind: 'company_template' as const,
    title: 'Company Templates',
    description: 'Pre-built teams with employees, SOPs, and office layouts ready to run.',
    count: 42,
    gradient: 'from-violet-500/20 to-violet-600/5',
    border: 'border-violet-500/30',
    icon: 'building',
    accent: 'text-violet-400',
  },
  {
    kind: 'office_layout' as const,
    title: 'Office Layouts',
    description: 'Custom floor plans with department zones and workstation arrangements.',
    count: 38,
    gradient: 'from-cyan-500/20 to-cyan-600/5',
    border: 'border-cyan-500/30',
    icon: 'layout',
    accent: 'text-cyan-400',
  },
  {
    kind: 'bundle' as const,
    title: 'Bundles',
    description: 'Curated collections combining employees, skills, and SOPs together.',
    count: 21,
    gradient: 'from-rose-500/20 to-rose-600/5',
    border: 'border-rose-500/30',
    icon: 'package',
    accent: 'text-rose-400',
  },
];
