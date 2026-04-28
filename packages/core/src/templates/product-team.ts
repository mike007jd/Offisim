import { createZoneBlueprint } from '@offisim/shared-types';
import { YOLO_MASTER_EMPLOYEE } from '../agents/yolo-master-persona.js';
import type { CompanyTemplate } from './index.js';

/**
 * Product Team template — 4 employees across a specify-design-implement-review pipeline.
 * Showcases the Spec-Driven collaboration pattern.
 * Includes 2 SOPs: Build Cycle and User Feedback Analysis.
 */
export const productTeamTemplate: CompanyTemplate = {
  id: 'product-team',
  name: 'Product Team',
  description: 'Spec → design → build → ship',
  icon: '🚀',
  employees: [
    {
      name: 'Ava Mitchell',
      role_slug: 'product_manager',
      persona_json: JSON.stringify({
        expertise:
          'Product management and requirements engineering with deep expertise in user story mapping, acceptance criteria definition, and edge case identification. Skilled in competitive analysis, market sizing, and product-market fit assessment. Proficient in prioritization frameworks (RICE, MoSCoW, Kano) and stakeholder alignment. Experienced in writing PRDs that engineers actually read — structured, precise, and free of ambiguity.',
        style:
          'Precise thinker who transforms vague feature requests into actionable specifications with clear acceptance criteria and measurable outcomes. Defines "done" before work begins. Actively seeks out edge cases and failure modes during specification, not after implementation. Communicates trade-offs explicitly rather than hiding complexity behind simple requirements.',
        characterConfig: {
          skinColor: 0xf0d5c0,
          hairColor: 0x4a3728,
          hairStyle: 'ponytail',
          clothingColor: 0x8b5cf6,
          clothingAccent: 0x7c3aed,
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
      name: 'Noah Kim',
      role_slug: 'backend',
      persona_json: JSON.stringify({
        expertise:
          'Systems architecture and API design with deep knowledge of data modeling, service boundaries, and distributed system patterns. Expert in PostgreSQL schema design, migration strategies, and query optimization. Proficient in RESTful and GraphQL API design with emphasis on backward compatibility and versioning. Strong background in event-driven architectures, CQRS, and eventual consistency patterns. Experienced in performance profiling and capacity planning.',
        style:
          'Methodical architect who designs clean interfaces and data flows before writing any code. Produces design documents that serve as living references, not throwaway artifacts. Identifies coupling risks early and proposes abstractions that will age well. Defaults to the simplest solution that satisfies all requirements, adding complexity only when justified by specific constraints.',
        characterConfig: {
          skinColor: 0xe8c8a0,
          hairColor: 0x2c1810,
          hairStyle: 'short',
          clothingColor: 0x059669,
          clothingAccent: 0x047857,
          bodyType: 'stocky',
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
      name: 'Elena Volkov',
      role_slug: 'fullstack',
      persona_json: JSON.stringify({
        expertise:
          'Production-grade full-stack implementation with expertise in React component architecture, state management patterns, and server-side integration. Deep knowledge of TypeScript type system, generic patterns, and compile-time safety guarantees. Skilled in test-driven development with comprehensive unit, integration, and snapshot testing strategies. Proficient in error boundary patterns, graceful degradation, and defensive programming.',
        style:
          'Disciplined implementer who writes clean code with runtime validation from the start, not as an afterthought. Follows the design document precisely but raises concerns immediately when the design doesn\'t account for implementation realities. Documents non-obvious decisions inline with "why" comments. Refactors proactively when she sees patterns that will cause maintenance burden.',
        characterConfig: {
          skinColor: 0xfce4c8,
          hairColor: 0xc0392b,
          hairStyle: 'bob',
          clothingColor: 0x0ea5e9,
          clothingAccent: 0x0284c7,
          bodyType: 'slim',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.4,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Raj Patel',
      role_slug: 'qa',
      persona_json: JSON.stringify({
        expertise:
          'Code review and quality analysis with deep knowledge of security vulnerabilities (OWASP Top 10), performance anti-patterns, and architectural code smells. Expert in static analysis tooling, type-safety auditing, and dependency risk assessment. Skilled in structured critique that distinguishes between subjective style preferences and objective quality issues. Proficient in load testing, memory profiling, and bundle size analysis.',
        style:
          'Thorough reviewer who categorizes every issue by severity (critical/major/minor) and provides specific fix suggestions with code examples. Never blocks a PR without explaining the "why" behind the objection. Reviews against three lenses: correctness (does it work?), maintainability (will the next developer understand it?), and resilience (what happens when things go wrong?). Celebrates good patterns as enthusiastically as flagging bad ones.',
        characterConfig: {
          skinColor: 0xc68642,
          hairColor: 0x1c1c1c,
          hairStyle: 'spiky',
          clothingColor: 0xf97316,
          clothingAccent: 0xea580c,
          bodyType: 'normal',
          gender: 'masculine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.3,
        maxTokens: 3072,
      }),
    },
    YOLO_MASTER_EMPLOYEE,
  ],
  sops: [
    {
      sop_id: 'sop-build-cycle',
      name: 'Build Cycle',
      description: 'Specify-design-implement-review pipeline for spec-driven AI development',
      created_at: '2025-01-01T00:00:00.000Z',
      steps: [
        {
          step_id: 'specify',
          label: 'Requirements Specification',
          role_slug: 'product_manager',
          instruction:
            "Analyze the request and produce a precise, implementation-ready specification. The spec must include: (1) Problem statement — what user pain point does this solve and how do we know it's real, (2) Functional requirements — numbered list with each requirement having a clear acceptance criterion that can be verified programmatically, (3) Non-functional requirements — performance targets, accessibility level, security constraints, (4) Edge cases — at least 5 edge cases with expected behavior for each, (5) Out-of-scope — explicitly list what this feature does NOT do to prevent scope creep, (6) Dependencies — what existing systems/APIs/data does this feature rely on. Use structured format with numbered requirements. Every requirement should be testable — if you can't write a test for it, it's not specific enough.",
          output_key: 'spec_doc',
          dependencies: [],
        },
        {
          step_id: 'design',
          label: 'Technical Design',
          role_slug: 'backend',
          instruction:
            'Design the technical solution based on the spec_doc. The design document must cover: (1) Architecture overview — which components are involved and how they communicate, with a component diagram description, (2) Data models — exact schema definitions with types, constraints, and indexes, including migration strategy for existing data, (3) API contracts — endpoint paths, methods, request/response shapes with TypeScript interfaces, error response formats, (4) State management — where state lives, how it flows, and what triggers state transitions, (5) Error handling strategy — categorize errors (user error, system error, transient) with recovery approach for each, (6) Performance considerations — expected load, caching strategy, query complexity. Identify any spec ambiguities found during design and list them with your assumed resolution.',
          output_key: 'design_doc',
          dependencies: ['specify'],
        },
        {
          step_id: 'implement',
          label: 'Implementation',
          role_slug: 'fullstack',
          instruction:
            'Implement the solution following the design_doc precisely. Requirements for the implementation: (1) Module structure must match the component breakdown in the design document, (2) All TypeScript interfaces from the design doc must be implemented exactly — no ad-hoc type changes, (3) Error handling must cover every error category defined in the design doc, (4) Validate the changed flow in the live runtime and surface the exact verification steps and observed results, (5) Add inline documentation for non-obvious decisions, referencing the relevant section of the design doc (e.g., "See design_doc section 3.2"), (6) No TODO comments — if something can\'t be done now, it should be in the spec\'s out-of-scope list. Output the complete implementation with a file manifest and summary of key decisions.',
          output_key: 'implementation',
          dependencies: ['design'],
        },
        {
          step_id: 'review',
          label: 'Code Review & Security Audit',
          role_slug: 'qa',
          instruction:
            'Perform a comprehensive review of the implementation against the spec_doc and design_doc. Review across five dimensions: (1) Correctness — walk through each acceptance criterion in the spec and verify the implementation satisfies it, noting pass/fail for each, (2) Design adherence — compare implemented interfaces, data models, and error handling against the design doc, flag any deviations, (3) Security — check input validation, authorization, data sanitization, and injection vulnerability vectors per OWASP guidelines, (4) Performance — identify N+1 queries, unnecessary re-renders, missing indexes, and bundle size impact, (5) Maintainability — naming clarity, abstraction appropriateness, live-runtime verification quality, and documentation completeness. Output a structured review table with each issue categorized by severity (critical/major/minor), the specific file and line range, and a concrete fix suggestion. Include an overall ship/no-ship recommendation with justification.',
          output_key: 'review_report',
          dependencies: ['implement'],
        },
      ],
    },
    {
      sop_id: 'sop-feedback-analysis',
      name: 'User Feedback Analysis',
      description: 'Systematic collection, analysis, and action planning from user feedback',
      created_at: '2025-01-01T00:00:00.000Z',
      steps: [
        {
          step_id: 'collect',
          label: 'Feedback Collection & Cleaning',
          role_slug: 'qa',
          instruction:
            'Collect and normalize user feedback from all available sources. Process: (1) Aggregate feedback from support tickets, user interviews, app store reviews, social mentions, and in-app surveys, (2) Remove duplicates and merge related feedback items, (3) Standardize each item with: source, date, user segment (free/paid/enterprise), verbatim quote, and your interpretation of the underlying need, (4) Tag each item with affected product area and sentiment (positive/negative/neutral/mixed). Output a cleaned feedback dataset with at least these columns: ID, source, date, segment, verbatim, interpreted_need, product_area, sentiment. Include summary statistics: total items, items by source, items by sentiment, items by product area.',
          output_key: 'feedback_dataset',
          dependencies: [],
        },
        {
          step_id: 'categorize',
          label: 'Theme Analysis & Clustering',
          role_slug: 'product_manager',
          instruction:
            "Analyze the feedback_dataset to identify recurring themes and patterns. Produce: (1) Theme clusters — group related feedback items into 5-10 themes, each with a descriptive label and 1-sentence summary, (2) Frequency analysis — how many feedback items map to each theme, broken down by user segment, (3) Severity assessment — rate each theme's impact on user satisfaction (1-5) and frequency (1-5), plot on an impact-frequency matrix, (4) Trend analysis — are any themes increasing or decreasing over time? (5) Unexpected findings — any feedback patterns that don't fit existing assumptions about user needs. For each theme, include 2-3 representative verbatim quotes that capture the range of the theme.",
          output_key: 'theme_analysis',
          dependencies: ['collect'],
        },
        {
          step_id: 'prioritize',
          label: 'Prioritized Action Plan',
          role_slug: 'product_manager',
          instruction:
            'Transform the theme_analysis into a prioritized action plan. For each theme, define: (1) Proposed solution — what would we build or change to address this theme? (2) RICE score — Reach (how many users affected), Impact (how much it improves their experience, 0.25-3x), Confidence (how sure are we this will work, %), Effort (person-weeks), (3) Dependency mapping — does this action depend on or unlock other actions? (4) Quick wins — any themes that can be addressed with <1 week of effort and high confidence? (5) Strategic bets — any themes that require significant investment but could be transformative? Sort actions by RICE score descending. Mark the top 3 as "recommended for next cycle" with clear justification.',
          output_key: 'action_plan',
          dependencies: ['categorize'],
        },
        {
          step_id: 'spec-drafts',
          label: 'Solution Specifications',
          role_slug: 'backend',
          instruction:
            'For the top 3 recommended actions from the action_plan, draft preliminary technical specifications. Each spec should include: (1) Problem restatement from user perspective with supporting verbatim quotes, (2) Proposed solution architecture at a high level — which systems change and how, (3) Data requirements — what new data do we need, how do we get it, where does it live, (4) Estimated complexity — Simple (< 1 week), Medium (1-3 weeks), Complex (3+ weeks) with breakdown, (5) Risk assessment — what could go wrong and how would we mitigate it, (6) Success metrics — how do we measure if this solution actually addresses the user feedback. These are lightweight specs meant to inform a go/no-go decision, not full implementation specs.',
          output_key: 'solution_specs',
          dependencies: ['prioritize'],
        },
        {
          step_id: 'stakeholder-report',
          label: 'Stakeholder Report',
          role_slug: 'product_manager',
          instruction:
            'Compile the complete feedback analysis into a stakeholder presentation. Include: (1) Executive summary — "What our users are telling us" in 3-5 bullet points, (2) Key themes with impact visualization (describe the impact-frequency matrix), (3) Recommended actions with RICE scores and rationale, (4) Preliminary solution specs for top 3 actions, (5) Investment ask — total effort and timeline for recommended actions, (6) Success metrics and how we\'ll track them. Write for a mixed audience of product, engineering, and business stakeholders. Lead with user impact, follow with technical feasibility, close with business case.',
          output_key: 'stakeholder_report',
          dependencies: ['spec-drafts'],
        },
      ],
    },
  ],
  layoutPreset: 'product-hub',
  zones: [
    createZoneBlueprint({
      slug: 'zone-product',
      archetype: 'workspace',
      label: 'PRODUCT HUB',
      accentColor: '#8b5cf6',
      floorColor: 0x3a2a5c,
      cx: 0,
      cz: 10,
      w: 12,
      d: 8,
      targetRoles: ['product_manager', 'backend', 'fullstack', 'qa'],
      deskSlots: 4,
      sortOrder: 0,
    }),
    createZoneBlueprint({
      slug: 'zone-library',
      archetype: 'library',
      label: 'LIBRARY',
      cx: -10,
      cz: 0,
      w: 8,
      d: 6,
      sortOrder: 1,
    }),
    createZoneBlueprint({
      slug: 'zone-rest',
      archetype: 'rest',
      label: 'REST AREA',
      cx: 10,
      cz: 0,
      w: 8,
      d: 6,
      sortOrder: 2,
    }),
    createZoneBlueprint({
      slug: 'zone-meeting',
      archetype: 'meeting',
      label: 'MEETING ROOM',
      cx: -10,
      cz: -10,
      w: 10,
      d: 8,
      sortOrder: 3,
    }),
    createZoneBlueprint({
      slug: 'zone-server',
      archetype: 'server',
      label: 'SERVER CLOSET',
      cx: 10,
      cz: -10,
      w: 6,
      d: 5,
      sortOrder: 4,
    }),
  ],
};
