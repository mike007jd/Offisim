'use client';

import { useCallback, useState } from 'react';
import { getField } from '../lib/manifest-utils.js';

export interface ManifestEditorProps {
  manifest: Record<string, unknown>;
  onChange: (manifest: Record<string, unknown>) => void;
}

const inputCls =
  'w-full rounded-md border border-[var(--border-bright)] px-3 py-2 text-sm placeholder-[var(--text-muted)] focus:border-[var(--accent-indigo)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-indigo)]';

const ASSET_KINDS = [
  'employee',
  'skill',
  'sop',
  'company_template',
  'office_layout',
  'bundle',
] as const;

const RISK_CLASSES = ['data_asset', 'logic_asset', 'privileged_asset'] as const;

const FILESYSTEM_SCOPES = ['none', 'workspace', 'project', 'custom_path'] as const;

const NETWORK_SCOPES = ['none', 'limited', 'unrestricted'] as const;

const ENVIRONMENTS = ['desktop', 'docker', 'web_limited'] as const;

function setField(
  manifest: Record<string, unknown>,
  value: unknown,
  ...path: string[]
): Record<string, unknown> {
  if (path.length === 0) return manifest;
  const [head, ...tail] = path as [string, ...string[]];
  if (tail.length === 0) {
    return { ...manifest, [head]: value };
  }
  const nested = (manifest[head] ?? {}) as Record<string, unknown>;
  return { ...manifest, [head]: setField(nested, value, ...tail) };
}

export function ManifestEditor({ manifest, onChange }: ManifestEditorProps) {
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [jsonText, setJsonText] = useState(() => JSON.stringify(manifest, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  const handleSwitchToJson = () => {
    setJsonText(JSON.stringify(manifest, null, 2));
    setJsonError(null);
    setMode('json');
  };

  const handleSwitchToForm = () => {
    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      onChange(parsed);
      setJsonError(null);
      setMode('form');
    } catch {
      setJsonError('Invalid JSON — fix errors before switching to form view.');
    }
  };

  const handleJsonChange = (text: string) => {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      onChange(parsed);
      setJsonError(null);
    } catch {
      setJsonError('Invalid JSON');
    }
  };

  const set = useCallback(
    (value: unknown, ...path: string[]) => {
      onChange(setField(manifest, value, ...path));
    },
    [manifest, onChange],
  );

  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const bool = (v: unknown): boolean => v === true;

  const environments = (getField(manifest, ['compatibility', 'supported_environments']) ??
    []) as string[];

  function toggleEnvironment(env: string) {
    const next = environments.includes(env)
      ? environments.filter((e) => e !== env)
      : [...environments, env];
    set(next, 'compatibility', 'supported_environments');
  }

  return (
    <div className="space-y-4">
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={mode === 'form' ? handleSwitchToJson : handleSwitchToForm}
          className="text-sm text-[var(--accent-indigo)] hover:underline"
        >
          {mode === 'form' ? 'Switch to JSON view' : 'Switch to form view'}
        </button>
        {mode === 'json' && jsonError && (
          <span className="text-xs text-[var(--accent-rose)]">{jsonError}</span>
        )}
      </div>

      {mode === 'json' ? (
        <textarea
          value={jsonText}
          onChange={(e) => handleJsonChange(e.target.value)}
          rows={20}
          spellCheck={false}
          className="w-full rounded-md border border-[var(--border-bright)] bg-[var(--bg-tertiary)] px-3 py-2 font-mono text-xs placeholder-[var(--text-muted)] focus:border-[var(--accent-indigo)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-indigo)]"
          placeholder="{}"
        />
      ) : (
        <div className="space-y-6">
          {/* Identity */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
              Identity
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">
                  Kind
                </label>
                <select
                  value={str(getField(manifest, ['package', 'kind']))}
                  onChange={(e) => set(e.target.value, 'package', 'kind')}
                  className="w-full rounded-md border border-[var(--border-bright)] px-3 py-2 text-sm focus:border-[var(--accent-indigo)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-indigo)]"
                >
                  <option value="">Select kind…</option>
                  {ASSET_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">Title</label>
                <input
                  type="text"
                  value={str(getField(manifest, ['package', 'title']))}
                  onChange={(e) => set(e.target.value, 'package', 'title')}
                  placeholder="My Asset"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">Summary</label>
                <input
                  type="text"
                  value={str(getField(manifest, ['package', 'summary']))}
                  onChange={(e) => set(e.target.value, 'package', 'summary')}
                  placeholder="One-line description"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">Version</label>
                <input
                  type="text"
                  value={str(getField(manifest, ['package', 'version']))}
                  onChange={(e) => set(e.target.value, 'package', 'version')}
                  placeholder="1.0.0"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">License</label>
                <input
                  type="text"
                  value={str(getField(manifest, ['package', 'license']))}
                  onChange={(e) => set(e.target.value, 'package', 'license')}
                  placeholder="MIT"
                  className={inputCls}
                />
              </div>
            </div>
          </section>

          {/* Compatibility */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
              Compatibility
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">
                  Runtime Range
                </label>
                <input
                  type="text"
                  value={str(getField(manifest, ['compatibility', 'runtime_range']))}
                  onChange={(e) => set(e.target.value, 'compatibility', 'runtime_range')}
                  placeholder=">=0.1.0"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--text-secondary)]">
                  Supported Environments
                </label>
                <div className="flex flex-wrap gap-3">
                  {ENVIRONMENTS.map((env) => (
                    <label key={env} className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)]">
                      <input
                        type="checkbox"
                        checked={environments.includes(env)}
                        onChange={() => toggleEnvironment(env)}
                        className="rounded border-[var(--border-bright)]"
                      />
                      {env}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Permissions */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
              Permissions
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">Risk Class</label>
                <select
                  value={str(getField(manifest, ['permissions', 'risk_class']))}
                  onChange={(e) => set(e.target.value, 'permissions', 'risk_class')}
                  className="w-full rounded-md border border-[var(--border-bright)] px-3 py-2 text-sm focus:border-[var(--accent-indigo)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-indigo)]"
                >
                  <option value="">Select risk class…</option>
                  {RISK_CLASSES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">
                  Filesystem Scope
                </label>
                <select
                  value={str(getField(manifest, ['permissions', 'filesystem_scope']))}
                  onChange={(e) => set(e.target.value, 'permissions', 'filesystem_scope')}
                  className="w-full rounded-md border border-[var(--border-bright)] px-3 py-2 text-sm focus:border-[var(--accent-indigo)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-indigo)]"
                >
                  <option value="">Select scope…</option>
                  {FILESYSTEM_SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">
                  Network Scope
                </label>
                <select
                  value={str(getField(manifest, ['permissions', 'network_scope']))}
                  onChange={(e) => set(e.target.value, 'permissions', 'network_scope')}
                  className="w-full rounded-md border border-[var(--border-bright)] px-3 py-2 text-sm focus:border-[var(--accent-indigo)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-indigo)]"
                >
                  <option value="">Select scope…</option>
                  {NETWORK_SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={bool(getField(manifest, ['permissions', 'declares_secrets']))}
                  onChange={(e) => set(e.target.checked, 'permissions', 'declares_secrets')}
                  className="rounded border-[var(--border-bright)]"
                />
                Declares secrets (requires secret bindings after install)
              </label>
            </div>
          </section>

          {/* Distribution */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
              Distribution
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">Source URL</label>
                <input
                  type="text"
                  value={str(getField(manifest, ['distribution', 'source_url']))}
                  onChange={(e) => set(e.target.value, 'distribution', 'source_url')}
                  placeholder="https://github.com/…"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--text-secondary)]">
                  Package SHA-256
                </label>
                <input
                  type="text"
                  value={str(getField(manifest, ['integrity', 'package_sha256']))}
                  onChange={(e) => set(e.target.value, 'integrity', 'package_sha256')}
                  placeholder="sha256 hex string"
                  className="w-full rounded-md border border-[var(--border-bright)] px-3 py-2 font-mono text-xs placeholder-[var(--text-muted)] focus:border-[var(--accent-indigo)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-indigo)]"
                />
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
