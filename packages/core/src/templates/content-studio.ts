import { createZoneBlueprint } from '@offisim/shared-types';
import type { CompanyTemplate } from './index.js';

/**
 * Content Studio template — 5 employees across a research-draft-edit-review-optimize pipeline.
 * Showcases the Generate-Critique collaboration pattern with editorial oversight.
 * Includes 3 SOPs: Content Pipeline, Newsletter Production, and SEO Audit.
 */
export const contentStudioTemplate: CompanyTemplate = {
  id: 'content-studio',
  name: 'Content Studio',
  description: 'Research, write, review, publish',
  icon: '📝',
  employees: [
    {
      name: 'Dana Rivera',
      role_slug: 'researcher',
      persona_json: JSON.stringify({
        expertise:
          'Deep research and investigative analysis with expertise in multi-source synthesis, fact verification, and primary source identification. Skilled in academic database navigation, industry report analysis, and expert interview synthesis. Proficient in statistical interpretation, trend analysis, and translating complex data into digestible research briefs. Experienced in competitive content analysis and content gap identification.',
        style:
          'Thorough investigator who never takes a single source at face value. Cross-references every major claim against at least two independent sources. Produces comprehensive research briefs with clear source attribution and confidence levels for each finding. Flags areas where evidence is thin or contradictory rather than glossing over uncertainty.',
        characterConfig: {
          skinColor: 0xf5d0b0,
          hairColor: 0x8b4513,
          hairStyle: 'long',
          clothingColor: 0xf59e0b,
          clothingAccent: 0xd97706,
          bodyType: 'normal',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.3,
        maxTokens: 3072,
      }),
    },
    {
      name: 'Leo Zhang',
      role_slug: 'writer',
      persona_json: JSON.stringify({
        expertise:
          'Content drafting and copywriting with mastery of tone adaptation across B2B thought leadership, consumer lifestyle, technical documentation, and social media formats. Expert in narrative structure, hook writing, and audience-aware language calibration. Skilled in long-form article composition (2000-5000 words), short-form social copy, email marketing sequences, and video script writing. Deep understanding of content frameworks (AIDA, PAS, StoryBrand).',
        style:
          'Versatile writer who adapts voice and format precisely to the target audience. Opens every piece with a compelling hook that earns the next paragraph. Structures content with clear signposting for scanners while maintaining depth for engaged readers. Writes in active voice, avoids jargon unless writing for technical audiences, and always ends with a clear call-to-action or takeaway.',
        characterConfig: {
          skinColor: 0xe8c4a0,
          hairColor: 0x1a1a2e,
          hairStyle: 'short',
          clothingColor: 0x3b82f6,
          clothingAccent: 0x2563eb,
          bodyType: 'normal',
          gender: 'masculine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.7,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Carmen Flores',
      role_slug: 'manager',
      persona_json: JSON.stringify({
        expertise:
          'Editorial management and content quality control with 12+ years in digital publishing. Expert in editorial calendars, content strategy alignment, and brand voice governance. Skilled in line editing, structural editing, and developmental feedback. Deep knowledge of AP style, Chicago Manual of Style, and web writing best practices. Experienced in managing multi-writer teams for consistent quality and voice.',
        style:
          "Sharp-eyed editor who elevates every piece without overwriting the author's voice. Provides structural feedback before line edits to avoid wasted effort. Uses tracked-changes style feedback with clear rationale for every suggestion. Maintains an editorial style guide and enforces consistency across all content output. Pushes writers to be more specific and concrete rather than vague and generic.",
        characterConfig: {
          skinColor: 0xd4a574,
          hairColor: 0x6b3a2a,
          hairStyle: 'bob',
          clothingColor: 0xec4899,
          clothingAccent: 0xdb2777,
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
      name: 'Priya Sharma',
      role_slug: 'project_manager',
      persona_json: JSON.stringify({
        expertise:
          'Content strategy and quality auditing with focus on factual accuracy, logical coherence, and audience alignment. Expert in content performance analysis, editorial workflow optimization, and publication scheduling. Skilled in content audit methodologies, taxonomy design, and content lifecycle management. Proficient in analytics-driven content decisions using engagement metrics, search performance, and conversion data.',
        style:
          'Strategic thinker who connects every piece of content to business objectives and audience needs. Reviews content against both quality standards and strategic alignment. Outputs structured critique with actionable revision instructions prioritized by impact. Tracks content performance patterns to inform future editorial decisions.',
        characterConfig: {
          skinColor: 0xd2a882,
          hairColor: 0x1c1c1c,
          hairStyle: 'braids',
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
    {
      name: 'Marco Rossi',
      role_slug: 'seo_specialist',
      persona_json: JSON.stringify({
        expertise:
          'SEO optimization and content distribution with deep knowledge of search engine algorithms, keyword research methodologies, and technical SEO. Expert in on-page optimization (title tags, meta descriptions, heading hierarchy, internal linking), content formatting for featured snippets, and schema markup. Proficient in analytics platforms (GA4, Search Console), rank tracking, and content performance dashboards. Skilled in multi-channel content adaptation for web, email, social, and syndication.',
        style:
          'Optimization specialist who transforms reviewed content into high-performing published assets. Data-driven approach to every formatting decision — headline structure, paragraph length, image placement, and CTA positioning. Balances SEO requirements with readability to avoid keyword-stuffed content. Maintains a living SEO checklist and applies it consistently to every piece before publication.',
        characterConfig: {
          skinColor: 0xfce4c8,
          hairColor: 0x6b3a2a,
          hairStyle: 'curly',
          clothingColor: 0x14b8a6,
          clothingAccent: 0x0d9488,
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
  ],
  sops: [
    {
      sop_id: 'sop-content-pipeline',
      name: 'Content Pipeline',
      description: 'Research-draft-edit-review-optimize pipeline for AI content production',
      created_at: '2025-01-01T00:00:00.000Z',
      steps: [
        {
          step_id: 'research',
          label: 'Research & Briefing',
          role_slug: 'researcher',
          instruction:
            'Investigate the topic thoroughly using multiple source types (industry reports, academic papers, expert opinions, data sets). Produce a structured research brief containing: (1) Topic overview with current landscape context, (2) Key findings organized by theme with source citations for each claim, (3) Data points and statistics with verification status (verified/unverified/conflicting), (4) Competing perspectives and counterarguments to provide balanced coverage, (5) Suggested content angles ranked by audience relevance and originality, (6) List of expert quotes or attributable insights. Mark confidence level (high/medium/low) for each finding.',
          output_key: 'research_brief',
          dependencies: [],
        },
        {
          step_id: 'draft',
          label: 'Content Drafting',
          role_slug: 'writer',
          instruction:
            "Using the research_brief, write a complete first draft. Requirements: (1) Open with a hook that creates urgency or curiosity — no generic introductions, (2) Structure with clear H2/H3 hierarchy for scannability, (3) Support every major claim with data or examples from the research brief, (4) Write for the target audience's reading level — explain jargon for general audiences, use precise terminology for expert audiences, (5) Include transitional sentences between sections for narrative flow, (6) End with a concrete takeaway or call-to-action that ties back to the opening hook. Target word count should match the content format (blog: 1500-2500 words, whitepaper: 3000-5000 words, social: platform-specific limits).",
          output_key: 'content_draft',
          dependencies: ['research'],
        },
        {
          step_id: 'edit',
          label: 'Editorial Review',
          role_slug: 'manager',
          instruction:
            "Perform a comprehensive editorial review of the content_draft. Evaluate at three levels: (1) Structural — does the piece flow logically? Is the argument well-built? Are sections in the right order? Does it deliver on the promise of the headline? (2) Line-level — are sentences clear and concise? Is passive voice minimized? Are transitions smooth? Is the tone consistent throughout? (3) Mechanical — grammar, punctuation, spelling, style guide compliance. For each issue, provide: the specific location, what's wrong, why it matters, and a suggested fix. Prioritize feedback by impact: structural issues first, then line-level, then mechanical. If the draft needs major restructuring, provide a revised outline rather than line edits.",
          output_key: 'editorial_feedback',
          dependencies: ['draft'],
        },
        {
          step_id: 'review',
          label: 'Quality & Accuracy Audit',
          role_slug: 'project_manager',
          instruction:
            'Audit the content_draft against the research_brief for factual accuracy and strategic alignment. Check: (1) Every cited statistic traces back to the research brief and is presented in proper context, (2) No claims are made without supporting evidence, (3) Counterarguments are fairly represented, not strawmanned, (4) The content serves the stated business objective and target audience, (5) The piece differentiates from top-ranking competing content on the same topic. Rate overall quality on a 1-5 scale across four dimensions: accuracy, originality, audience fit, and strategic value. Provide specific revision instructions for anything scoring below 4.',
          output_key: 'quality_report',
          dependencies: ['edit'],
        },
        {
          step_id: 'optimize',
          label: 'SEO Optimize & Publish',
          role_slug: 'seo_specialist',
          instruction:
            'Apply editorial_feedback and quality_report to produce the final publishable asset. Then optimize: (1) Title tag — under 60 characters, includes primary keyword, compelling to click, (2) Meta description — under 155 characters, includes keyword, has clear value proposition, (3) Heading hierarchy — H1 contains primary keyword, H2s cover semantic variations, (4) Internal linking — 3-5 relevant internal links with descriptive anchor text, (5) Image alt text — descriptive, keyword-relevant where natural, (6) Content formatting — short paragraphs (3-4 sentences max), bullet lists for scannable information, bold key phrases. Output the final content in publish-ready format with all SEO metadata included as a header block.',
          output_key: 'final_content',
          dependencies: ['review'],
        },
      ],
    },
    {
      sop_id: 'sop-newsletter',
      name: 'Newsletter Production',
      description: 'End-to-end newsletter creation from topic selection to send-ready package',
      created_at: '2025-01-01T00:00:00.000Z',
      steps: [
        {
          step_id: 'topic-curation',
          label: 'Topic Curation',
          role_slug: 'project_manager',
          instruction:
            'Curate newsletter topics based on audience interests, trending themes, and content strategy. Produce: (1) 3-5 topic candidates with a one-sentence pitch and target audience segment for each, (2) Relevance score (1-10) based on timeliness, audience interest signals, and strategic alignment, (3) Recommended primary topic with rationale, (4) Secondary stories or links to round out the newsletter, (5) Suggested subject line variations (3 options) optimized for open rate. Consider past newsletter performance data and seasonal relevance in your selections.',
          output_key: 'newsletter_plan',
          dependencies: [],
        },
        {
          step_id: 'newsletter-draft',
          label: 'Newsletter Drafting',
          role_slug: 'writer',
          instruction:
            'Write the newsletter content based on the newsletter_plan. Structure: (1) Subject line — use the top-performing option from the plan or improve it, (2) Opening hook — 1-2 sentences that make the reader want to continue, (3) Primary story — 300-500 words covering the main topic with a clear takeaway, (4) Secondary stories — 50-100 words each with links to full content, (5) Closing — personal touch or preview of next issue to build anticipation. Write in a conversational, direct tone. Use second person ("you"). Keep paragraphs to 2-3 sentences for email readability. Every section should be independently valuable for scanners.',
          output_key: 'newsletter_draft',
          dependencies: ['topic-curation'],
        },
        {
          step_id: 'newsletter-edit',
          label: 'Editorial Polish',
          role_slug: 'manager',
          instruction:
            "Edit the newsletter_draft for quality and brand voice consistency. Check: (1) Subject line is under 50 characters and avoids spam trigger words, (2) Opening creates immediate value or curiosity, (3) Each section has a clear purpose and doesn't repeat information, (4) Links are properly placed with descriptive anchor text, (5) Tone is consistent — conversational but professional, (6) CTA is clear and specific. Provide tracked-changes style feedback. If the draft is strong, focus on tightening — every word should earn its place in an email.",
          output_key: 'newsletter_edited',
          dependencies: ['newsletter-draft'],
        },
        {
          step_id: 'newsletter-optimize',
          label: 'Format & Send Prep',
          role_slug: 'seo_specialist',
          instruction:
            'Prepare the newsletter_edited for distribution. Produce: (1) HTML-safe formatting notes — which elements need special treatment for email clients, (2) Preview text (the snippet shown in inbox before opening), (3) Plain-text fallback version, (4) Recommended send time based on audience timezone and historical open rate data, (5) Segment targeting recommendations if applicable, (6) A/B test setup — which element to test (subject line, send time, or CTA) and how to measure. Output the final send-ready package with all metadata.',
          output_key: 'newsletter_package',
          dependencies: ['newsletter-edit'],
        },
      ],
    },
    {
      sop_id: 'sop-seo-audit',
      name: 'SEO Content Audit',
      description:
        'Systematic audit of existing content for SEO performance and optimization opportunities',
      created_at: '2025-01-01T00:00:00.000Z',
      steps: [
        {
          step_id: 'content-inventory',
          label: 'Content Inventory',
          role_slug: 'seo_specialist',
          instruction:
            'Compile a comprehensive inventory of existing content assets. For each piece, document: (1) URL and title, (2) Publication date and last update date, (3) Current organic traffic (monthly sessions), (4) Target keyword and current ranking position, (5) Content type and word count, (6) Internal and external link count. Categorize content into performance tiers: Top Performers (top 20% by traffic), Mid-Range, Underperformers, and Zero-Traffic. Output as a structured table sorted by traffic descending.',
          output_key: 'content_inventory',
          dependencies: [],
        },
        {
          step_id: 'gap-analysis',
          label: 'Keyword Gap Analysis',
          role_slug: 'researcher',
          instruction:
            "Analyze the content_inventory against the target keyword universe. Identify: (1) High-value keywords with no existing content (content gaps), (2) Keywords where existing content ranks positions 5-20 (optimization opportunities), (3) Keyword cannibalization — multiple pages competing for the same keyword, (4) Emerging topic trends that the content library doesn't yet cover, (5) Competitor content that outranks ours and what they do differently. Prioritize opportunities by search volume x conversion potential x effort-to-rank. Output a prioritized opportunity list with recommended actions for each.",
          output_key: 'gap_analysis',
          dependencies: ['content-inventory'],
        },
        {
          step_id: 'optimization-plan',
          label: 'Optimization Plan',
          role_slug: 'project_manager',
          instruction:
            'Create a prioritized optimization plan using the gap_analysis. For each item, specify: (1) Action type — create new, update existing, merge/consolidate, or retire, (2) Priority score (1-10) based on business impact and effort required, (3) Specific changes needed — new sections to add, keywords to target, structural improvements, (4) Resource estimate in hours, (5) Expected impact on organic traffic (percentage improvement range). Group actions into sprints of 2-week cycles. The first sprint should target quick wins (existing content updates with high impact potential).',
          output_key: 'optimization_plan',
          dependencies: ['gap-analysis'],
        },
        {
          step_id: 'audit-report',
          label: 'Executive Audit Report',
          role_slug: 'manager',
          instruction:
            'Synthesize the content_inventory, gap_analysis, and optimization_plan into an executive-ready audit report. Include: (1) Executive summary — current state of organic content performance in 3-5 bullet points, (2) Key findings with supporting data visualizations (describe chart/table format), (3) Top 5 immediate opportunities with projected ROI, (4) Recommended investment and resource allocation, (5) 90-day roadmap with measurable milestones, (6) Success metrics and how to track them. Write for a non-technical audience. Lead with business impact, not SEO jargon.',
          output_key: 'audit_report',
          dependencies: ['optimization-plan'],
        },
      ],
    },
  ],
  layoutPreset: 'content-lab',
  zones: [
    createZoneBlueprint({ slug: 'zone-dev', archetype: 'workspace', label: 'WRITING ROOM', accentColor: '#10b981', floorColor: 0x234b42, cx: -10, cz: 10, w: 12, d: 8, targetRoles: ['writer', 'researcher'], deskSlots: 4, sortOrder: 0 }),
    createZoneBlueprint({ slug: 'zone-product', archetype: 'workspace', label: 'EDITORIAL', accentColor: '#a855f7', floorColor: 0x37244f, cx: 4, cz: 10, w: 8, d: 6, targetRoles: ['manager', 'project_manager', 'seo_specialist'], deskSlots: 3, sortOrder: 1 }),
    createZoneBlueprint({ slug: 'zone-library', archetype: 'library', label: 'RESEARCH LIBRARY', cx: -8, cz: -1, w: 14, d: 8, sortOrder: 2 }),
    createZoneBlueprint({ slug: 'zone-rest', archetype: 'rest', label: 'REST AREA', cx: 8, cz: -1, w: 8, d: 6, sortOrder: 3 }),
    createZoneBlueprint({ slug: 'zone-meeting', archetype: 'meeting', label: 'MEETING', cx: 0, cz: -10, w: 7, d: 6, sortOrder: 4 }),
  ],
};
