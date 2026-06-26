import { Button } from '@/design-system/primitives/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/design-system/primitives/dropdown-menu.js';
import { Icon } from '@/design-system/icons/Icon.js';
import type { LoopCompileQuestion } from '@offisim/shared-types';
import { Check, ChevronDown, MessageCircleQuestion, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';

/**
 * Inline clarifying-question cards (PR-08) — the `needs_input` authoring state.
 * At most THREE (the compiler caps it), each pre-filled with the recommended
 * default and a one-click "Use defaults". The user can tweak an answer inline,
 * then Accept → recompile. This is NOT a criteria/evaluator form: the answers are
 * fed back as plain text the compiler resolves.
 */

interface LoopQuestionCardsProps {
  questions: LoopCompileQuestion[];
  busy: boolean;
  onAccept: (answers: Record<string, string>) => void;
}

export function LoopQuestionCards({ questions, busy, onAccept }: LoopQuestionCardsProps) {
  const defaults = useMemo(
    () => Object.fromEntries(questions.map((q) => [q.id, q.recommendedDefault])),
    [questions],
  );
  const [answers, setAnswers] = useState<Record<string, string>>(defaults);

  // Cap defensively at 3 even if the compiler ever over-produced.
  const shown = questions.slice(0, 3);

  return (
    <div className="off-loop-questions" role="group" aria-label="Clarifying questions">
      <div className="off-loop-questions-head">
        <Icon icon={MessageCircleQuestion} size="sm" />
        <span>A few quick questions to finish this Loop</span>
      </div>
      <ul className="off-loop-questions-list">
        {shown.map((q) => (
          <li key={q.id} className="off-loop-question">
            <span className="off-loop-question-text">{q.question}</span>
            {q.options && q.options.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="off-loop-question-input">
                    {answers[q.id] ?? q.recommendedDefault}
                    <Icon icon={ChevronDown} size="sm" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuRadioGroup
                    value={answers[q.id] ?? q.recommendedDefault}
                    onValueChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
                  >
                    {q.options.map((opt) => (
                      <DropdownMenuRadioItem key={opt} value={opt}>
                        {opt}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <input
                className="off-input off-loop-question-input"
                value={answers[q.id] ?? q.recommendedDefault}
                onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                aria-label={q.question}
              />
            )}
            <span className="off-loop-question-default">
              Recommended: {q.recommendedDefault}
            </span>
          </li>
        ))}
      </ul>
      <div className="off-loop-questions-actions">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => onAccept(defaults)}
        >
          <Icon icon={Wand2} size="sm" />
          Use defaults
        </Button>
        <Button size="sm" disabled={busy} onClick={() => onAccept(answers)}>
          <Icon icon={Check} size="sm" />
          Apply answers
        </Button>
      </div>
    </div>
  );
}
