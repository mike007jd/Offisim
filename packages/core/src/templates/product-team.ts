import { createZoneBlueprint } from '@offisim/shared-types';
import { YOLO_MASTER_EMPLOYEE } from '../agents/yolo-master-persona.js';
import type { CompanyTemplate } from './index.js';

/**
 * Product Team template — 4 employees across a specify-design-implement-review pipeline.
 * Showcases the Spec-Driven collaboration pattern.
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
        appearance: {
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
        appearance: {
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
        appearance: {
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
        appearance: {
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
  ],  layoutPreset: 'product-hub',
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
      targetRoles: ['product_manager', 'backend', 'fullstack', 'qa', 'yolo_master'],
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
