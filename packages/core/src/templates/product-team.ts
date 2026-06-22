import { createZoneBlueprint } from '@offisim/shared-types';
import type { CompanyTemplateDefinition } from './index.js';

/**
 * Product Team — discover/spec → design → parallel implementation → review/QA → ship.
 *
 * Source plan §3.3: a Product Designer is added so the wizard's "Design
 * prototyping" promise is real, and the single Product Hub is split into a
 * Product Studio (PM + Designer) and an Engineering Bay (backend + fullstack +
 * QA) so the stage-gated, shared-screen handoff has spatial meaning.
 */
export const productTeamTemplate: CompanyTemplateDefinition = {
  id: 'product-team',
  name: 'Product Team',
  description: 'Spec, design, build, and ship a product with a stage-gated cross-functional team.',
  presentation: {
    icon: 'Rocket',
    accent: '#8b5cf6',
    tagline: 'Design and ship products from research to launch',
    bestFor: ['Product Strategy', 'Design Thinking', 'Agile'],
    capabilities: ['User research', 'Product strategy', 'Design prototyping'],
  },
  layoutPreset: 'product-hub',
  performance: { family: 'product', pace: 'balanced', collaborationBias: 'group', motifWeights: {} },
  zones: [
    createZoneBlueprint({
      slug: 'zone-product',
      archetype: 'workspace',
      label: 'PRODUCT STUDIO',
      accentColor: '#8b5cf6',
      floorColor: 0x3a2a5c,
      cx: -13.2,
      cz: 10.6,
      w: 12.4,
      d: 8.8,
      targetRoles: ['product_manager', 'ux_designer', 'designer'],
      deskSlots: 3,
      sortOrder: 0,
    }),
    createZoneBlueprint({
      slug: 'zone-eng',
      archetype: 'workspace',
      label: 'ENGINEERING BAY',
      accentColor: '#0ea5e9',
      floorColor: 0x1e3a5c,
      cx: 0.6,
      cz: 10.6,
      w: 12.4,
      d: 8.8,
      targetRoles: ['backend', 'fullstack', 'qa'],
      deskSlots: 3,
      sortOrder: 1,
    }),
    createZoneBlueprint({
      slug: 'zone-library',
      archetype: 'library',
      label: 'LIBRARY',
      cx: -11.3,
      cz: 0.7,
      w: 13.2,
      d: 7.6,
      sortOrder: 2,
    }),
    createZoneBlueprint({
      slug: 'zone-rest',
      archetype: 'rest',
      label: 'REST AREA',
      cx: 6.3,
      cz: 0.7,
      w: 13.8,
      d: 7.6,
      sortOrder: 3,
    }),
    createZoneBlueprint({
      slug: 'zone-meeting',
      archetype: 'meeting',
      label: 'WAR ROOM',
      cx: -9.4,
      cz: -8.8,
      w: 15.2,
      d: 7.4,
      sortOrder: 4,
    }),
    createZoneBlueprint({
      slug: 'zone-server',
      archetype: 'server',
      label: 'SERVER ROOM',
      cx: 9.4,
      cz: -8.8,
      w: 15.2,
      d: 7.4,
      sortOrder: 5,
    }),
  ],
  employees: [
    {
      key: 'ava-mitchell',
      name: 'Ava Mitchell',
      roleSlug: 'product_manager',
      displayTitle: 'Product Manager',
      capabilities: ['prd-authoring', 'prioritization', 'user-stories', 'acceptance-criteria'],
      persona: {
        profile: {
          expertise:
            'Product management and requirements engineering with deep expertise in user story mapping, acceptance criteria definition, and edge case identification. Skilled in competitive analysis, market sizing, and product-market fit assessment. Proficient in prioritization frameworks (RICE, MoSCoW, Kano) and stakeholder alignment. Experienced in writing PRDs that engineers actually read — structured, precise, and free of ambiguity.',
          workingStyle:
            'Precise thinker who transforms vague feature requests into actionable specifications with clear acceptance criteria and measurable outcomes. Defines "done" before work begins. Actively seeks out edge cases and failure modes during specification, not after implementation. Communicates trade-offs explicitly rather than hiding complexity behind simple requirements.',
          communication: 'high',
          risk: 'balanced',
          decisionStyle: 'directive',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xf0d5c0,
          hairColor: 0x4a3728,
          hairStyle: 'ponytail',
          clothingColor: 0x8b5cf6,
          clothingAccent: 0x7c3aed,
          bodyType: 'normal',
          gender: 'feminine',
        },
      },
    },
    {
      key: 'tara-singh',
      name: 'Tara Singh',
      roleSlug: 'ux_designer',
      displayTitle: 'Product Designer',
      capabilities: ['ux-research', 'prototyping', 'interaction-design', 'design-systems'],
      persona: {
        profile: {
          expertise:
            'Product design across discovery and delivery: user research, journey mapping, wireframing, and high-fidelity interactive prototypes (Figma). Strong in interaction design, design systems, and validating flows with usability testing before engineering builds them.',
          workingStyle:
            'User-first and collaborative. Prototypes to think, pairs closely with the PM on scope and with engineers on feasibility, and annotates designs with states and edge cases so handoff is unambiguous.',
          communication: 'high',
          risk: 'balanced',
          decisionStyle: 'collaborative',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xc68642,
          hairColor: 0x1c1c1c,
          hairStyle: 'long',
          clothingColor: 0xf472b6,
          clothingAccent: 0xdb2777,
          bodyType: 'slim',
          gender: 'feminine',
        },
      },
    },
    {
      key: 'noah-kim',
      name: 'Noah Kim',
      roleSlug: 'backend',
      displayTitle: 'Backend Engineer',
      capabilities: ['api-design', 'data-modeling', 'postgresql', 'architecture'],
      persona: {
        profile: {
          expertise:
            'Systems architecture and API design with deep knowledge of data modeling, service boundaries, and distributed system patterns. Expert in PostgreSQL schema design, migration strategies, and query optimization. Proficient in RESTful and GraphQL API design with emphasis on backward compatibility and versioning. Strong background in event-driven architectures, CQRS, and eventual consistency patterns. Experienced in performance profiling and capacity planning.',
          workingStyle:
            'Methodical architect who designs clean interfaces and data flows before writing any code. Produces design documents that serve as living references, not throwaway artifacts. Identifies coupling risks early and proposes abstractions that will age well. Defaults to the simplest solution that satisfies all requirements, adding complexity only when justified by specific constraints.',
          communication: 'low',
          risk: 'conservative',
          decisionStyle: 'analytical',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xe8c8a0,
          hairColor: 0x2c1810,
          hairStyle: 'short',
          clothingColor: 0x059669,
          clothingAccent: 0x047857,
          bodyType: 'stocky',
          gender: 'masculine',
        },
      },
    },
    {
      key: 'elena-volkov',
      name: 'Elena Volkov',
      roleSlug: 'fullstack',
      displayTitle: 'Full-stack Engineer',
      capabilities: ['react', 'typescript', 'verification', 'testing'],
      persona: {
        profile: {
          expertise:
            'Production-grade full-stack implementation with expertise in React component architecture, state management patterns, and server-side integration. Deep knowledge of TypeScript type system, generic patterns, and compile-time safety guarantees. Skilled in test-driven development with comprehensive unit, integration, and snapshot testing strategies. Proficient in error boundary patterns, graceful degradation, and defensive programming.',
          workingStyle:
            'Disciplined implementer who writes clean code with runtime validation from the start, not as an afterthought. Follows the design document precisely but raises concerns immediately when the design does not account for implementation realities. Documents non-obvious decisions inline with "why" comments. Refactors proactively when she sees patterns that will cause maintenance burden.',
          communication: 'medium',
          risk: 'balanced',
          decisionStyle: 'analytical',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xfce4c8,
          hairColor: 0xc0392b,
          hairStyle: 'bob',
          clothingColor: 0x0ea5e9,
          clothingAccent: 0x0284c7,
          bodyType: 'slim',
          gender: 'feminine',
        },
      },
    },
    {
      key: 'raj-patel',
      name: 'Raj Patel',
      roleSlug: 'qa',
      displayTitle: 'QA / Security Reviewer',
      capabilities: ['code-review', 'security-audit', 'performance', 'quality-assurance'],
      persona: {
        profile: {
          expertise:
            'Code review and quality analysis with deep knowledge of security vulnerabilities (OWASP Top 10), performance anti-patterns, and architectural code smells. Expert in static analysis tooling, type-safety auditing, and dependency risk assessment. Skilled in structured critique that distinguishes between subjective style preferences and objective quality issues. Proficient in load testing, memory profiling, and bundle size analysis.',
          workingStyle:
            'Thorough reviewer who categorizes every issue by severity (critical/major/minor) and provides specific fix suggestions with code examples. Never blocks a PR without explaining the "why" behind the objection. Reviews against three lenses: correctness, maintainability, and resilience. Celebrates good patterns as enthusiastically as flagging bad ones.',
          communication: 'medium',
          risk: 'conservative',
          decisionStyle: 'analytical',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xc68642,
          hairColor: 0x1c1c1c,
          hairStyle: 'spiky',
          clothingColor: 0xf97316,
          clothingAccent: 0xea580c,
          bodyType: 'normal',
          gender: 'masculine',
        },
      },
    },
  ],
};
