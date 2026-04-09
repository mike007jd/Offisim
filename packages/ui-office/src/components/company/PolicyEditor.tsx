import { FieldLabel, surfaceInputClassName } from './company-editor-primitives';

export interface CompanyPolicy {
  defaultModel: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
}

const DEFAULT_POLICY: CompanyPolicy = {
  defaultModel: '',
  defaultTemperature: 0.7,
  defaultMaxTokens: 4096,
};

export { DEFAULT_POLICY as DEFAULT_COMPANY_POLICY };

interface PolicyEditorProps {
  policy: CompanyPolicy;
  onChange: (policy: CompanyPolicy) => void;
}

export function PolicyEditor({ policy, onChange }: PolicyEditorProps) {
  function update<K extends keyof CompanyPolicy>(key: K, value: CompanyPolicy[K]) {
    onChange({ ...policy, [key]: value });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-6 text-slate-400">
        These defaults apply to newly created employees only.
      </p>

      {/* Default model */}
      <div>
        <FieldLabel htmlFor="policy-default-model">Default Model Profile</FieldLabel>
        <input
          id="policy-default-model"
          type="text"
          value={policy.defaultModel}
          onChange={(e) => update('defaultModel', e.target.value)}
          placeholder="e.g. gemini-2.0-flash-exp"
          className={surfaceInputClassName('placeholder:text-slate-500')}
        />
      </div>

      {/* Default temperature */}
      <div>
        <FieldLabel htmlFor="policy-temperature">
          Default Temperature{' '}
          <span className="text-slate-500">({policy.defaultTemperature.toFixed(2)})</span>
        </FieldLabel>
        <div className="flex items-center gap-3">
          <input
            id="policy-temperature"
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={policy.defaultTemperature}
            onChange={(e) => update('defaultTemperature', Number.parseFloat(e.target.value))}
            className="flex-1 accent-cyan-400"
          />
          <input
            type="number"
            min={0}
            max={2}
            step={0.05}
            value={policy.defaultTemperature}
            onChange={(e) => {
              const v = Number.parseFloat(e.target.value);
              if (!Number.isNaN(v)) update('defaultTemperature', Math.min(2, Math.max(0, v)));
            }}
            className="h-11 w-24 rounded-2xl border border-white/10 bg-slate-950/70 px-2 text-center text-sm text-white outline-none focus:border-cyan-300/40"
            aria-label="Temperature value"
          />
        </div>
        <div className="mt-1 flex justify-between text-xs text-slate-500">
          <span>0.0 (precise)</span>
          <span>2.0 (creative)</span>
        </div>
      </div>

      {/* Default max tokens */}
      <div>
        <FieldLabel htmlFor="policy-max-tokens">Default Max Tokens</FieldLabel>
        <input
          id="policy-max-tokens"
          type="number"
          min={256}
          max={131072}
          step={256}
          value={policy.defaultMaxTokens}
          onChange={(e) => {
            const v = Number.parseInt(e.target.value, 10);
            if (!Number.isNaN(v) && v > 0) update('defaultMaxTokens', v);
          }}
          className={surfaceInputClassName()}
        />
        <p className="mt-1 text-xs text-slate-500">Recommended: 2048 – 16384</p>
      </div>
    </div>
  );
}
