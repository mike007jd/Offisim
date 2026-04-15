// Welcome strings are local fixed copy (no LLM call) — first impression must be instant and deterministic.

export interface StarterPrompt {
  label: string;
  text: string;
}

export interface OnboardingCopy {
  welcome: {
    title: string;
    body: string;
  };
  starterPrompts: StarterPrompt[];
}

const DEFAULT_COPY: OnboardingCopy = {
  welcome: {
    title: 'Start with a task',
    body: "Describe the outcome you want. I'll route it to the right people.",
  },
  starterPrompts: [
    {
      label: 'Market report',
      text: 'Write a short market analysis report on the AI coding tools space.',
    },
    {
      label: 'Launch plan',
      text: 'Draft a launch plan for a new product, including key milestones.',
    },
    { label: 'Hiring JD', text: 'Write a job description for a senior full-stack engineer.' },
  ],
};

const COPY_BY_TEMPLATE = {
  'rd-company': {
    welcome: {
      title: 'Start with a product task',
      body: 'Describe a product or research outcome. I will route engineering and design.',
    },
    starterPrompts: [
      {
        label: 'Feature spec',
        text: 'Draft a spec for a real-time collaboration feature we could build next quarter.',
      },
      {
        label: 'Tech RFC',
        text: 'Write an RFC comparing Postgres, SQLite, and DuckDB for an embedded analytics workload.',
      },
    ],
  },
  'ai-startup': {
    welcome: {
      title: 'Start with a launch task',
      body: 'Give me a customer or go-to-market problem. The team will start working.',
    },
    starterPrompts: [
      {
        label: 'Pitch deck',
        text: 'Outline a 10-slide pitch deck for a Series A AI infrastructure company.',
      },
      {
        label: 'Landing copy',
        text: 'Write landing page copy for an AI agent platform targeting solo developers.',
      },
    ],
  },
  'agency-lite': {
    welcome: {
      title: 'Start with a client brief',
      body: 'Give me the brief. I will assign the right specialists.',
    },
    starterPrompts: [
      {
        label: 'Campaign brief',
        text: 'Draft a Q2 marketing campaign brief for a new sustainable running shoe.',
      },
      {
        label: 'Brand voice',
        text: 'Define a brand voice guide for a premium coffee subscription service.',
      },
    ],
  },
  'product-team': {
    welcome: {
      title: 'Start with a product decision',
      body: 'Hand me a feature idea or decision. I will line up PM, design, and engineering.',
    },
    starterPrompts: [
      {
        label: 'PRD',
        text: 'Write a PRD for a notifications center that supports email, push, and in-app delivery.',
      },
      {
        label: 'North star',
        text: 'Propose a north-star metric and supporting metrics for a B2B collaboration tool.',
      },
    ],
  },
  'content-studio': {
    welcome: {
      title: 'Start with a content brief',
      body: 'Give me a topic or brand. The studio will start drafting.',
    },
    starterPrompts: [
      {
        label: 'Article draft',
        text: 'Write a 1200-word article on why AI agents will change how teams build software.',
      },
      {
        label: 'Script',
        text: 'Draft a 60-second explainer video script for a new AI-powered notes app.',
      },
    ],
  },
} as const satisfies Record<string, OnboardingCopy>;

type KnownTemplateId = keyof typeof COPY_BY_TEMPLATE;

export function getOnboardingCopy(templateId: string | null | undefined): OnboardingCopy {
  if (!templateId) return DEFAULT_COPY;
  return COPY_BY_TEMPLATE[templateId as KnownTemplateId] ?? DEFAULT_COPY;
}
