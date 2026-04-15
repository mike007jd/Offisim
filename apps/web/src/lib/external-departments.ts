import {
  defineExternalDepartments,
  type ExternalDepartmentDefinition,
  type ExternalDepartmentSeed,
} from '@offisim/core/browser';

const DEFAULT_DEPARTMENT_SEEDS: readonly ExternalDepartmentSeed[] = [
  {
    id: 'dept_external_frontend',
    name: 'External Frontend',
    summary: 'Partner frontend team for web prototypes, single-file demos, and UI implementation.',
    capabilities: ['frontend', 'prototype', 'react', 'html', 'css', 'typescript'],
    keywords: ['frontend', 'prototype', 'ui', 'react', 'html', 'css', 'typescript', 'web'],
    roleSlugHint: 'developer',
    brandingIcon: 'code',
    peer: {
      name: 'External Frontend',
      url: import.meta.env.VITE_OFFISIM_A2A_FRONTEND_URL,
      token: import.meta.env.VITE_OFFISIM_A2A_FRONTEND_TOKEN,
      agentId: import.meta.env.VITE_OFFISIM_A2A_FRONTEND_AGENT_ID,
    },
  },
  {
    id: 'dept_external_research',
    name: 'Research Partner',
    summary: 'Outside research unit for validation, analysis, benchmarking, and market scans.',
    capabilities: ['research', 'analysis', 'validation', 'benchmarking', 'market'],
    keywords: [
      'research',
      'analysis',
      'validate',
      'validation',
      'benchmark',
      'benchmarking',
      'market',
      'interview',
    ],
    roleSlugHint: 'analyst',
    brandingIcon: 'search',
    peer: {
      name: 'Research Partner',
      url: import.meta.env.VITE_OFFISIM_A2A_RESEARCH_URL,
      token: import.meta.env.VITE_OFFISIM_A2A_RESEARCH_TOKEN,
      agentId: import.meta.env.VITE_OFFISIM_A2A_RESEARCH_AGENT_ID,
    },
  },
  {
    id: 'dept_external_legal',
    name: 'Legal Vendor',
    summary: 'External legal desk for policy review, terms drafting, and compliance checks.',
    capabilities: ['legal', 'policy', 'contract', 'terms', 'compliance'],
    keywords: ['legal', 'policy', 'contract', 'terms', 'compliance', 'privacy', 'risk'],
    roleSlugHint: 'analyst',
    brandingIcon: 'shield',
    peer: {
      name: 'Legal Vendor',
      url: import.meta.env.VITE_OFFISIM_A2A_LEGAL_URL,
      token: import.meta.env.VITE_OFFISIM_A2A_LEGAL_TOKEN,
      agentId: import.meta.env.VITE_OFFISIM_A2A_LEGAL_AGENT_ID,
    },
  },
];

export function loadExternalDepartments(): ExternalDepartmentDefinition[] {
  return defineExternalDepartments(DEFAULT_DEPARTMENT_SEEDS);
}
