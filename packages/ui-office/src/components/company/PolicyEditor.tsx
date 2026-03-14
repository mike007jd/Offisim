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
      <p className="text-xs text-gray-400 italic">
        These defaults apply to newly created employees only.
      </p>

      {/* Default model */}
      <div>
        <label
          htmlFor="policy-default-model"
          className="block text-sm text-gray-300 mb-1"
        >
          Default Model Profile
        </label>
        <input
          id="policy-default-model"
          type="text"
          value={policy.defaultModel}
          onChange={(e) => update('defaultModel', e.target.value)}
          placeholder="e.g. gemini-2.0-flash-exp"
          className="w-full rounded bg-gray-900 border border-gray-600 px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500 placeholder-gray-500"
        />
      </div>

      {/* Default temperature */}
      <div>
        <label
          htmlFor="policy-temperature"
          className="block text-sm text-gray-300 mb-1"
        >
          Default Temperature{' '}
          <span className="text-gray-400">({policy.defaultTemperature.toFixed(2)})</span>
        </label>
        <div className="flex items-center gap-3">
          <input
            id="policy-temperature"
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={policy.defaultTemperature}
            onChange={(e) => update('defaultTemperature', parseFloat(e.target.value))}
            className="flex-1 accent-blue-500"
          />
          <input
            type="number"
            min={0}
            max={2}
            step={0.05}
            value={policy.defaultTemperature}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (!Number.isNaN(v)) update('defaultTemperature', Math.min(2, Math.max(0, v)));
            }}
            className="w-20 rounded bg-gray-900 border border-gray-600 px-2 py-1 text-sm text-white text-center focus:outline-none focus:border-blue-500"
            aria-label="Temperature value"
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-0.5">
          <span>0.0 (precise)</span>
          <span>2.0 (creative)</span>
        </div>
      </div>

      {/* Default max tokens */}
      <div>
        <label
          htmlFor="policy-max-tokens"
          className="block text-sm text-gray-300 mb-1"
        >
          Default Max Tokens
        </label>
        <input
          id="policy-max-tokens"
          type="number"
          min={256}
          max={131072}
          step={256}
          value={policy.defaultMaxTokens}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!Number.isNaN(v) && v > 0) update('defaultMaxTokens', v);
          }}
          className="w-full rounded bg-gray-900 border border-gray-600 px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
        />
        <p className="text-xs text-gray-500 mt-0.5">Recommended: 2048 – 16384</p>
      </div>
    </div>
  );
}
