import type { CompanyTemplate } from '@aics/core/browser';

interface TemplateCardProps {
  template: CompanyTemplate;
  selected: boolean;
  onSelect: () => void;
}

export function TemplateCard({ template, selected, onSelect }: TemplateCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col rounded-lg border p-4 text-left transition-colors ${
        selected
          ? 'border-blue-500 bg-blue-950/30'
          : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500'
      }`}
    >
      <div className="mb-2 text-2xl">{template.icon}</div>
      <h3 className="text-base font-semibold text-zinc-100">{template.name}</h3>
      <p className="mt-1 text-sm text-zinc-400">{template.description}</p>
      <div className="mt-3 flex gap-3 text-xs text-zinc-500">
        <span>{template.employees.length} employees</span>
        <span>{template.sops.length} SOPs</span>
      </div>
    </button>
  );
}
