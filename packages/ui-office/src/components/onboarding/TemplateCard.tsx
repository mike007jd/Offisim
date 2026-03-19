import type { CompanyTemplate } from '@aics/core/browser';
import {
  Brain,
  Briefcase,
  FlaskConical,
  PenTool,
  Rocket,
} from 'lucide-react';
import type { ReactNode } from 'react';

/** Maps template IDs to styled Lucide icons. Falls back to emoji for unknown IDs. */
const TEMPLATE_ICONS: Record<string, ReactNode> = {
  'rd-company': <FlaskConical className="h-7 w-7 text-blue-400" />,
  'product-team': <Rocket className="h-7 w-7 text-violet-400" />,
  'content-studio': <PenTool className="h-7 w-7 text-emerald-400" />,
  'agency-lite': <Briefcase className="h-7 w-7 text-amber-400" />,
  'ai-startup': <Brain className="h-7 w-7 text-cyan-400" />,
};

const TEMPLATE_ACCENT: Record<string, string> = {
  'rd-company': 'border-blue-500 bg-blue-950/30',
  'product-team': 'border-violet-500 bg-violet-950/30',
  'content-studio': 'border-emerald-500 bg-emerald-950/30',
  'agency-lite': 'border-amber-500 bg-amber-950/30',
  'ai-startup': 'border-cyan-500 bg-cyan-950/30',
};

interface TemplateCardProps {
  template: CompanyTemplate;
  selected: boolean;
  onSelect: () => void;
}

export function TemplateCard({ template, selected, onSelect }: TemplateCardProps) {
  const icon = TEMPLATE_ICONS[template.id] ?? (
    <span className="text-2xl">{template.icon}</span>
  );
  const accent = selected
    ? (TEMPLATE_ACCENT[template.id] ?? 'border-blue-500 bg-blue-950/30')
    : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col rounded-lg border p-4 text-left transition-colors ${accent}`}
    >
      <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-md bg-zinc-800/80">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-zinc-100">{template.name}</h3>
      <p className="mt-1 text-sm text-zinc-400">{template.description}</p>
      <div className="mt-3 flex gap-3 text-xs text-zinc-500">
        <span>{template.employees.length} employees</span>
        <span>{template.sops.length} SOPs</span>
      </div>
    </button>
  );
}
