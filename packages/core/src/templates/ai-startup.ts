import type { CompanyTemplate } from './index.js';

/**
 * AI Startup template — 6 employees for an AI/ML-focused company.
 * Covers research, data engineering, product, development, and design.
 * Includes 2 SOPs: Model Evaluation Pipeline and AI Feature Sprint.
 */
export const aiStartupTemplate: CompanyTemplate = {
  id: 'ai-startup',
  name: 'AI Startup',
  description:
    'An AI/ML-focused team with researchers, data engineers, and product builders. Includes Model Evaluation and AI Feature Sprint SOPs.',
  icon: '🧠',
  employees: [
    // ── Research & ML ──
    {
      name: 'Dmitri Volkov',
      role_slug: 'developer',
      persona_json: JSON.stringify({
        expertise:
          'Machine learning research, transformer architectures, experiment design, paper analysis',
        style:
          'Methodical, citation-driven, prefers rigorous experimentation over heuristics, writes clear technical memos',
        characterConfig: {
          skinColor: 0xf0d5c0,
          hairColor: 0xc9b896,
          hairStyle: 'short',
          clothingColor: 0x0891b2,
          clothingAccent: 0x0e7490,
          bodyType: 'slim',
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
      name: 'Aria Patel',
      role_slug: 'backend',
      persona_json: JSON.stringify({
        expertise:
          'ML engineering, model fine-tuning, inference optimization, GPU pipeline management',
        style:
          'Hands-on builder, obsessed with latency numbers, iterates fast with tight feedback loops',
        characterConfig: {
          skinColor: 0xd4a574,
          hairColor: 0x1a1a2e,
          hairStyle: 'long',
          clothingColor: 0x06b6d4,
          clothingAccent: 0x0891b2,
          bodyType: 'normal',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.4,
        maxTokens: 4096,
      }),
    },
    // ── Data ──
    {
      name: 'Leo Chen',
      role_slug: 'fullstack',
      persona_json: JSON.stringify({
        expertise:
          'Data pipelines, vector databases, ETL, data quality monitoring, embeddings infrastructure',
        style:
          'Systems thinker, reliability-focused, builds observable pipelines, automates everything',
        characterConfig: {
          skinColor: 0xf5d6b8,
          hairColor: 0x2c1810,
          hairStyle: 'spiky',
          clothingColor: 0x8b5cf6,
          clothingAccent: 0x7c3aed,
          bodyType: 'normal',
          gender: 'masculine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.3,
        maxTokens: 4096,
      }),
    },
    // ── Product ──
    {
      name: 'Sam Rivera',
      role_slug: 'pm',
      persona_json: JSON.stringify({
        expertise:
          'AI product strategy, user research, competitive analysis, go-to-market for AI products',
        style:
          'Visionary yet grounded, translates research into product opportunities, strong storyteller',
        characterConfig: {
          skinColor: 0xe8c8a0,
          hairColor: 0x8b4513,
          hairStyle: 'curly',
          clothingColor: 0xa855f7,
          clothingAccent: 0x9333ea,
          bodyType: 'normal',
          gender: 'neutral',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.5,
        maxTokens: 4096,
      }),
    },
    // ── Engineering ──
    {
      name: 'Nia Williams',
      role_slug: 'frontend',
      persona_json: JSON.stringify({
        expertise:
          'Full-stack TypeScript, API integration, real-time UIs, streaming interfaces, chat UX',
        style:
          'Pragmatic builder, ships fast, cares deeply about developer experience and API ergonomics',
        characterConfig: {
          skinColor: 0xd2a882,
          hairColor: 0x5d4e37,
          hairStyle: 'braids',
          clothingColor: 0x3b82f6,
          clothingAccent: 0x2563eb,
          bodyType: 'normal',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.4,
        maxTokens: 4096,
      }),
    },
    // ── Design ──
    {
      name: 'Chloe Kim',
      role_slug: 'designer',
      persona_json: JSON.stringify({
        expertise:
          'AI interaction design, conversational UX, data visualization, prototyping with AI tools',
        style:
          'User-empathetic, designs for trust and transparency, loves simplifying complex AI outputs into clear interfaces',
        characterConfig: {
          skinColor: 0xfce4c8,
          hairColor: 0x6b3a2a,
          hairStyle: 'ponytail',
          clothingColor: 0xf97316,
          clothingAccent: 0xea580c,
          bodyType: 'slim',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.6,
        maxTokens: 3072,
      }),
    },
  ],
  sops: [
    {
      sop_id: 'sop-model-eval',
      name: 'Model Evaluation Pipeline',
      description:
        'End-to-end model evaluation: literature review → data preparation → benchmarking → report',
      created_at: '2025-01-01T00:00:00.000Z',
      steps: [
        {
          step_id: 'literature-review',
          label: 'Literature Review',
          role_slug: 'developer',
          instruction:
            'Survey recent papers and techniques relevant to the model or task at hand. Identify baselines, state-of-the-art benchmarks, and potential approaches. Produce a brief technical summary with key references.',
          output_key: 'literature_summary',
          dependencies: [],
        },
        {
          step_id: 'data-preparation',
          label: 'Data Preparation',
          role_slug: 'fullstack',
          instruction:
            'Prepare the evaluation dataset: curate samples, clean data, compute embeddings if needed, split into test/validation sets. Document data provenance and any preprocessing decisions.',
          output_key: 'eval_dataset',
          dependencies: ['literature-review'],
        },
        {
          step_id: 'benchmark-run',
          label: 'Benchmark & Metrics',
          role_slug: 'backend',
          instruction:
            'Run the model against the evaluation dataset. Collect metrics (accuracy, latency, cost per token, failure rate). Compare against baselines identified in the literature review.',
          output_key: 'benchmark_results',
          dependencies: ['data-preparation'],
        },
        {
          step_id: 'eval-report',
          label: 'Evaluation Report',
          role_slug: 'pm',
          instruction:
            'Synthesize benchmark results into a stakeholder-ready report. Include executive summary, key findings, comparison table, recommendations for next steps (ship, iterate, or pivot).',
          output_key: 'eval_report',
          dependencies: ['benchmark-run'],
        },
      ],
    },
    {
      sop_id: 'sop-ai-feature-sprint',
      name: 'AI Feature Sprint',
      description:
        'One-week sprint to scope, design, build, and ship an AI-powered feature',
      created_at: '2025-01-01T00:00:00.000Z',
      steps: [
        {
          step_id: 'feature-scoping',
          label: 'Feature Scoping',
          role_slug: 'pm',
          instruction:
            'Define the AI feature scope: user problem, success metrics, model requirements, data needs, and risk assessment. Produce a one-page spec with clear acceptance criteria.',
          output_key: 'feature_spec',
          dependencies: [],
        },
        {
          step_id: 'ux-design',
          label: 'UX Design',
          role_slug: 'designer',
          instruction:
            'Design the user-facing interaction for the AI feature. Consider loading states, error handling, confidence displays, and fallback paths. Produce wireframes and interaction flow.',
          output_key: 'ux_design',
          dependencies: ['feature-scoping'],
        },
        {
          step_id: 'implementation',
          label: 'Implementation',
          role_slug: 'frontend',
          instruction:
            'Build the AI feature end-to-end: API integration, streaming UI, error states, and telemetry. Follow the UX design and feature spec. Write tests for critical paths.',
          output_key: 'implementation',
          dependencies: ['ux-design'],
        },
        {
          step_id: 'model-integration',
          label: 'Model Integration & Testing',
          role_slug: 'backend',
          instruction:
            'Set up the model inference pipeline: prompt engineering, tool calling, output parsing, and safety guardrails. Run end-to-end tests with realistic inputs and edge cases.',
          output_key: 'model_integration',
          dependencies: ['implementation'],
        },
      ],
    },
  ],
  layoutPreset: 'rd-office',
};
