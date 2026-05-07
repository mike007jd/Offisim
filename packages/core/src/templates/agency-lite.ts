import { createZoneBlueprint } from '@offisim/shared-types';
import { YOLO_MASTER_EMPLOYEE } from '../agents/yolo-master-persona.js';
import type { CompanyTemplate } from './index.js';

/**
 * Agency Lite template — 5 employees for a freelancer/small studio setup.
 * Focused on client communication, creative delivery, and quality assurance.
 * Includes 3 SOPs: Client Brief Intake, Deliverable Review, and Social Media Campaign.
 */
export const agencyLiteTemplate: CompanyTemplate = {
  id: 'agency-lite',
  name: 'Agency Lite',
  description: 'Client work + creative delivery',
  icon: '🏗️',
  employees: [
    // ── Client-facing ──
    {
      name: 'Nina Vasquez',
      role_slug: 'account_manager',
      persona_json: JSON.stringify({
        expertise:
          'Client communication and stakeholder management with 10+ years in agency environments. Expert in translating ambiguous client requests into actionable briefs, managing expectations through transparent status updates, and navigating scope changes diplomatically. Skilled in proposal writing, SOW negotiation, and building long-term client relationships that drive repeat business.',
        style:
          'Empathetic and proactive communicator who anticipates client concerns before they arise. Structures all deliverables with executive summaries for busy stakeholders. Maintains a professional yet warm tone that builds trust. Always includes clear next steps and timeline commitments in every communication.',
        appearance: {
          skinColor: 0xe8c4a0,
          hairColor: 0x4a3728,
          hairStyle: 'bob',
          clothingColor: 0x6366f1,
          clothingAccent: 0x4f46e5,
          bodyType: 'normal',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.6,
        maxTokens: 3072,
      }),
    },
    // ── Coordination ──
    {
      name: 'Ray Chen',
      role_slug: 'project_manager',
      persona_json: JSON.stringify({
        expertise:
          'Project coordination and resource allocation for multi-client agency workflows. Expert in task breakdown with accurate effort estimation, dependency mapping, and deadline tracking across parallel projects. Proficient with agile/kanban hybrid methodologies adapted for creative agencies. Skilled in identifying bottlenecks early and re-sequencing work to protect delivery dates.',
        style:
          'Organized and milestone-driven, maintains clear task boards with real-time progress visibility. Communicates blockers immediately with proposed solutions rather than just flagging problems. Writes concise status reports that highlight risks and mitigation plans. Balances team workload to prevent burnout during peak periods.',
        appearance: {
          skinColor: 0xf0d5c0,
          hairColor: 0x1a1a2e,
          hairStyle: 'short',
          clothingColor: 0x0ea5e9,
          clothingAccent: 0x0284c7,
          bodyType: 'normal',
          gender: 'masculine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.5,
        maxTokens: 3072,
      }),
    },
    // ── Creative ──
    {
      name: 'Amara Obi',
      role_slug: 'graphic_designer',
      persona_json: JSON.stringify({
        expertise:
          'Visual design and creative direction with specialization in brand identity systems, marketing collateral, and digital campaign assets. Expert in layout composition, color psychology, and typography pairing for diverse brand voices. Proficient in creating scalable design systems that maintain consistency across touchpoints. Strong portfolio in both B2B enterprise and B2C lifestyle brands.',
        style:
          'Bold creative thinker with strong visual intuition who balances aesthetics with business objectives. Presents multiple creative directions with rationale for each, empowering clients to make informed choices. Iterates rapidly based on feedback while maintaining design integrity. Documents design decisions with mood board references and brand alignment notes.',
        appearance: {
          skinColor: 0x8d5524,
          hairColor: 0x1c1c1c,
          hairStyle: 'braids',
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
    // ── Implementation ──
    {
      name: 'Liam Burke',
      role_slug: 'developer',
      persona_json: JSON.stringify({
        expertise:
          'Full-stack implementation for agency deliverables including landing pages, web applications, CMS integrations, and API-driven marketing tools. Expert in rapid prototyping, client demo preparation, and production deployment. Proficient in React, Next.js, headless CMS platforms (Contentful, Sanity), and email template development. Experienced with analytics integration and conversion tracking setup.',
        style:
          'Pragmatic builder who ships working demos early to gather client feedback. Writes clean, handoff-ready code that future developers can maintain without tribal knowledge. Prefers iterative delivery with each milestone being a deployable increment. Communicates technical constraints to non-technical stakeholders using analogies and visual explanations.',
        appearance: {
          skinColor: 0xfce4c8,
          hairColor: 0x8b4513,
          hairStyle: 'curly',
          clothingColor: 0x10b981,
          clothingAccent: 0x059669,
          bodyType: 'stocky',
          gender: 'masculine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.5,
        maxTokens: 4096,
      }),
    },
    // ── Quality ──
    {
      name: 'Suki Tanaka',
      role_slug: 'qa',
      persona_json: JSON.stringify({
        expertise:
          'Quality assurance and deliverable review with a sharp eye for client-readiness. Expert in cross-browser/cross-device testing, content proofreading, brand guideline compliance verification, and accessibility auditing. Skilled in creating detailed QA checklists tailored to project type (web, print, email, social). Proficient in acceptance testing against original brief requirements.',
        style:
          'Meticulous reviewer who catches edge cases and inconsistencies others miss. Structures feedback by severity with specific fix instructions rather than vague complaints. Verifies that deliverables not only work correctly but present professionally. Maintains a library of QA templates for common project types to ensure nothing falls through the cracks.',
        appearance: {
          skinColor: 0xf5d6b8,
          hairColor: 0x2c1810,
          hairStyle: 'ponytail',
          clothingColor: 0xa855f7,
          clothingAccent: 0x9333ea,
          bodyType: 'slim',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.4,
        maxTokens: 3072,
      }),
    },
    YOLO_MASTER_EMPLOYEE,
  ],
  sops: [
    {
      sop_id: 'sop-client-brief-intake',
      name: 'Client Brief Intake',
      description:
        'Structured client requirement gathering, project scoping, and creative direction',
      created_at: '2025-01-01T00:00:00.000Z',
      steps: [
        {
          step_id: 'gather-requirements',
          label: 'Gather Requirements',
          role_slug: 'account_manager',
          instruction:
            'Conduct a thorough client intake to understand their goals, constraints, timeline, and success criteria. Produce a structured brief document containing: (1) Executive summary of the project in 2-3 sentences, (2) Business objectives with measurable success metrics, (3) Target audience profile including demographics, psychographics, and key pain points, (4) Key deliverables list with format specifications (web, print, social, etc.), (5) Technical requirements and platform constraints, (6) Brand guidelines summary or reference links, (7) Timeline with key milestones and hard deadlines, (8) Budget parameters if provided. Flag any ambiguities that require client follow-up as a separate "Open Questions" section.',
          output_key: 'client_brief',
          dependencies: [],
        },
        {
          step_id: 'scope-and-plan',
          label: 'Scope & Plan',
          role_slug: 'project_manager',
          instruction:
            'Review the client_brief and decompose it into actionable work packages. Create a project plan containing: (1) Work breakdown structure with each task estimated in hours, (2) Task assignments mapped to team roles with skill justification, (3) Dependency graph showing which tasks block others, (4) Delivery milestones with client review checkpoints, (5) Risk register with probability/impact scores and mitigation strategies, (6) Resource allocation showing team utilization across the project timeline. Flag any scope items that seem underestimated or technically risky for early attention.',
          output_key: 'project_plan',
          dependencies: ['gather-requirements'],
        },
        {
          step_id: 'creative-direction',
          label: 'Creative Direction',
          role_slug: 'graphic_designer',
          instruction:
            "Based on the client_brief and project_plan, define the creative direction for all deliverables. Produce: (1) Mood board with 5-8 reference images annotated with what each reference contributes (color palette, typography feel, layout approach, photography style), (2) Color palette with primary, secondary, and accent colors including hex values and usage rules, (3) Typography system with heading and body font selections plus hierarchy rules, (4) Layout principles and grid system for the project, (5) Initial concept sketches for 2-3 key deliverables showing different creative approaches. Each concept should include a brief rationale explaining how it serves the client's business objectives.",
          output_key: 'creative_direction',
          dependencies: ['scope-and-plan'],
        },
        {
          step_id: 'client-approval',
          label: 'Client Approval Package',
          role_slug: 'account_manager',
          instruction:
            'Compile the project_plan and creative_direction into a client-ready approval package. Include: (1) Project overview restating the client\'s objectives in their language, (2) Proposed creative direction with visual references, (3) Timeline and milestone summary in a visual format, (4) Investment breakdown if applicable, (5) Clear approval request with specific items needing sign-off. Write in a professional, confident tone that builds client trust. Include a "What Happens Next" section outlining immediate next steps upon approval.',
          output_key: 'approval_package',
          dependencies: ['creative-direction'],
        },
      ],
    },
    {
      sop_id: 'sop-deliverable-review',
      name: 'Deliverable Review',
      description: 'Quality check, polishing, and professional handoff before client delivery',
      created_at: '2025-01-01T00:00:00.000Z',
      steps: [
        {
          step_id: 'qa-review',
          label: 'QA Review',
          role_slug: 'qa',
          instruction:
            'Perform a comprehensive quality review of the deliverable against the original client brief and acceptance criteria. Check systematically: (1) Completeness — every deliverable item from the brief is present and accounted for, (2) Quality — visual consistency, code functionality, content accuracy, and brand guideline compliance, (3) Cross-platform — test across target devices/browsers/formats specified in the brief, (4) Accessibility — WCAG 2.1 AA compliance for web deliverables, readability for print, (5) Edge cases — empty states, long text overflow, missing images, slow connections. Produce a structured review report with issues categorized by severity (critical: blocks delivery, major: should fix before delivery, minor: polish if time permits) and specific fix instructions for each issue.',
          output_key: 'review_report',
          dependencies: [],
        },
        {
          step_id: 'fix-and-polish',
          label: 'Fix & Polish',
          role_slug: 'developer',
          instruction:
            'Address all issues from the review_report systematically. Process: (1) Fix all critical issues first — these are delivery blockers, (2) Address major issues — these affect client perception, (3) Polish minor items if timeline allows, (4) After fixes, self-verify each issue against the original report to confirm resolution. For each fix, document what was changed and why. Ensure the deliverable is production-ready: optimized assets, clean code, no debug artifacts, proper meta tags, and analytics tracking in place.',
          output_key: 'polished_deliverable',
          dependencies: ['qa-review'],
        },
        {
          step_id: 'final-qa',
          label: 'Final QA Pass',
          role_slug: 'qa',
          instruction:
            'Perform a rapid final verification of the polished_deliverable. Confirm: (1) All critical and major issues from the original review_report are resolved, (2) No new issues were introduced during the fix process, (3) The deliverable meets the quality bar for client presentation. Output a brief sign-off document with pass/fail status and any remaining minor notes for the client handoff.',
          output_key: 'qa_signoff',
          dependencies: ['fix-and-polish'],
        },
        {
          step_id: 'client-handoff',
          label: 'Client Handoff',
          role_slug: 'account_manager',
          instruction:
            "Prepare the final client delivery package using the polished_deliverable and qa_signoff. Write a delivery summary covering: (1) What was delivered — itemized list matching the original brief, (2) How each deliverable meets the stated business objectives, (3) Any deviations from the original scope with explanations, (4) Usage instructions and technical documentation where applicable, (5) Recommended next steps and future enhancement opportunities. Format the entire package for professional client presentation — this document represents the agency's quality standard.",
          output_key: 'delivery_summary',
          dependencies: ['final-qa'],
        },
      ],
    },
    {
      sop_id: 'sop-social-campaign',
      name: 'Social Media Campaign',
      description: 'End-to-end social media campaign from brief to publish-ready assets',
      created_at: '2025-01-01T00:00:00.000Z',
      steps: [
        {
          step_id: 'campaign-brief',
          label: 'Campaign Brief',
          role_slug: 'account_manager',
          instruction:
            'Define the social media campaign scope and strategy. Document: (1) Campaign objective (awareness, engagement, conversion, etc.) with measurable KPIs, (2) Target audience segments with platform-specific behavior insights, (3) Platform selection (Instagram, LinkedIn, Twitter/X, TikTok, etc.) with rationale for each, (4) Campaign duration, posting frequency, and key dates, (5) Competitive landscape — what similar campaigns are competitors running? (6) Tone of voice and messaging pillars (3-5 core messages). Output a structured campaign brief that will guide all content creation.',
          output_key: 'campaign_brief',
          dependencies: [],
        },
        {
          step_id: 'content-creation',
          label: 'Content Creation',
          role_slug: 'developer',
          instruction:
            'Using the campaign_brief, create all written content for the campaign. Produce: (1) Post copy for each platform, adapted to platform-specific character limits, hashtag conventions, and audience expectations, (2) Caption variations (A/B test versions) for key posts, (3) Call-to-action variations aligned with campaign objectives, (4) Content calendar mapping each post to its publish date and platform. Ensure every piece of copy reinforces the messaging pillars from the brief. Write in the specified tone of voice consistently.',
          output_key: 'campaign_content',
          dependencies: ['campaign-brief'],
        },
        {
          step_id: 'visual-design',
          label: 'Visual Design',
          role_slug: 'graphic_designer',
          instruction:
            'Design visual assets for all campaign_content posts. Create: (1) Platform-specific templates with correct dimensions (Instagram 1080x1080, Story 1080x1920, LinkedIn 1200x627, etc.), (2) Visual identity system for the campaign — consistent color treatment, typography overlay style, and image treatment, (3) At least 2 visual variations per key post for A/B testing, (4) Animated/motion concepts for story and reel formats if applicable. Ensure all visuals align with brand guidelines while standing out in social feeds. Include asset specification notes (file format, resolution, safe zones for text).',
          output_key: 'campaign_visuals',
          dependencies: ['content-creation'],
        },
        {
          step_id: 'campaign-review',
          label: 'Campaign Review',
          role_slug: 'qa',
          instruction:
            "Review the complete campaign package (campaign_content + campaign_visuals) against the campaign_brief. Evaluate: (1) Message consistency — do all posts reinforce the messaging pillars? (2) Platform appropriateness — is each post optimized for its target platform's conventions? (3) Visual quality — are assets the correct dimensions, properly cropped, and brand-compliant? (4) Content calendar — is the posting cadence appropriate and are there any gaps or conflicts? (5) Compliance — any regulatory or brand policy concerns? Output a structured review with issues and specific fix instructions.",
          output_key: 'campaign_review',
          dependencies: ['visual-design'],
        },
        {
          step_id: 'publish-package',
          label: 'Publish Package',
          role_slug: 'project_manager',
          instruction:
            'Compile the final publish-ready campaign package after incorporating campaign_review feedback. Produce: (1) Final content calendar with exact publish dates, times (in target timezone), and platform assignments, (2) Organized asset folder structure — one folder per platform, files named with date and post number, (3) Publishing checklist for each post (copy, visual, hashtags, tags, link, CTA), (4) Measurement plan — which metrics to track, when to check, and what thresholds trigger optimization. This package should allow anyone on the team to execute the campaign without additional context.',
          output_key: 'publish_package',
          dependencies: ['campaign-review'],
        },
      ],
    },
  ],
  layoutPreset: 'agency-studio',
  zones: [
    createZoneBlueprint({
      slug: 'zone-product',
      archetype: 'workspace',
      label: 'CLIENT AREA',
      accentColor: '#f59e0b',
      floorColor: 0x5a4124,
      cx: -8,
      cz: 10,
      w: 10,
      d: 8,
      targetRoles: ['account_manager', 'project_manager'],
      deskSlots: 2,
      sortOrder: 0,
    }),
    createZoneBlueprint({
      slug: 'zone-dev',
      archetype: 'workspace',
      label: 'CREATIVE STUDIO',
      cx: 8,
      cz: 10,
      w: 12,
      d: 8,
      targetRoles: ['graphic_designer', 'developer', 'qa', 'yolo_master'],
      deskSlots: 3,
      sortOrder: 1,
    }),
    createZoneBlueprint({
      slug: 'zone-meeting',
      archetype: 'meeting',
      label: 'CLIENT MEETING',
      cx: -10,
      cz: -1,
      w: 10,
      d: 8,
      sortOrder: 2,
    }),
    createZoneBlueprint({
      slug: 'zone-library',
      archetype: 'library',
      label: 'LIBRARY',
      cx: 10,
      cz: -1,
      w: 8,
      d: 6,
      sortOrder: 3,
    }),
    createZoneBlueprint({
      slug: 'zone-rest',
      archetype: 'rest',
      label: 'REST AREA',
      cx: 0,
      cz: -11,
      w: 8,
      d: 6,
      sortOrder: 4,
    }),
  ],
};
