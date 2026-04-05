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
    title: 'Welcome to your team',
    body: "I'm the boss — describe a task and I'll delegate it to the right people. Try one of these to see how we work.",
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
      title: 'Welcome to the R&D floor',
      body: 'I run the research and development team. Give me a product or research problem and I will get engineering and design on it right away.',
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
      {
        label: 'Prototype plan',
        text: 'Plan a 2-week prototype for an AI-powered code review assistant.',
      },
    ],
  },
  'ai-startup': {
    welcome: {
      title: 'Welcome to the startup',
      body: 'We move fast and ship weekly. Point me at a customer problem or a go-to-market question and the team will start working.',
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
      {
        label: 'Go-to-market',
        text: 'Draft a go-to-market plan for launching an AI code review SaaS to indie developers.',
      },
    ],
  },
  'agency-lite': {
    welcome: {
      title: 'Welcome to the agency',
      body: 'We handle client work end-to-end — strategy, creative, delivery. Give me a brief and I will assign the right specialists.',
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
      {
        label: 'Social plan',
        text: 'Plan a 30-day social content calendar for a B2B SaaS launch.',
      },
    ],
  },
  'product-team': {
    welcome: {
      title: 'Welcome to the product team',
      body: 'We build, measure, learn. Hand me a product decision or feature idea and I will line up PM, design, and engineering.',
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
      {
        label: 'Roadmap',
        text: 'Plan a 6-month roadmap for a new mobile-first task management app.',
      },
    ],
  },
  'content-studio': {
    welcome: {
      title: 'Welcome to the studio',
      body: 'We produce words, visuals, and stories that ship. Give me a topic or brand and the studio will start drafting.',
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
      {
        label: 'Newsletter',
        text: 'Plan a weekly newsletter series for developers interested in AI tooling.',
      },
    ],
  },
} as const satisfies Record<string, OnboardingCopy>;

type KnownTemplateId = keyof typeof COPY_BY_TEMPLATE;

export function getOnboardingCopy(templateId: string | null | undefined): OnboardingCopy {
  if (!templateId) return DEFAULT_COPY;
  return COPY_BY_TEMPLATE[templateId as KnownTemplateId] ?? DEFAULT_COPY;
}
