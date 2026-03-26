import { useCallback, useRef, useState } from 'react';
import type { UseEmployeeWorkshopReturn } from '../../hooks/useEmployeeWorkshop.js';
import { useInterviewWizard } from '../../hooks/useInterviewWizard.js';
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
  const [confirmBatch, setConfirmBatch] = useState(false);

  // InterviewWizard for adding a new employee from within the workshop
  const wizard = useInterviewWizard();
  const [wizardOpen, setWizardOpen] = useState(false);

  // Agent states for status indicators
  const agentStates = useAgentStates();

  const overlayRef = useRef<HTMLDialogElement>(null);

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
    (e: React.MouseEvent<HTMLDialogElement>) => {
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
      <dialog
        ref={overlayRef}
        onClick={handleBackdropClick}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            close();
          }
        }}
        className="fixed inset-0 z-50 m-0 flex flex-col border-0 bg-black/40 p-0 backdrop-blur-sm"
        open
        aria-modal="true"
        aria-label="Employee Workshop"
        tabIndex={-1}
      >
        {/* Panel */}
        <div className="m-auto w-full max-w-6xl max-h-[90vh] flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 shrink-0">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Employee Workshop</h2>
              <p className="text-xs text-slate-400/70 mt-0.5">
                {employees.length} employee{employees.length !== 1 ? 's' : ''} · Click any field to
                edit inline
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="text-slate-400 hover:text-slate-900 transition-colors text-xl leading-none px-2 py-1 rounded hover:bg-white/5"
              aria-label="Close workshop"
            >
              ✕
            </button>
          </div>

          {/* Batch actions toolbar */}
          <div className="flex flex-wrap items-center gap-3 px-6 py-3 bg-slate-100/40 border-b border-slate-700 shrink-0">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
              Batch Apply:
            </span>

            {/* Model selector */}
            <select
              value={batchModel}
              onChange={(e) => setBatchModel(e.target.value)}
              className="text-xs border border-slate-700 rounded px-2 py-1 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              <label htmlFor="workshop-temp" className="text-xs text-slate-400 whitespace-nowrap">
                Temperature:{' '}
                <span className="font-mono text-slate-900">{batchTemp.toFixed(1)}</span>
              </label>
              <input
                id="workshop-temp"
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={batchTemp}
                onChange={(e) => setBatchTemp(Number.parseFloat(e.target.value))}
                className="w-28 accent-blue-500"
              />
            </div>

            <button
              type="button"
              onClick={() => setConfirmBatch(true)}
              disabled={isBatchApplying || employees.length === 0}
              className="text-xs px-3 py-1 bg-red-500 text-white rounded hover:bg-red-500/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isBatchApplying ? 'Applying...' : 'Apply to All'}
            </button>
          </div>

          {/* Cards grid — scrollable */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {isLoading ? (
              <div className="flex items-center justify-center h-48 text-slate-400/60 text-sm">
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
                  className="flex flex-col items-center justify-center gap-2 bg-white border-2 border-dashed border-slate-700 rounded-lg p-4 text-slate-400 hover:border-red-500 hover:text-red-500 transition-colors min-h-[200px]"
                  aria-label="Add new employee"
                >
                  <span className="text-3xl leading-none">+</span>
                  <span className="text-xs font-medium">New Employee</span>
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-3 border-t border-slate-700 bg-slate-100/20 shrink-0">
            <span className="text-xs text-slate-400/70">
              {employees.length} employee{employees.length !== 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={close}
              className="text-sm px-4 py-1.5 border border-slate-700 rounded hover:bg-white/5 text-slate-900 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </dialog>

      {/* Interview wizard for adding new employees */}
      <InterviewWizard isOpen={wizardOpen} onClose={() => setWizardOpen(false)} wizard={wizard} />

      {/* Batch operation confirmation overlay */}
      {confirmBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="rounded-xl border border-white/10 bg-slate-900 p-4 max-w-sm">
            <p className="text-sm text-white/80 mb-3">
              Apply changes to all {employees.length} employees?
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition-colors"
                onClick={() => setConfirmBatch(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
                onClick={() => {
                  handleApplyAll();
                  setConfirmBatch(false);
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
