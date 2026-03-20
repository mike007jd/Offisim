import { Loader2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useCompanyCreation } from '../../hooks/useCompanyCreation.js';
import { TemplateCard } from './TemplateCard.js';

interface CompanyCreationWizardProps {
  /** Called once when the company transitions to 'ready' for the first time. */
  onComplete?: () => void;
}

export function CompanyCreationWizard({ onComplete }: CompanyCreationWizardProps) {
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

  // Track prior step so we only fire onComplete on the first-run → ready transition
  const prevStepRef = useRef(step);
  useEffect(() => {
    if (prevStepRef.current === 'creating' && step === 'ready') {
      onComplete?.();
    }
    prevStepRef.current = step;
  }, [step, onComplete]);

  if (step === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <p className="text-slate-400">Loading...</p>
      </div>
    );
  }

  if (step === 'ready') return null;

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-start bg-slate-950/95">
      <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-6 py-8">
        {/* Header — pinned */}
        <div className="mb-6 shrink-0 text-center">
          <h1 className="text-2xl font-bold text-slate-100">Welcome to Offisim</h1>
          <p className="mt-2 text-slate-400">
            Choose a template to set up your AI company. You can customize everything later.
          </p>
        </div>

        {step === 'creating' ? (
          <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
            <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-blue-400" />
            <p className="text-slate-300">Setting up your company...</p>
            <p className="mt-1 text-sm text-slate-500">
              Creating {selectedTemplate?.employees.length ?? 0} employees and{' '}
              {selectedTemplate?.sops.length ?? 0} SOPs
            </p>
          </div>
        ) : (
          <>
            {/* Template grid — scrollable middle area */}
            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
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
                <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900 p-4">
                  <h3 className="text-sm font-semibold text-slate-200">
                    {selectedTemplate.icon} {selectedTemplate.name} Team
                  </h3>
                  <div className="mt-2 max-h-20 overflow-y-auto flex flex-wrap gap-2">
                    {selectedTemplate.employees.map((emp) => (
                      <span
                        key={emp.name}
                        className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-300"
                      >
                        {emp.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer — pinned: company name + button */}
            <div className="shrink-0 pt-4">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-slate-400" htmlFor="company-name">
                    Company Name
                  </label>
                  <input
                    id="company-name"
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200"
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}
