import { Badge } from '@offisim/ui-core';
import type { EmployeeFormData } from '../../../hooks/useEmployeeEditor';

/** Role slug to human-readable label map. */
const ROLE_LABELS: Record<string, string> = {
  pm: 'Product Manager',
  developer: 'Developer',
  designer: 'Designer',
  qa: 'QA Engineer',
  devops: 'DevOps Engineer',
  analyst: 'Analyst',
  engineering_manager: 'Engineering Manager',
};

interface PreviewStepProps {
  formData: EmployeeFormData;
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-pixel-mono uppercase tracking-wider text-shell">{label}</span>
      <div className="text-sm text-sand">{children}</div>
    </div>
  );
}

export function PreviewStep({ formData }: PreviewStepProps) {
  return (
    <div className="flex flex-col gap-4 border-2 border-ocean-light bg-ocean-mid/50 p-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-lobster-red/20 border-2 border-lobster-red flex items-center justify-center">
          <span className="text-lg font-pixel-mono font-bold text-lobster-red">
            {formData.name.charAt(0).toUpperCase() || '?'}
          </span>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-pearl">{formData.name || 'Unnamed'}</h3>
          <Badge variant="info">{ROLE_LABELS[formData.role_slug] ?? formData.role_slug}</Badge>
        </div>
      </div>

      <div className="h-px bg-ocean-light" />

      {/* Sections */}
      <Section label="Expertise">
        {formData.expertise || <span className="text-shell italic">Not specified</span>}
      </Section>

      <Section label="Working Style">
        {formData.style || <span className="text-shell italic">Not specified</span>}
      </Section>

      {formData.customInstructions && (
        <Section label="Custom Instructions">
          <p className="whitespace-pre-wrap">{formData.customInstructions}</p>
        </Section>
      )}

      <Section label="Model Config">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{formData.modelPreference || '跟随统一设置'}</Badge>
          <Badge variant="secondary">Temp: {formData.temperature.toFixed(1)}</Badge>
          <Badge variant="secondary">Max Tokens: {formData.maxTokens.toLocaleString()}</Badge>
        </div>
      </Section>
    </div>
  );
}
