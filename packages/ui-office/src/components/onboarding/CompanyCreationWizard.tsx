import { Loader2 } from 'lucide-react';
import { useCompanyCreation } from '../../hooks/useCompanyCreation.js';
import { TemplateCard } from './TemplateCard.js';

export function CompanyCreationWizard() {
  const {
    step,
    templates,
    selectedTemplateId,
    companyName,
    setSelectedTemplateId,
    setCompanyName,
    create,
    error,
  } = useCompanyCreation();

  if (step === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <p className="text-zinc-400">Loading...</p>
      </div>
    );
  }

  if (step === 'ready') return null;

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/95">
      <div className="mx-auto w-full max-w-2xl px-6">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-zinc-100">Welcome to AI Company Simulator</h1>
          <p className="mt-2 text-zinc-400">
            Choose a template to set up your AI company. You can customize everything later.
          </p>
        </div>

        {step === 'creating' ? (
          <div className="py-12 text-center">
            <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-blue-400" />
            <p className="text-zinc-300">Setting up your company...</p>
            <p className="mt-1 text-sm text-zinc-500">
              Creating {selectedTemplate?.employees.length ?? 0} employees and{' '}
              {selectedTemplate?.sops.length ?? 0} SOPs
            </p>
          </div>
        ) : (
          <>
            {/* Template grid */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {templates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  selected={selectedTemplateId === template.id}
                  onSelect={() => setSelectedTemplateId(template.id)}
                />
              ))}
            </div>

            {/* Selected template preview */}
            {selectedTemplate && (
              <div className="mt-6 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
                <h3 className="text-sm font-semibold text-zinc-200">
                  {selectedTemplate.icon} {selectedTemplate.name} Team
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedTemplate.employees.map((emp) => (
                    <span
                      key={emp.name}
                      className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
                    >
                      {emp.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Company name + create */}
            <div className="mt-6 flex items-end gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs text-zinc-400" htmlFor="company-name">
                  Company Name
                </label>
                <input
                  id="company-name"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200"
                />
              </div>
              <button
                type="button"
                onClick={create}
                disabled={!selectedTemplateId}
                className="rounded bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
              >
                Start Company
              </button>
            </div>

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
