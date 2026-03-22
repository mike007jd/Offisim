import type { CompanyTemplate } from './index.js';

/**
 * AI Startup template — 6 employees for an AI/ML-focused company.
 * Covers research, ML engineering, data engineering, product, application development, and AI design.
 * Includes 3 SOPs: Model Evaluation Pipeline, AI Feature Sprint, and Paper Review & Implementation.
 */
export const aiStartupTemplate: CompanyTemplate = {
  id: 'ai-startup',
  name: 'AI Startup',
  description: 'ML research + data + product',
  icon: '🧠',
  employees: [
    // ── Research & ML ──
    {
      name: 'Dmitri Volkov',
      role_slug: 'researcher',
      persona_json: JSON.stringify({
        expertise:
          'Machine learning research with deep expertise in transformer architectures, attention mechanisms, and self-supervised learning. Experienced in experiment design with rigorous ablation studies and statistical significance testing. Proficient in PyTorch, JAX, and Weights & Biases for experiment tracking. Strong publication record in NeurIPS/ICML-tier venues. Expert in reading and synthesizing research papers, identifying reproducibility issues, and proposing novel architecture modifications.',
        style:
          'Methodical and citation-driven researcher who prefers rigorous experimentation over heuristics. Writes clear technical memos that distinguish between established findings and speculative hypotheses. Always designs experiments with proper baselines and controls. Communicates uncertainty honestly — never oversells results or cherry-picks metrics.',
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
        temperature: 0.4,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Aria Patel',
      role_slug: 'backend',
      persona_json: JSON.stringify({
        expertise:
          'ML engineering and inference optimization with expertise in model fine-tuning (LoRA, QLoRA, full fine-tuning), quantization (GPTQ, AWQ, GGUF), and serving infrastructure (vLLM, TensorRT, Triton). Deep knowledge of GPU pipeline management, memory optimization, and batching strategies for high-throughput inference. Proficient in distributed training with DeepSpeed, FSDP, and pipeline parallelism. Experienced in building evaluation harnesses and regression testing for model quality.',
        style:
          'Hands-on builder obsessed with latency numbers and throughput metrics. Iterates fast with tight feedback loops — benchmarks every change before and after. Documents performance characteristics and failure modes for every deployed model. Thinks in terms of p50/p95/p99 latencies, not just averages. Automates everything that runs more than twice.',
        characterConfig: {
          skinColor: 0xc68642,
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
          'Data engineering and ML infrastructure with focus on data pipelines, vector databases (Pinecone, Qdrant, pgvector), and embedding infrastructure. Expert in ETL pipeline design, data quality monitoring, and lineage tracking. Proficient in Apache Kafka, Apache Airflow, and dbt for data transformation. Deep knowledge of data versioning (DVC), feature stores, and training data curation. Experienced in building data observability dashboards with automated anomaly detection.',
        style:
          'Systems thinker who designs for reliability and observability from day one. Every pipeline includes health checks, dead letter queues, and alerting. Automates data quality validation with schema enforcement and statistical distribution checks. Documents data dictionaries and pipeline dependencies so any team member can debug issues. Treats data bugs with the same urgency as code bugs.',
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
      role_slug: 'product_manager',
      persona_json: JSON.stringify({
        expertise:
          'AI product strategy with expertise in translating ML research capabilities into user-facing products. Deep knowledge of AI product patterns: conversational interfaces, recommendation systems, content generation, and classification-based workflows. Skilled in user research for AI-powered features — understanding trust calibration, explainability requirements, and failure tolerance. Experienced in competitive analysis of AI products, pricing models for compute-intensive features, and responsible AI product practices.',
        style:
          'Visionary yet grounded product thinker who bridges the gap between research possibilities and user needs. Asks "what problem does this solve?" before "what model should we use?". Defines success metrics that measure user outcomes, not just model accuracy. Writes product specs that acknowledge AI uncertainty — always includes fallback behavior and confidence thresholds. Strong storyteller who can pitch AI capabilities to non-technical stakeholders without overpromising.',
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
        maxTokens: 3072,
      }),
    },
    // ── Engineering ──
    {
      name: 'Nia Williams',
      role_slug: 'frontend',
      persona_json: JSON.stringify({
        expertise:
          'Full-stack application development for AI products with specialization in streaming interfaces, real-time UIs, and chat/conversational UX patterns. Expert in React Server Components, WebSocket/SSE integration, and optimistic UI updates. Proficient in building tool-calling interfaces, structured output displays, and AI confidence visualization. Deep knowledge of API integration patterns for LLM providers, rate limiting, retry logic, and graceful degradation when AI services are unavailable.',
        style:
          'Pragmatic builder who ships working prototypes fast and iterates toward production quality. Cares deeply about developer experience and API ergonomics — writes clean SDK-like interfaces for AI service consumption. Handles loading states, error states, and partial results thoughtfully because AI responses are inherently unpredictable. Tests edge cases obsessively — empty responses, timeout, malformed output, content policy violations.',
        characterConfig: {
          skinColor: 0x8d5524,
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
      role_slug: 'ux_designer',
      persona_json: JSON.stringify({
        expertise:
          'AI interaction design with specialization in conversational UX, data visualization, and trust-building interfaces. Expert in designing for AI uncertainty — confidence indicators, explainability panels, and graceful error handling. Proficient in prototyping AI interactions with realistic latency and failure simulations. Deep knowledge of human-AI interaction research, including appropriate automation levels, user control patterns, and feedback mechanisms. Skilled in designing dashboards that make complex ML metrics accessible to non-technical users.',
        style:
          'User-empathetic designer who prioritizes trust and transparency in every AI-powered interface. Tests designs with realistic AI behavior including delays, errors, and unexpected outputs — not just the happy path. Simplifies complex AI outputs into clear, actionable interfaces without dumbing down the information. Always includes user control mechanisms — the ability to override, correct, or provide feedback to the AI. Advocates for progressive disclosure of AI complexity.',
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
        temperature: 0.7,
        maxTokens: 4096,
      }),
    },
  ],
  sops: [
    {
      sop_id: 'sop-model-eval',
      name: 'Model Evaluation Pipeline',
      description:
        'End-to-end model evaluation: literature review, data preparation, benchmarking, and stakeholder report',
      created_at: '2025-01-01T00:00:00.000Z',
      steps: [
        {
          step_id: 'literature-review',
          label: 'Literature Review',
          role_slug: 'researcher',
          instruction:
            'Conduct a systematic literature review relevant to the model or task being evaluated. Cover: (1) State-of-the-art models and their reported performance on standard benchmarks (include specific numbers), (2) Recent architectural innovations that might improve performance (published in last 12 months), (3) Known failure modes and limitations of current approaches, (4) Evaluation methodologies used in the field — which metrics matter and why, (5) Relevant datasets and their characteristics (size, quality, biases). Produce a structured technical summary with: paper citations (author, year, venue), key contributions of each, comparative performance table, and recommended evaluation approach for our specific use case. Flag any papers with reproducibility concerns.',
          output_key: 'literature_summary',
          dependencies: [],
        },
        {
          step_id: 'data-preparation',
          label: 'Data Preparation',
          role_slug: 'fullstack',
          instruction:
            'Prepare the evaluation dataset based on the literature_summary recommendations. Process: (1) Curate evaluation samples that cover the distribution of real-world inputs — include common cases, edge cases, adversarial examples, and out-of-distribution samples, (2) Clean and normalize data with documented preprocessing steps that can be reproduced, (3) Compute embeddings if needed for retrieval or similarity evaluation, (4) Split into test/validation sets with stratification by difficulty level and category, (5) Document data provenance — where each sample came from, any transformations applied, and known biases. Output a dataset specification document with: total sample count, category distribution, preprocessing pipeline description, and quality verification results (spot-check accuracy, inter-annotator agreement if applicable).',
          output_key: 'eval_dataset',
          dependencies: ['literature-review'],
        },
        {
          step_id: 'benchmark-run',
          label: 'Benchmark & Metrics',
          role_slug: 'backend',
          instruction:
            'Execute the model evaluation against the eval_dataset. Collect and report: (1) Primary metrics — accuracy/F1/BLEU/ROUGE or task-appropriate metrics, broken down by category and difficulty level, (2) Latency metrics — p50, p95, p99 response times, time-to-first-token for streaming, and throughput (requests/second), (3) Cost metrics — tokens consumed, API cost per request, estimated monthly cost at projected usage levels, (4) Reliability metrics — failure rate, timeout rate, rate-limit hit frequency, and error categorization, (5) Comparison table — our model vs. all baselines identified in the literature_summary using identical evaluation data. Include confidence intervals for all metrics. Flag any unexpected results or anomalies that might indicate evaluation bugs rather than genuine model behavior.',
          output_key: 'benchmark_results',
          dependencies: ['data-preparation'],
        },
        {
          step_id: 'eval-report',
          label: 'Evaluation Report',
          role_slug: 'product_manager',
          instruction:
            'Synthesize the benchmark_results into a stakeholder-ready evaluation report. Structure: (1) Executive summary — 3-sentence verdict on whether the model meets our quality bar, (2) Key findings table — metric, our model, best baseline, delta, and interpretation, (3) Strength analysis — where the model excels and why, with example outputs, (4) Weakness analysis — where the model falls short, with failure examples and user impact assessment, (5) Cost-performance analysis — is the quality improvement worth the cost difference vs. alternatives? (6) Recommendation — one of: Ship (quality sufficient), Iterate (specific improvements needed with suggestions), or Pivot (fundamental approach change required), with detailed justification. Include appendix with raw benchmark data for technical stakeholders.',
          output_key: 'eval_report',
          dependencies: ['benchmark-run'],
        },
      ],
    },
    {
      sop_id: 'sop-ai-feature-sprint',
      name: 'AI Feature Sprint',
      description:
        'Rapid sprint to scope, design, build, and ship an AI-powered feature end-to-end',
      created_at: '2025-01-01T00:00:00.000Z',
      steps: [
        {
          step_id: 'feature-scoping',
          label: 'Feature Scoping',
          role_slug: 'product_manager',
          instruction:
            'Define the AI feature scope with ML-specific considerations. Document: (1) User problem — what pain point does this solve, with evidence from user research or support data, (2) Success metrics — define both product metrics (engagement, retention, task completion) and model metrics (accuracy, latency, cost per request), (3) Model requirements — what capabilities does the model need? What input/output format? What quality bar is acceptable? (4) Data requirements — what training/evaluation data exists? What needs to be collected? (5) Risk assessment — what happens when the model is wrong? What\'s the worst-case user experience? (6) Fallback strategy — how does the feature work when the AI is unavailable, slow, or produces low-confidence results? Produce a one-page spec with numbered acceptance criteria that cover both happy path and failure modes.',
          output_key: 'feature_spec',
          dependencies: [],
        },
        {
          step_id: 'ux-design',
          label: 'AI UX Design',
          role_slug: 'ux_designer',
          instruction:
            'Design the user-facing interaction for the AI feature based on the feature_spec. Address AI-specific UX challenges: (1) Loading states — design for variable AI response times (200ms to 30s), including skeleton UIs and progressive content reveal for streaming, (2) Confidence display — how to communicate AI certainty to users without overwhelming them (e.g., subtle indicators vs. explicit scores), (3) Error handling — design for model errors, timeouts, content policy blocks, and rate limits with user-friendly messaging, (4) User control — provide mechanisms for users to correct, regenerate, or provide feedback on AI outputs, (5) Transparency — how much of the AI\'s reasoning to expose and where. Produce wireframes for all states (empty, loading, streaming, complete, error, low-confidence) and an interaction flow diagram covering the complete user journey.',
          output_key: 'ux_design',
          dependencies: ['feature-scoping'],
        },
        {
          step_id: 'implementation',
          label: 'Application Implementation',
          role_slug: 'frontend',
          instruction:
            'Build the AI feature end-to-end following the ux_design and feature_spec. Implementation requirements: (1) API integration — connect to the model inference endpoint with proper authentication, retry logic (exponential backoff), and timeout handling, (2) Streaming UI — implement real-time content display for streaming responses with proper buffering and render optimization, (3) State management — handle all states from the UX design (loading, streaming, complete, error, low-confidence) with smooth transitions, (4) Error boundaries — graceful degradation at every level, never show raw API errors to users, (5) Telemetry — instrument key events (request sent, first token, complete, error, user feedback) for monitoring, (6) Tests — unit tests for state management, integration tests for API communication patterns, and snapshot tests for UI states. Output the complete implementation with a testing report.',
          output_key: 'feature_implementation',
          dependencies: ['ux-design'],
        },
        {
          step_id: 'model-integration',
          label: 'Model Integration & Testing',
          role_slug: 'backend',
          instruction:
            'Set up the model inference pipeline and validate end-to-end quality. Cover: (1) Prompt engineering — design, test, and version-control the prompts/system messages with documented iteration history, (2) Tool calling setup — if the feature uses function calling, define tool schemas, implement handlers, and test error cases, (3) Output parsing — implement robust parsing for structured outputs with validation and fallback for malformed responses, (4) Safety guardrails — content filtering, PII detection, output length limits, and cost controls (per-request and daily budget caps), (5) End-to-end testing — run the complete pipeline with 20+ realistic inputs covering happy paths, edge cases, and adversarial inputs, document pass/fail for each. Output a model integration report with prompt versions, test results matrix, identified failure modes, and recommended monitoring alerts for production.',
          output_key: 'model_integration',
          dependencies: ['implementation'],
        },
        {
          step_id: 'launch-readiness',
          label: 'Launch Readiness Review',
          role_slug: 'product_manager',
          instruction:
            'Conduct a final launch readiness review across the feature_spec, feature_implementation, and model_integration. Verify: (1) All acceptance criteria from the spec are met — walk through each one with pass/fail, (2) UX design was implemented faithfully — compare wireframes to implementation for each state, (3) Model quality meets the defined bar — review test results from model integration, (4) Error handling works end-to-end — manually trigger each failure mode and verify graceful degradation, (5) Monitoring and alerting is in place — confirm telemetry, dashboards, and alert thresholds, (6) Rollback plan — how to disable the feature quickly if something goes wrong in production. Output a launch decision document: ship/delay/rework with specific reasoning.',
          output_key: 'launch_decision',
          dependencies: ['model-integration'],
        },
      ],
    },
    {
      sop_id: 'sop-paper-review',
      name: 'Paper Review & Implementation',
      description: 'Systematic review of ML research papers and rapid prototyping of promising techniques',
      created_at: '2025-01-01T00:00:00.000Z',
      steps: [
        {
          step_id: 'paper-analysis',
          label: 'Paper Deep Analysis',
          role_slug: 'researcher',
          instruction:
            'Perform a rigorous analysis of the target research paper. Cover: (1) Core contribution — what is the paper\'s novel insight in one paragraph, distinguishing genuinely new ideas from incremental improvements, (2) Method description — explain the proposed approach in enough detail that an ML engineer could implement it, including architecture diagrams (described textually), loss functions, and training procedures, (3) Results analysis — scrutinize the experimental setup: are baselines fair? Are datasets standard? Are ablations sufficient? Do confidence intervals support the claims? (4) Reproducibility assessment — rate 1-5 based on: code availability, dataset access, hyperparameter disclosure, compute requirements disclosure, (5) Relevance score — how applicable is this to our current product/research direction, with specific use cases identified. Output a structured paper review document with clear sections.',
          output_key: 'paper_review',
          dependencies: [],
        },
        {
          step_id: 'feasibility',
          label: 'Feasibility Assessment',
          role_slug: 'backend',
          instruction:
            'Evaluate the practical feasibility of implementing the paper\'s technique based on the paper_review. Assess: (1) Compute requirements — GPU memory, training time, inference latency estimates for our hardware and scale, (2) Data requirements — do we have sufficient training/evaluation data? What data collection effort is needed? (3) Integration complexity — how does this technique fit into our existing ML pipeline? What components need modification? (4) Dependency risks — does the implementation rely on unreleased code, proprietary datasets, or specific hardware (e.g., specific GPU architectures)? (5) Timeline estimate — prototype (proof of concept) vs. production-ready implementation, with effort breakdown by component. Output a feasibility report with a go/no-go recommendation and, if go, a prioritized implementation plan.',
          output_key: 'feasibility_report',
          dependencies: ['paper-analysis'],
        },
        {
          step_id: 'prototype',
          label: 'Rapid Prototype',
          role_slug: 'fullstack',
          instruction:
            'Build a minimal but rigorous prototype of the paper\'s technique based on the feasibility_report. Requirements: (1) Implement the core algorithm faithfully — don\'t skip steps that seem minor, as they may be critical for performance, (2) Use our standard ML infrastructure (data loading, experiment tracking, evaluation harness) so results are directly comparable to existing approaches, (3) Run on a small representative dataset to validate correctness before committing to full-scale training, (4) Log everything — hyperparameters, training curves, memory usage, and wall-clock time, (5) Implement at least one ablation that removes the paper\'s key contribution to verify it matters. Output the prototype code, training logs, and preliminary results with comparison to our current baseline.',
          output_key: 'prototype_results',
          dependencies: ['feasibility'],
        },
        {
          step_id: 'benchmark',
          label: 'Benchmark & Comparison',
          role_slug: 'backend',
          instruction:
            'Run a rigorous benchmark of the prototype_results against existing baselines. Protocol: (1) Use the same evaluation dataset and metrics as our standard model evaluation pipeline for fair comparison, (2) Run multiple seeds (at least 3) to assess variance and statistical significance, (3) Measure all dimensions: quality metrics, latency, throughput, memory footprint, and cost per inference, (4) Test on our specific distribution of inputs, not just standard benchmarks — real-world performance may differ from paper claims, (5) Identify the Pareto frontier — is there a quality-cost trade-off that the paper doesn\'t discuss? Output a benchmark report with comparison tables, statistical significance tests, and a clear assessment of whether the technique delivers meaningful improvement over our current approach.',
          output_key: 'benchmark_report',
          dependencies: ['prototype'],
        },
        {
          step_id: 'decision-report',
          label: 'Adoption Decision Report',
          role_slug: 'product_manager',
          instruction:
            'Compile the paper_review, feasibility_report, prototype_results, and benchmark_report into an adoption decision document. Include: (1) Executive summary — does this paper\'s technique improve our product, by how much, and at what cost? (2) Quality impact — side-by-side comparison with current approach on metrics that matter to users, (3) Infrastructure impact — what changes are needed to deploy this in production, with effort estimate, (4) Risk analysis — what could go wrong in production that the prototype wouldn\'t catch (distribution shift, scale effects, edge cases), (5) Recommendation — one of: Adopt (proceed to production implementation), Adapt (use the core idea but modify the approach), Monitor (promising but not ready, re-evaluate in N months), or Pass (doesn\'t meet our bar), with detailed justification for each. Include a proposed next-steps timeline if the recommendation is Adopt or Adapt.',
          output_key: 'decision_report',
          dependencies: ['benchmark'],
        },
      ],
    },
  ],
  layoutPreset: 'ai-lab',
};
