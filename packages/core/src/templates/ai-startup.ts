import { createZoneBlueprint } from '@offisim/shared-types';
import type { CompanyTemplateDefinition } from './index.js';

/**
 * AI Startup — hypothesis → research → experiment/data work in parallel →
 * evaluation → product integration → demo.
 *
 * Source plan §3.5: role slugs now reflect the real jobs — Aria is an
 * `engineer` ("ML Engineer"), Leo is a `data_engineer`, and a dedicated AI
 * Evaluation Engineer is added so the eval-driven retry loop has an owner. Role
 * slug stays a broad operational family; the specialized job is the display
 * title; capabilities carry the structured detail.
 */
export const aiStartupTemplate: CompanyTemplateDefinition = {
  id: 'ai-startup',
  name: 'AI Startup',
  description: 'Research, build, evaluate, and ship AI: ML research, data, product, and evaluation.',
  presentation: {
    icon: 'Brain',
    accent: '#06b6d4',
    tagline: 'Research-first team pushing the boundaries of AI',
    bestFor: ['Machine Learning', 'Research', 'Data Science'],
    capabilities: ['ML research', 'Data & evaluation', 'AI product & UX'],
  },
  layoutPreset: 'ai-lab',
  performance: { family: 'ai-lab', pace: 'deliberate', collaborationBias: 'mixed', motifWeights: {} },
  zones: [
    createZoneBlueprint({
      slug: 'zone-mllab',
      archetype: 'workspace',
      label: 'ML LAB',
      accentColor: '#06b6d4',
      floorColor: 0x1f4050,
      cx: -13.2,
      cz: 10.6,
      w: 12.4,
      d: 8.8,
      targetRoles: ['researcher', 'engineer'],
      deskSlots: 2,
      sortOrder: 0,
    }),
    createZoneBlueprint({
      slug: 'zone-data',
      archetype: 'workspace',
      label: 'DATA & ENGINEERING',
      accentColor: '#8b5cf6',
      floorColor: 0x3a2a5c,
      cx: -0.2,
      cz: 10.6,
      w: 11.2,
      d: 8.8,
      targetRoles: ['data_engineer', 'frontend', 'qa'],
      deskSlots: 3,
      sortOrder: 1,
    }),
    createZoneBlueprint({
      slug: 'zone-aidesign',
      archetype: 'workspace',
      label: 'PRODUCT & AI DESIGN',
      accentColor: '#f97316',
      floorColor: 0x5c3b2a,
      cx: 12.4,
      cz: 10.6,
      w: 11.2,
      d: 8.8,
      targetRoles: ['product_manager', 'ux_designer'],
      deskSlots: 2,
      sortOrder: 2,
    }),
    createZoneBlueprint({
      slug: 'zone-library',
      archetype: 'library',
      label: 'RESEARCH LIBRARY',
      cx: -11.3,
      cz: 0.7,
      w: 13.2,
      d: 7.6,
      sortOrder: 3,
    }),
    createZoneBlueprint({
      slug: 'zone-rest',
      archetype: 'rest',
      label: 'REST AREA',
      cx: 6.3,
      cz: 0.7,
      w: 13.8,
      d: 7.6,
      sortOrder: 4,
    }),
    createZoneBlueprint({
      slug: 'zone-meeting',
      archetype: 'meeting',
      label: 'MEETING',
      cx: -9.4,
      cz: -8.8,
      w: 15.2,
      d: 7.4,
      sortOrder: 5,
    }),
    {
      ...createZoneBlueprint({
        slug: 'zone-server',
        archetype: 'server',
        label: 'GPU CLUSTER',
        cx: 9.4,
        cz: -8.8,
        w: 15.2,
        d: 7.4,
        sortOrder: 6,
      }),
      defaultPrefabs: [
        { prefabId: 'server-rack-2u', offsetX: -4, offsetZ: -1.5 },
        { prefabId: 'server-rack-2u', offsetX: 0, offsetZ: -1.5 },
        { prefabId: 'server-rack-2u', offsetX: 4, offsetZ: -1.5 },
        { prefabId: 'network-switch', offsetX: 0, offsetZ: 2 },
        { prefabId: 'cable-tray', offsetX: -5, offsetZ: 2.5 },
      ],
    },
  ],
  employees: [
    {
      key: 'dmitri-volkov',
      name: 'Dmitri Volkov',
      roleSlug: 'researcher',
      displayTitle: 'Research Scientist',
      capabilities: ['ml-research', 'experiment-design', 'transformers', 'paper-synthesis'],
      persona: {
        schemaVersion: 2,
        profile: {
          expertise:
            'Machine learning research with deep expertise in transformer architectures, attention mechanisms, and self-supervised learning. Experienced in experiment design with rigorous ablation studies and statistical significance testing. Proficient in PyTorch, JAX, and Weights & Biases. Expert in reading and synthesizing research papers, identifying reproducibility issues, and proposing novel architecture modifications.',
          workingStyle:
            'Methodical and citation-driven researcher who prefers rigorous experimentation over heuristics. Writes clear technical memos that distinguish established findings from speculative hypotheses. Always designs experiments with proper baselines and controls. Communicates uncertainty honestly.',
          communication: 'medium',
          risk: 'conservative',
          decisionStyle: 'analytical',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xf0d5c0,
          hairColor: 0xc9b896,
          hairStyle: 'short',
          clothingColor: 0x0891b2,
          clothingAccent: 0x0e7490,
          bodyType: 'slim',
          gender: 'masculine',
        },
      },
    },
    {
      key: 'aria-patel',
      name: 'Aria Patel',
      roleSlug: 'engineer',
      displayTitle: 'ML Engineer',
      capabilities: ['model-training', 'inference', 'optimization', 'benchmarking'],
      persona: {
        schemaVersion: 2,
        profile: {
          expertise:
            'ML engineering and inference optimization with expertise in model fine-tuning (LoRA, QLoRA, full fine-tuning), quantization (GPTQ, AWQ, GGUF), and serving infrastructure (vLLM, TensorRT, Triton). Deep knowledge of GPU pipeline management, memory optimization, and batching strategies. Proficient in distributed training with DeepSpeed, FSDP, and pipeline parallelism.',
          workingStyle:
            'Hands-on builder obsessed with latency and throughput. Iterates fast with tight feedback loops — benchmarks every change before and after. Documents performance characteristics and failure modes. Thinks in p50/p95/p99, not just averages. Automates everything that runs more than twice.',
          communication: 'medium',
          risk: 'balanced',
          decisionStyle: 'analytical',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xc68642,
          hairColor: 0x1a1a2e,
          hairStyle: 'long',
          clothingColor: 0x06b6d4,
          clothingAccent: 0x0891b2,
          bodyType: 'normal',
          gender: 'feminine',
        },
      },
    },
    {
      key: 'leo-chen',
      name: 'Leo Chen',
      roleSlug: 'data_engineer',
      displayTitle: 'Data Engineer',
      capabilities: ['data-pipelines', 'vector-db', 'etl', 'data-quality'],
      persona: {
        schemaVersion: 2,
        profile: {
          expertise:
            'Data engineering and ML infrastructure with focus on data pipelines, vector databases (Pinecone, Qdrant, pgvector), and embedding infrastructure. Expert in ETL pipeline design, data quality monitoring, and lineage tracking. Proficient in Apache Kafka, Airflow, and dbt. Deep knowledge of data versioning, feature stores, and training-data curation.',
          workingStyle:
            'Systems thinker who designs for reliability and observability from day one. Every pipeline includes health checks, dead-letter queues, and alerting. Automates data-quality validation with schema enforcement and distribution checks. Treats data bugs with the same urgency as code bugs.',
          communication: 'low',
          risk: 'conservative',
          decisionStyle: 'analytical',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xf5d6b8,
          hairColor: 0x2c1810,
          hairStyle: 'spiky',
          clothingColor: 0x8b5cf6,
          clothingAccent: 0x7c3aed,
          bodyType: 'normal',
          gender: 'masculine',
        },
      },
    },
    {
      key: 'sam-rivera',
      name: 'Sam Rivera',
      roleSlug: 'product_manager',
      displayTitle: 'AI Product Manager',
      capabilities: ['ai-product-strategy', 'user-research', 'responsible-ai', 'positioning'],
      persona: {
        schemaVersion: 2,
        profile: {
          expertise:
            'AI product strategy with expertise in translating ML research capabilities into user-facing products. Deep knowledge of AI product patterns: conversational interfaces, recommendation systems, content generation, classification workflows. Skilled in user research for AI features — trust calibration, explainability, failure tolerance — plus pricing for compute-intensive features and responsible-AI practices.',
          workingStyle:
            'Visionary yet grounded. Asks "what problem does this solve?" before "what model should we use?". Defines success metrics that measure user outcomes, not just model accuracy. Writes specs that acknowledge AI uncertainty with fallback behavior and confidence thresholds.',
          communication: 'high',
          risk: 'balanced',
          decisionStyle: 'directive',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xe8c8a0,
          hairColor: 0x8b4513,
          hairStyle: 'curly',
          clothingColor: 0xa855f7,
          clothingAccent: 0x9333ea,
          bodyType: 'normal',
          gender: 'neutral',
        },
      },
    },
    {
      key: 'nia-williams',
      name: 'Nia Williams',
      roleSlug: 'frontend',
      displayTitle: 'AI Frontend Engineer',
      capabilities: ['streaming-ui', 'react', 'websockets', 'tool-calling-ui'],
      persona: {
        schemaVersion: 2,
        profile: {
          expertise:
            'Application development for AI products with specialization in streaming interfaces, real-time UIs, and conversational UX. Expert in React Server Components, WebSocket/SSE integration, and optimistic updates. Proficient in tool-calling interfaces, structured-output displays, and AI confidence visualization. Deep knowledge of LLM provider integration, rate limiting, retry logic, and graceful degradation.',
          workingStyle:
            'Pragmatic builder who ships working prototypes fast and iterates toward production quality. Handles loading, error, and partial-result states thoughtfully because AI responses are unpredictable. Tests edge cases obsessively — empty responses, timeouts, malformed output.',
          communication: 'medium',
          risk: 'balanced',
          decisionStyle: 'collaborative',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0x8d5524,
          hairColor: 0x5d4e37,
          hairStyle: 'braids',
          clothingColor: 0x3b82f6,
          clothingAccent: 0x2563eb,
          bodyType: 'normal',
          gender: 'feminine',
        },
      },
    },
    {
      key: 'chloe-kim',
      name: 'Chloe Kim',
      roleSlug: 'ux_designer',
      displayTitle: 'AI UX Designer',
      capabilities: ['ai-ux', 'data-viz', 'explainability', 'trust-design'],
      persona: {
        schemaVersion: 2,
        profile: {
          expertise:
            'AI interaction design with specialization in conversational UX, data visualization, and trust-building interfaces. Expert in designing for AI uncertainty — confidence indicators, explainability panels, graceful error handling. Skilled in prototyping AI interactions with realistic latency and failure simulations and in making complex ML metrics accessible to non-technical users.',
          workingStyle:
            'User-empathetic designer who prioritizes trust and transparency. Tests designs with realistic AI behavior including delays, errors, and unexpected outputs — not just the happy path. Always includes user-control mechanisms to override, correct, or give feedback. Advocates progressive disclosure of AI complexity.',
          communication: 'medium',
          risk: 'balanced',
          decisionStyle: 'collaborative',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xfce4c8,
          hairColor: 0x6b3a2a,
          hairStyle: 'ponytail',
          clothingColor: 0xf97316,
          clothingAccent: 0xea580c,
          bodyType: 'slim',
          gender: 'feminine',
        },
      },
    },
    {
      key: 'owen-briggs',
      name: 'Owen Briggs',
      roleSlug: 'qa',
      displayTitle: 'AI Evaluation Engineer',
      capabilities: ['model-evaluation', 'benchmarking', 'safety-testing', 'red-teaming'],
      persona: {
        schemaVersion: 2,
        profile: {
          expertise:
            'AI model and product evaluation: building eval harnesses, golden datasets, and automated regression suites for model quality. Expert in benchmark design, offline/online evaluation, hallucination and safety testing, and red-teaming. Skilled in turning fuzzy "is it good enough?" questions into measurable, reproducible metrics with clear pass/fail bars.',
          workingStyle:
            'Rigorous and adversarial in the best way. Defines the eval before the experiment, distrusts a single metric, and reports confidence intervals. Drives the evaluation-driven retry loop and blocks shipping on demonstrated regressions, not vibes.',
          communication: 'medium',
          risk: 'conservative',
          decisionStyle: 'analytical',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xe8c8a0,
          hairColor: 0x2c1810,
          hairStyle: 'short',
          clothingColor: 0x14b8a6,
          clothingAccent: 0x0d9488,
          bodyType: 'normal',
          gender: 'masculine',
        },
      },
    },
  ],
};
