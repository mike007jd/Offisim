import { Button, Textarea, cn } from '@offisim/ui-core';
import type { EmployeeFormData } from '../../../hooks/useEmployeeEditor';

/** Suggested expertise tags by role. */
const EXPERTISE_SUGGESTIONS: Record<string, string[]> = {
  pm: [
    'Product Strategy',
    'User Research',
    'Agile/Scrum',
    'Data Analysis',
    'Roadmapping',
    'Stakeholder Management',
  ],
  developer: [
    'React',
    'TypeScript',
    'Node.js',
    'Python',
    'System Design',
    'API Design',
    'Database',
    'DevOps',
  ],
  designer: [
    'UI Design',
    'UX Research',
    'Figma',
    'Design Systems',
    'Prototyping',
    'Accessibility',
    'Motion Design',
  ],
  qa: [
    'Test Automation',
    'Manual Testing',
    'Performance Testing',
    'Security Testing',
    'CI/CD',
    'API Testing',
  ],
  devops: [
    'Kubernetes',
    'Docker',
    'AWS',
    'CI/CD',
    'Terraform',
    'Monitoring',
    'Linux',
    'Networking',
  ],
  analyst: [
    'SQL',
    'Python',
    'Data Visualization',
    'Statistical Analysis',
    'Machine Learning',
    'Business Intelligence',
  ],
  engineering_manager: [
    'Team Leadership',
    'Agile',
    'Technical Architecture',
    'Mentoring',
    'Hiring',
    'Conflict Resolution',
  ],
};

interface ExpertiseStepProps {
  formData: EmployeeFormData;
  updateField: <K extends keyof EmployeeFormData>(key: K, value: EmployeeFormData[K]) => void;
}

export function ExpertiseStep({ formData, updateField }: ExpertiseStepProps) {
  const suggestions =
    EXPERTISE_SUGGESTIONS[formData.role_slug] ?? EXPERTISE_SUGGESTIONS.developer ?? [];

  const addTag = (tag: string) => {
    const current = formData.expertise.trim();
    // Don't add if already present (case-insensitive)
    if (current.toLowerCase().includes(tag.toLowerCase())) return;
    const separator = current ? ', ' : '';
    updateField('expertise', current + separator + tag);
  };

  return (
    <div className="flex flex-col gap-4">
      <Textarea
        value={formData.expertise}
        onChange={(e) => updateField('expertise', e.target.value)}
        placeholder="e.g. React, TypeScript, System Design..."
        rows={4}
      />

      <div>
        <p className="mb-2 text-xs text-text-secondary">Click to add suggested skills:</p>
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((tag) => {
            const isActive = formData.expertise.toLowerCase().includes(tag.toLowerCase());
            return (
              <Button
                key={tag}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addTag(tag)}
                disabled={isActive}
                className={cn(
                  'h-7 border-2 px-2 py-0.5 text-xs',
                  isActive
                    ? 'border-success bg-success-muted text-success'
                    : 'border-border-default bg-surface-muted text-text-secondary hover:border-border-focus hover:text-accent-text',
                )}
              >
                {tag}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
