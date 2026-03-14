import { useCallback, useRef, useState } from 'react';
import { useInterviewWizard } from '../../hooks/useInterviewWizard.js';
import type { UseEmployeeWorkshopReturn } from '../../hooks/useEmployeeWorkshop.js';
import { useAgentStates } from '../../runtime/use-agent-states.js';
import { EmployeeQuickCard } from './EmployeeQuickCard.js';
import { InterviewWizard } from './InterviewWizard.js';

// ---------------------------------------------------------------------------
// Common preset model names
// ---------------------------------------------------------------------------
const MODEL_PRESETS = [
  { value: '', label: 'Default (runtime setting)' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
  { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
  { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' },
  { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
];

// ---------------------------------------------------------------------------
// EmployeeWorkshop
// ---------------------------------------------------------------------------

interface EmployeeWorkshopProps extends UseEmployeeWorkshopReturn {}

export function EmployeeWorkshop({
  employees,
  isOpen,
  isLoading,
  updateEmployee,
  batchUpdateModel,
  batchUpdateTemperature,
  close,
}: EmployeeWorkshopProps) {
  // Batch controls local state
  const [batchModel, setBatchModel] = useState('');
  const [batchTemp, setBatchTemp] = useState(0.7);
  const [isBatchApplying, setIsBatchApplying] = useState(false);

  // InterviewWizard for adding a new employee from within the workshop
  const wizard = useInterviewWizard();
  const [wizardOpen, setWizardOpen] = useState(false);

  // Agent states for status indicators
  const agentStates = useAgentStates();

  const overlayRef = useRef<HTMLDivElement>(null);

  const handleApplyAll = useCallback(async () => {
    setIsBatchApplying(true);
    try {
      await batchUpdateModel(batchModel);
      await batchUpdateTemperature(batchTemp);
    } finally {
      setIsBatchApplying(false);
    }
  }, [batchModel, batchTemp, batchUpdateModel, batchUpdateTemperature]);

  // Close on backdrop click
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === overlayRef.current) {
        close();
      }
    },
    [close],
  );

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        ref={overlayRef}
        onClick={handleBackdropClick}
        className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Employee Workshop"
      >
        {/* Panel */}
        <div className="m-auto w-full max-w-6xl max-h-[90vh] flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-ocean-light shrink-0">
            <div>
              <h2 className="text-lg font-semibold text-ink">Employee Workshop</h2>
              <p className="text-xs text-shell/70 mt-0.5">
                {employees.length} employee{employees.length !== 1 ? 's' : ''} · Click any field to edit inline
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="text-shell hover:text-ink transition-colors text-xl leading-none px-2 py-1 rounded hover:bg-ocean-light/30"
              aria-label="Close workshop"
            >
              ✕
            </button>
          </div>

          {/* Batch actions toolbar */}
          <div className="flex flex-wrap items-center gap-3 px-6 py-3 bg-sand/40 border-b border-ocean-light shrink-0">
            <span className="text-xs font-medium text-shell uppercase tracking-wider">Batch Apply:</span>

            {/* Model selector */}
            <select
              value={batchModel}
              onChange={(e) => setBatchModel(e.target.value)}
              className="text-xs border border-ocean-light rounded px-2 py-1 bg-white text-ink focus:outline-none focus:ring-1 focus:ring-lobster-red"
              aria-label="Select model for all employees"
            >
              {MODEL_PRESETS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {/* Temperature slider */}
            <div className="flex items-center gap-2">
              <label htmlFor="workshop-temp" className="text-xs text-shell whitespace-nowrap">
                Temperature: <span className="font-mono text-ink">{batchTemp.toFixed(1)}</span>
              </label>
              <input
                id="workshop-temp"
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={batchTemp}
                onChange={(e) => setBatchTemp(Number.parseFloat(e.target.value))}
                className="w-28 accent-lobster-red"
              />
            </div>

            <button
              type="button"
              onClick={handleApplyAll}
              disabled={isBatchApplying || employees.length === 0}
              className="text-xs px-3 py-1 bg-lobster-red text-white rounded hover:bg-lobster-red/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isBatchApplying ? 'Applying...' : 'Apply to All'}
            </button>
          </div>

          {/* Cards grid — scrollable */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {isLoading ? (
              <div className="flex items-center justify-center h-48 text-shell/60 text-sm">
                Loading employees…
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {employees.map((emp) => (
                  <EmployeeQuickCard
                    key={emp.employee_id}
                    employee={emp}
                    agentState={agentStates.get(emp.employee_id)?.state}
                    onUpdate={updateEmployee}
                  />
                ))}

                {/* Add new employee card */}
                <button
                  type="button"
                  onClick={() => setWizardOpen(true)}
                  className="flex flex-col items-center justify-center gap-2 bg-white border-2 border-dashed border-ocean-light rounded-lg p-4 text-shell hover:border-lobster-red hover:text-lobster-red transition-colors min-h-[200px]"
                  aria-label="Add new employee"
                >
                  <span className="text-3xl leading-none">+</span>
                  <span className="text-xs font-medium">New Employee</span>
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-3 border-t border-ocean-light bg-sand/20 shrink-0">
            <span className="text-xs text-shell/70">
              {employees.length} employee{employees.length !== 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={close}
              className="text-sm px-4 py-1.5 border border-ocean-light rounded hover:bg-ocean-light/30 text-ink transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Interview wizard for adding new employees */}
      <InterviewWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        wizard={wizard}
      />
    </>
  );
}
