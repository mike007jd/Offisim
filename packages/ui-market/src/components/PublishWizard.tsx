'use client';

import { useReducer } from 'react';
import { RegistryClient } from '@aics/registry-client';
import { useAuthContext } from './AuthProvider.js';
import { ManifestEditor } from './ManifestEditor.js';
import { ValidationPanel, validateManifestClient } from './ValidationPanel.js';
import { PublishPreview, type PublishPreviewDraft } from './PublishPreview.js';
import { PLATFORM_API_URL } from '../lib/config.js';

const ASSET_KINDS = [
  { value: 'employee', label: 'Employee' },
  { value: 'skill', label: 'Skill' },
  { value: 'sop', label: 'SOP' },
  { value: 'company_template', label: 'Company Template' },
  { value: 'office_layout', label: 'Office Layout' },
  { value: 'bundle', label: 'Bundle' },
] as const;

const STEPS = [
  { number: 1, label: 'Basic Info' },
  { number: 2, label: 'Manifest' },
  { number: 3, label: 'Validate' },
  { number: 4, label: 'Preview' },
  { number: 5, label: 'Submit' },
] as const;

// ── State ──────────────────────────────────────────────────────────────────

interface FormData {
  title: string;
  kind: string;
  summary: string;
  description: string;
  tags: string;
}

interface WizardState {
  step: number;
  formData: FormData;
  manifest: Record<string, unknown>;
  draftId: string | null;
  submissionStatus: 'idle' | 'loading' | 'success' | 'error';
  submissionMessage: string;
  stepError: string | null;
}

type WizardAction =
  | { type: 'SET_STEP'; step: number }
  | { type: 'SET_FORM'; field: keyof FormData; value: string }
  | { type: 'SET_MANIFEST'; manifest: Record<string, unknown> }
  | { type: 'SET_DRAFT_ID'; draftId: string }
  | { type: 'SET_STEP_ERROR'; error: string | null }
  | { type: 'SET_SUBMISSION'; status: WizardState['submissionStatus']; message?: string };

function initialManifest(formData: FormData): Record<string, unknown> {
  return {
    spec_version: '1.0.0',
    package: {
      id: '',
      kind: formData.kind,
      version: '1.0.0',
      title: formData.title,
      summary: formData.summary,
      license: 'MIT',
    },
    compatibility: {
      runtime_range: '>=0.1.0',
      schema_version: '1.0.0',
      supported_environments: ['desktop'],
    },
    requirements: {
      required_capabilities: [],
      required_mcps: [],
    },
    permissions: {
      risk_class: 'data_asset',
      declares_secrets: false,
      filesystem_scope: 'none',
      network_scope: 'none',
    },
    assets: [],
    distribution: {},
    integrity: {
      package_sha256: '',
    },
  };
}

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, step: action.step, stepError: null };
    case 'SET_FORM':
      return {
        ...state,
        formData: { ...state.formData, [action.field]: action.value },
        stepError: null,
      };
    case 'SET_MANIFEST':
      return { ...state, manifest: action.manifest };
    case 'SET_DRAFT_ID':
      return { ...state, draftId: action.draftId };
    case 'SET_STEP_ERROR':
      return { ...state, stepError: action.error };
    case 'SET_SUBMISSION':
      return {
        ...state,
        submissionStatus: action.status,
        submissionMessage: action.message ?? '',
      };
    default:
      return state;
  }
}

function createInitialState(): WizardState {
  const formData: FormData = {
    title: '',
    kind: 'employee',
    summary: '',
    description: '',
    tags: '',
  };
  return {
    step: 1,
    formData,
    manifest: initialManifest(formData),
    draftId: null,
    submissionStatus: 'idle',
    submissionMessage: '',
    stepError: null,
  };
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StepIndicator({ steps, currentStep }: { steps: typeof STEPS; currentStep: number }) {
  return (
    <nav aria-label="Progress" className="mb-8">
      <ol className="flex items-center gap-0">
        {steps.map((step, idx) => {
          const isDone = step.number < currentStep;
          const isCurrent = step.number === currentStep;
          return (
            <li key={step.number} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
                    isDone
                      ? 'bg-blue-600 text-white'
                      : isCurrent
                        ? 'border-2 border-blue-600 text-blue-600'
                        : 'border-2 border-gray-200 text-gray-400'
                  }`}
                >
                  {isDone ? '✓' : step.number}
                </div>
                <span
                  className={`mt-1 text-xs ${isCurrent ? 'font-medium text-blue-600' : 'text-gray-400'}`}
                >
                  {step.label}
                </span>
              </div>
              {idx < steps.length - 1 && (
                <div
                  className={`mx-2 mb-4 h-0.5 w-10 flex-shrink-0 sm:w-16 ${
                    step.number < currentStep ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-gray-700">
      {children}
    </label>
  );
}

const inputCls =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50';

// ── Main component ─────────────────────────────────────────────────────────

export interface PublishWizardProps {
  onComplete?: () => void;
}

export function PublishWizard({ onComplete }: PublishWizardProps) {
  const { token } = useAuthContext();
  const [state, dispatch] = useReducer(reducer, undefined, createInitialState);

  function getClient(): RegistryClient {
    if (!token) throw new Error('Not authenticated');
    return new RegistryClient({ baseUrl: PLATFORM_API_URL, authToken: token });
  }

  function parsedTags(): string[] {
    return state.formData.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }

  // ── Step handlers ──────────────────────────────────────────────────────

  async function handleStep1Next() {
    if (!state.formData.title.trim()) {
      dispatch({ type: 'SET_STEP_ERROR', error: 'Title is required.' });
      return;
    }
    if (!state.formData.kind) {
      dispatch({ type: 'SET_STEP_ERROR', error: 'Kind is required.' });
      return;
    }
    dispatch({ type: 'SET_STEP_ERROR', error: null });

    try {
      const client = getClient();
      const draft = await client.createPublishDraft({
        kind: state.formData.kind as Parameters<typeof client.createPublishDraft>[0]['kind'],
        title: state.formData.title.trim(),
        summary: state.formData.summary.trim() || undefined,
      });
      dispatch({ type: 'SET_DRAFT_ID', draftId: draft.draft_id });
      // Seed manifest with form data
      dispatch({
        type: 'SET_MANIFEST',
        manifest: initialManifest(state.formData),
      });
      dispatch({ type: 'SET_STEP', step: 2 });
    } catch (err) {
      dispatch({
        type: 'SET_STEP_ERROR',
        error: err instanceof Error ? err.message : 'Failed to create draft.',
      });
    }
  }

  async function handleStep2Next() {
    if (!state.draftId) {
      dispatch({ type: 'SET_STEP_ERROR', error: 'No draft ID — go back to step 1.' });
      return;
    }
    try {
      const client = getClient();
      await client.putDraftManifest(state.draftId, {
        manifest_json: state.manifest,
      });
      dispatch({ type: 'SET_STEP', step: 3 });
    } catch (err) {
      dispatch({
        type: 'SET_STEP_ERROR',
        error: err instanceof Error ? err.message : 'Failed to save manifest.',
      });
    }
  }

  function handleStep3Next() {
    const { valid } = validateManifestClient(state.manifest);
    if (!valid) {
      dispatch({
        type: 'SET_STEP_ERROR',
        error: 'Fix all validation issues before proceeding.',
      });
      return;
    }
    dispatch({ type: 'SET_STEP', step: 4 });
  }

  function handleStep4Next() {
    dispatch({ type: 'SET_STEP', step: 5 });
  }

  async function handleSubmit() {
    if (!state.draftId) {
      dispatch({ type: 'SET_STEP_ERROR', error: 'No draft ID.' });
      return;
    }
    dispatch({ type: 'SET_SUBMISSION', status: 'loading' });
    try {
      const client = getClient();
      const result = await client.submitPublishDraft({ draft_id: state.draftId });
      dispatch({
        type: 'SET_SUBMISSION',
        status: 'success',
        message: `Submitted! Status: ${result.status}. Job ID: ${result.moderation_job_id}`,
      });
      onComplete?.();
    } catch (err) {
      dispatch({
        type: 'SET_SUBMISSION',
        status: 'error',
        message: err instanceof Error ? err.message : 'Submission failed.',
      });
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const { step, formData, manifest, stepError, submissionStatus, submissionMessage } = state;

  const tags = parsedTags();

  return (
    <div className="mx-auto max-w-2xl py-8">
      <StepIndicator steps={STEPS} currentStep={step} />

      {/* Step 1 — Basic Info */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Basic Info</h2>
          <div>
            <FieldLabel htmlFor="wiz-kind">Kind</FieldLabel>
            <select
              id="wiz-kind"
              value={formData.kind}
              onChange={(e) => dispatch({ type: 'SET_FORM', field: 'kind', value: e.target.value })}
              className={inputCls}
            >
              {ASSET_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel htmlFor="wiz-title">Title *</FieldLabel>
            <input
              id="wiz-title"
              type="text"
              value={formData.title}
              onChange={(e) =>
                dispatch({ type: 'SET_FORM', field: 'title', value: e.target.value })
              }
              placeholder="My Awesome Employee"
              className={inputCls}
            />
          </div>
          <div>
            <FieldLabel htmlFor="wiz-summary">Summary</FieldLabel>
            <textarea
              id="wiz-summary"
              value={formData.summary}
              onChange={(e) =>
                dispatch({ type: 'SET_FORM', field: 'summary', value: e.target.value })
              }
              placeholder="One-line description shown on listing cards"
              rows={2}
              className={inputCls}
            />
          </div>
          <div>
            <FieldLabel htmlFor="wiz-description">Description</FieldLabel>
            <textarea
              id="wiz-description"
              value={formData.description}
              onChange={(e) =>
                dispatch({ type: 'SET_FORM', field: 'description', value: e.target.value })
              }
              placeholder="Full description shown on the detail page (Markdown supported)"
              rows={5}
              className={inputCls}
            />
          </div>
          <div>
            <FieldLabel htmlFor="wiz-tags">Tags (comma-separated)</FieldLabel>
            <input
              id="wiz-tags"
              type="text"
              value={formData.tags}
              onChange={(e) =>
                dispatch({ type: 'SET_FORM', field: 'tags', value: e.target.value })
              }
              placeholder="productivity, automation, hr"
              className={inputCls}
            />
          </div>
        </div>
      )}

      {/* Step 2 — Manifest */}
      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Manifest</h2>
          <p className="text-sm text-gray-500">
            Configure your asset manifest. Switch to JSON view for full control.
          </p>
          <ManifestEditor
            manifest={manifest}
            onChange={(m) => dispatch({ type: 'SET_MANIFEST', manifest: m })}
          />
        </div>
      )}

      {/* Step 3 — Validate */}
      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Validate</h2>
          <p className="text-sm text-gray-500">
            All checks must pass before you can proceed.
          </p>
          <ValidationPanel manifest={manifest} />
        </div>
      )}

      {/* Step 4 — Preview */}
      {step === 4 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Preview</h2>
          <p className="text-sm text-gray-500">
            This is how your listing will appear on the marketplace.
          </p>
          <PublishPreview
            draft={{
              title: formData.title,
              kind: formData.kind,
              summary: formData.summary,
              description: formData.description,
              tags,
              version:
                typeof (manifest as { package?: { version?: string } }).package?.version === 'string'
                  ? (manifest as { package?: { version?: string } }).package?.version
                  : undefined,
              permissions:
                typeof manifest.permissions === 'object' && manifest.permissions !== null
                  ? (manifest.permissions as PublishPreviewDraft['permissions'])
                  : undefined,
            }}
          />
        </div>
      )}

      {/* Step 5 — Submit */}
      {step === 5 && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-gray-900">Submit for Review</h2>

          {submissionStatus !== 'success' && (
            <>
              <div className="rounded-lg border border-gray-200 p-4 text-sm">
                <h3 className="mb-3 font-semibold text-gray-900">Summary</h3>
                <dl className="space-y-2 text-gray-700">
                  <div className="flex gap-2">
                    <dt className="min-w-[80px] font-medium text-gray-500">Title</dt>
                    <dd>{formData.title}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="min-w-[80px] font-medium text-gray-500">Kind</dt>
                    <dd>{formData.kind}</dd>
                  </div>
                  {formData.summary && (
                    <div className="flex gap-2">
                      <dt className="min-w-[80px] font-medium text-gray-500">Summary</dt>
                      <dd>{formData.summary}</dd>
                    </div>
                  )}
                  {tags.length > 0 && (
                    <div className="flex gap-2">
                      <dt className="min-w-[80px] font-medium text-gray-500">Tags</dt>
                      <dd>{tags.join(', ')}</dd>
                    </div>
                  )}
                  {state.draftId && (
                    <div className="flex gap-2">
                      <dt className="min-w-[80px] font-medium text-gray-500">Draft ID</dt>
                      <dd className="font-mono text-xs">{state.draftId}</dd>
                    </div>
                  )}
                </dl>
              </div>

              <p className="text-sm text-gray-500">
                By submitting, you confirm this listing complies with AICS marketplace policies.
                Your listing will enter moderation review.
              </p>
            </>
          )}

          {submissionStatus === 'success' && (
            <div className="rounded-md bg-green-50 border border-green-200 px-4 py-4 text-sm text-green-800">
              <p className="font-semibold">Submitted!</p>
              <p className="mt-1">{submissionMessage}</p>
              <a
                href="/dashboard"
                className="mt-3 inline-block text-sm font-medium text-blue-600 hover:underline"
              >
                Back to Dashboard
              </a>
            </div>
          )}

          {submissionStatus === 'error' && (
            <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {submissionMessage}
            </div>
          )}
        </div>
      )}

      {/* Error banner */}
      {stepError && (
        <div
          role="alert"
          className="mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
        >
          {stepError}
        </div>
      )}

      {/* Navigation */}
      <div className="mt-8 flex items-center justify-between">
        <button
          type="button"
          onClick={() => dispatch({ type: 'SET_STEP', step: step - 1 })}
          disabled={step === 1}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Back
        </button>

        {step < 5 && (
          <button
            type="button"
            onClick={
              step === 1
                ? handleStep1Next
                : step === 2
                  ? handleStep2Next
                  : step === 3
                    ? handleStep3Next
                    : handleStep4Next
            }
            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Next
          </button>
        )}

        {step === 5 && submissionStatus !== 'success' && (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submissionStatus === 'loading'}
            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submissionStatus === 'loading' ? 'Submitting…' : 'Submit for Review'}
          </button>
        )}
      </div>
    </div>
  );
}
