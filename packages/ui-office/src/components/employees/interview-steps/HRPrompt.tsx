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
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-500/30 border-2 border-blue-500 flex items-center justify-center">
        <span className="text-xs font-mono font-bold text-blue-500">HR</span>
      </div>

      {/* Speech Bubble */}
      <div className="relative bg-slate-800 border-2 border-slate-700 p-3 flex-1">
        {/* Bubble arrow */}
        <div className="absolute left-[-8px] top-3 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-r-[8px] border-r-slate-700" />
        <div className="absolute left-[-5px] top-3 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-r-[8px] border-r-slate-800" />
        <p className="text-sm text-slate-100 leading-relaxed">{HR_QUESTIONS[step]}</p>
      </div>
    </div>
  );
}
