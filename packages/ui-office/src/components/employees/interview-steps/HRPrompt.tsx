import type { WizardStep } from '../../../hooks/useInterviewWizard';

/** HR question text for each wizard step. */
const HR_QUESTIONS: Record<WizardStep, string> = {
  role: "Welcome! Let's start by picking a role for your new team member. What position are we hiring for?",
  name: 'Great choice! Every team member needs a name. What should we call them?',
  expertise: 'What specific skills or expertise areas does this person bring to the team?',
  style:
    'How would you describe their working style? This helps set the tone for their collaboration.',
  appearance:
    "Let's customize how your new team member looks! This is optional — feel free to skip.",
  instructions:
    'Any special instructions or behavioral guidelines? This is optional — feel free to skip.',
  model: 'Would you like to configure the AI model settings, or use our sensible defaults?',
  preview: "Here's a summary of your new hire. Review everything and create when you're ready!",
};

interface HRPromptProps {
  step: WizardStep;
}

export function HRPrompt({ step }: HRPromptProps) {
  return (
    <div className="flex items-start gap-3">
      {/* HR Avatar */}
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 border-border-focus bg-accent-muted">
        <span className="font-mono text-xs font-bold text-accent-text">HR</span>
      </div>

      {/* Speech Bubble */}
      <div className="relative flex-1 border-2 border-border-default bg-surface-muted p-3">
        {/* Bubble arrow */}
        <div className="absolute left-[-8px] top-3 h-0 w-0 border-b-[6px] border-r-[8px] border-t-[6px] border-b-transparent border-r-border-default border-t-transparent" />
        <div className="absolute left-[-5px] top-3 h-0 w-0 border-b-[6px] border-r-[8px] border-t-[6px] border-b-transparent border-r-surface-muted border-t-transparent" />
        <p className="text-sm leading-relaxed text-text-primary">{HR_QUESTIONS[step]}</p>
      </div>
    </div>
  );
}
