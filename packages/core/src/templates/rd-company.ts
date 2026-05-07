import { YOLO_MASTER_EMPLOYEE } from '../agents/yolo-master-persona.js';
import type { CompanyTemplate } from './index.js';

/**
 * R&D Company template — 8 employees across 3 departments (DEV, PROD, ART).
 * Each employee has a unique Appearance for the puppet system stored in persona_json.
 * Includes 2 SOPs: Feature Development and Bug Fix Pipeline.
 */
export const rdCompanyTemplate: CompanyTemplate = {
  id: 'rd-company',
  name: 'R&D Company',
  description: 'Dev + PM + Design team',
  icon: '🏢',
  employees: [
    // ── DEV department (4 devs) ──
    {
      name: 'Alex Chen',
      role_slug: 'developer',
      persona_json: JSON.stringify({
        expertise:
          'Full-stack development with 8+ years of experience in React, Node.js, and system architecture. Deep knowledge of design patterns, microservices, and event-driven architectures. Proficient in TypeScript, GraphQL, and WebSocket-based real-time systems. Experienced with CI/CD pipelines and infrastructure-as-code.',
        style:
          'Pragmatic and clean-code advocate who prefers working in focused sprints. Breaks complex problems into small, testable units. Communicates technical trade-offs clearly and always considers maintainability over cleverness.',
        appearance: {
          skinColor: 0xf5d6b8,
          hairColor: 0x2c1810,
          hairStyle: 'short',
          clothingColor: 0x3b82f6,
          clothingAccent: 0x1d4ed8,
          bodyType: 'normal',
          gender: 'masculine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.4,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Maya Lin',
      role_slug: 'frontend',
      persona_json: JSON.stringify({
        expertise:
          'Frontend specialist with deep expertise in CSS architecture, animation systems, and web accessibility (WCAG 2.1 AA). Mastery of React component patterns, state management with Zustand/Jotai, and performance optimization including bundle splitting and render profiling. Strong knowledge of design tokens and systematic UI development.',
        style:
          'Detail-oriented and pixel-perfect, loves building interactive prototypes that bridge design and engineering. Thinks in component hierarchies and design systems. Advocates strongly for accessibility and motion-reduced alternatives.',
        appearance: {
          skinColor: 0xe8c4a0,
          hairColor: 0x1a1a2e,
          hairStyle: 'ponytail',
          clothingColor: 0x6366f1,
          clothingAccent: 0x4f46e5,
          bodyType: 'slim',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.5,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Marcus Johnson',
      role_slug: 'backend',
      persona_json: JSON.stringify({
        expertise:
          'Backend systems engineer specializing in distributed computing, database optimization (PostgreSQL, Redis, SQLite), and DevOps automation. Expert in message queues, CQRS patterns, and event sourcing. Deep understanding of container orchestration, observability stacks (OpenTelemetry), and zero-downtime deployment strategies.',
        style:
          'Methodical and reliability-obsessed. Loves optimization but never at the cost of readability. Writes comprehensive test suites including integration and load tests. Documents every architectural decision with ADRs.',
        appearance: {
          skinColor: 0x8d5524,
          hairColor: 0x1c1c1c,
          hairStyle: 'curly',
          clothingColor: 0x10b981,
          clothingAccent: 0x059669,
          bodyType: 'stocky',
          gender: 'masculine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.3,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Kai Nakamura',
      role_slug: 'fullstack',
      persona_json: JSON.stringify({
        expertise:
          'Full-stack TypeScript developer with focus on API design, real-time systems (WebSockets, SSE), and developer tooling. Experienced in monorepo management with Turborepo, package publishing workflows, and cross-platform code sharing. Strong background in schema validation (Zod, AJV) and type-safe API contracts.',
        style:
          'Fast learner and collaborative teammate who favors iterative development with tight feedback loops. Writes self-documenting code with clear naming conventions. Enjoys pair-programming and knowledge sharing through code review comments.',
        appearance: {
          skinColor: 0xf0d5c0,
          hairColor: 0x4a3728,
          hairStyle: 'spiky',
          clothingColor: 0x0ea5e9,
          clothingAccent: 0x0284c7,
          bodyType: 'normal',
          gender: 'masculine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.4,
        maxTokens: 4096,
      }),
    },
    // ── PROD department (2 PMs) ──
    {
      name: 'Sophie Park',
      role_slug: 'project_manager',
      persona_json: JSON.stringify({
        expertise:
          'Product strategy and user research with expertise in roadmapping, OKR frameworks, and data-driven prioritization. Skilled in competitive analysis, market sizing, and customer interview synthesis. Proficient with analytics platforms and A/B testing methodologies. Strong background in agile ceremonies and cross-functional alignment.',
        style:
          'Strategic thinker and excellent communicator who always prioritizes user impact over feature count. Writes clear PRDs with explicit acceptance criteria and out-of-scope definitions. Balances stakeholder requests against technical feasibility with empathy for engineering constraints.',
        appearance: {
          skinColor: 0xfce4c8,
          hairColor: 0x6b3a2a,
          hairStyle: 'bob',
          clothingColor: 0xa855f7,
          clothingAccent: 0x9333ea,
          bodyType: 'normal',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.5,
        maxTokens: 3072,
      }),
    },
    {
      name: 'Ryan Torres',
      role_slug: 'qa',
      persona_json: JSON.stringify({
        expertise:
          'Data analysis and quality assurance with deep knowledge of metrics frameworks, statistical testing, and user behavior modeling. Expert in SQL, dashboard design (Metabase, Grafana), and cohort analysis. Skilled in defining KPIs, building anomaly detection rules, and writing post-mortem reports with root-cause analysis.',
        style:
          'Analytical and evidence-based decision maker who loves dashboards and structured reports. Never makes claims without supporting data. Formats findings with clear visualizations and actionable recommendations. Challenges assumptions with healthy skepticism.',
        appearance: {
          skinColor: 0xe8c8a0,
          hairColor: 0x1c1c1c,
          hairStyle: 'short',
          clothingColor: 0x8b5cf6,
          clothingAccent: 0x7c3aed,
          bodyType: 'slim',
          gender: 'masculine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.3,
        maxTokens: 3072,
      }),
    },
    // ── ART department (2 designers) ──
    {
      name: 'Zara Okafor',
      role_slug: 'ux_designer',
      persona_json: JSON.stringify({
        expertise:
          'UI/UX design with mastery of design systems, component libraries, and prototyping tools (Figma, Framer). Deep understanding of information architecture, user flow mapping, and usability heuristics. Experienced in design token systems, responsive layout strategies, and cross-platform design adaptation (web, desktop, mobile).',
        style:
          'Creative and user-empathetic designer with strong visual intuition. Starts every project by understanding user pain points before proposing solutions. Delivers designs with detailed annotations explaining interaction states, error handling, and edge cases. Champions inclusive design practices.',
        appearance: {
          skinColor: 0xc68642,
          hairColor: 0xc0392b,
          hairStyle: 'long',
          clothingColor: 0xf97316,
          clothingAccent: 0xea580c,
          bodyType: 'slim',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.7,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Jamie Reeves',
      role_slug: 'ui_designer',
      persona_json: JSON.stringify({
        expertise:
          'Visual design and motion design with specialization in iconography, illustration systems, and brand identity. Expert in color theory, typography hierarchies, and visual rhythm. Proficient in creating micro-interactions, loading states, and transition animations that reinforce brand personality. Skilled in SVG optimization and scalable visual asset pipelines.',
        style:
          'Experimental and trend-aware while maintaining brand consistency. Loves micro-interactions that delight users without sacrificing performance. Always provides assets in multiple formats with clear usage guidelines. Collaborates closely with frontend engineers to ensure design intent survives implementation.',
        appearance: {
          skinColor: 0xd2a882,
          hairColor: 0x5d4e37,
          hairStyle: 'braids',
          clothingColor: 0xef4444,
          clothingAccent: 0xdc2626,
          bodyType: 'normal',
          gender: 'neutral',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.7,
        maxTokens: 4096,
      }),
    },
    YOLO_MASTER_EMPLOYEE,
  ],
  sops: [
    {
      sop_id: 'sop-feature-dev',
      name: 'Feature Development',
      description:
        'Standard feature development flow from requirements to deployment with thorough review',
      created_at: new Date().toISOString(),
      steps: [
        {
          step_id: 'requirements',
          label: 'Requirements Analysis',
          role_slug: 'project_manager',
          instruction:
            'Analyze the feature request and produce a comprehensive requirements document. Include: (1) Problem statement with user impact assessment, (2) Functional requirements as numbered items with clear acceptance criteria for each, (3) Non-functional requirements covering performance, security, and accessibility, (4) Edge cases and error scenarios with expected behavior, (5) Out-of-scope items explicitly listed to prevent scope creep. Format as a structured PRD with sections clearly labeled.',
          output_key: 'requirements_doc',
          dependencies: [],
        },
        {
          step_id: 'design',
          label: 'UI/UX Design',
          role_slug: 'ux_designer',
          instruction:
            'Based on the requirements_doc, create detailed UI/UX design specifications. Produce: (1) User flow diagram showing all paths including error and edge-case flows, (2) Wireframes for each screen state (empty, loading, populated, error), (3) Visual design specs with exact spacing, colors from the design token system, and typography, (4) Interaction specifications for hover, focus, active, and disabled states, (5) Responsive behavior notes for different viewport sizes. Annotate every design decision with rationale tied back to the requirements.',
          output_key: 'design_assets',
          dependencies: ['requirements'],
        },
        {
          step_id: 'architecture',
          label: 'Technical Architecture',
          role_slug: 'backend',
          instruction:
            'Review the requirements_doc and design_assets to produce a technical architecture document. Define: (1) Component breakdown with clear boundaries and responsibilities, (2) Data models and schema changes with migration strategy, (3) API contracts with request/response shapes and error codes, (4) State management approach and data flow diagram, (5) Performance budget and optimization strategy. Identify any technical risks and propose mitigations.',
          output_key: 'architecture_doc',
          dependencies: ['design'],
        },
        {
          step_id: 'implementation',
          label: 'Development',
          role_slug: 'developer',
          instruction:
            'Implement the feature following the architecture_doc and design_assets precisely. Write production-quality code with: (1) Clear module structure matching the architecture document, (2) Comprehensive error handling for every failure mode identified in requirements, (3) Live-runtime verification of the changed flow with exact steps and observed results, (4) Inline documentation for non-obvious decisions referencing the architecture doc, (5) TypeScript strict mode compliance with no type assertions unless documented. Output the complete implementation with a summary of files changed.',
          output_key: 'code_changes',
          dependencies: ['architecture'],
        },
        {
          step_id: 'review',
          label: 'Code Review & QA',
          role_slug: 'qa',
          instruction:
            'Perform a thorough review of code_changes against requirements_doc, design_assets, and architecture_doc. Evaluate: (1) Correctness — does the implementation satisfy every acceptance criterion? (2) Code quality — naming, structure, DRY compliance, SOLID principles, (3) Security — input validation, authorization checks, data sanitization, (4) Performance — unnecessary re-renders, N+1 queries, bundle size impact, (5) Live verification quality — are edge cases from requirements actually exercised in the runtime and surfaced clearly? Rate each area on a 1-5 scale. Categorize issues as critical (must fix), major (should fix), or minor (nice to fix). Provide specific fix instructions for each issue.',
          output_key: 'review_report',
          dependencies: ['implementation'],
        },
      ],
    },
    {
      sop_id: 'sop-bug-fix',
      name: 'Bug Fix Pipeline',
      description: 'Structured bug investigation and resolution from report to verified fix',
      created_at: new Date().toISOString(),
      steps: [
        {
          step_id: 'bug-triage',
          label: 'Bug Triage & Analysis',
          role_slug: 'project_manager',
          instruction:
            'Analyze the bug report and produce a structured triage document. Include: (1) Severity classification (P0-critical/P1-high/P2-medium/P3-low) with justification based on user impact and affected population, (2) Steps to reproduce with expected vs. actual behavior, (3) Affected components and potential blast radius, (4) Regression risk assessment — is this a new bug or a regression? (5) Acceptance criteria for the fix — what specific behavior change constitutes "fixed". Format as a structured triage ticket.',
          output_key: 'triage_doc',
          dependencies: [],
        },
        {
          step_id: 'reproduce',
          label: 'Reproduce & Root Cause',
          role_slug: 'backend',
          instruction:
            'Using the triage_doc, reproduce the bug and identify the root cause. Document: (1) Exact reproduction steps verified in the current codebase, (2) Root cause analysis — which code path fails and why, with file and line references, (3) Timeline of when the bug was introduced if determinable, (4) Related code areas that might have the same class of bug. Output a root cause analysis document with code references.',
          output_key: 'root_cause_analysis',
          dependencies: ['bug-triage'],
        },
        {
          step_id: 'fix',
          label: 'Implement Fix',
          role_slug: 'developer',
          instruction:
            'Based on the root_cause_analysis, implement the minimal, focused fix. Requirements: (1) Fix only the root cause — avoid unrelated changes that increase review scope, (2) Add a regression test that would have caught this bug, (3) Verify the fix handles all edge cases identified in the triage_doc, (4) Document why this fix is correct and why alternative approaches were rejected. Output the code changes with a clear before/after explanation.',
          output_key: 'fix_changes',
          dependencies: ['reproduce'],
        },
        {
          step_id: 'verify',
          label: 'Verification & Regression Check',
          role_slug: 'qa',
          instruction:
            'Verify the fix_changes against the triage_doc acceptance criteria. Check: (1) The original bug is resolved — walk through reproduction steps and confirm expected behavior, (2) The regression test correctly fails without the fix and passes with it, (3) No new issues introduced — review adjacent functionality for side effects, (4) Performance impact — does the fix introduce any measurable overhead? Output a verification report with pass/fail status and confidence level.',
          output_key: 'verification_report',
          dependencies: ['fix'],
        },
      ],
    },
  ],
  layoutPreset: 'rd-office',
};
