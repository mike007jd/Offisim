import { Markdown } from '@/design-system/grammar/Markdown.js';
import { cn } from '@/lib/utils.js';
import { ChevronRight } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Renders an assistant `reasoning` content part as a live think-first stage,
 * following assistant-ui's native reasoning UX (the pattern its shadcn registry
 * `reasoning.tsx` ships, which is `() => null` in the npm runtime): while the
 * model is reasoning the panel auto-expands into a bounded, bottom-pinned peek
 * window — you watch the thinking stream without it ever becoming a wall of
 * text — and the instant the model moves on (a tool or the answer begins) it
 * auto-collapses to a one-line "Thought for Xs" summary. Open follows
 * `userOpen ?? streaming`, so the first manual toggle takes over for good.
 *
 * Driven by our own `streaming` signal (`isReasoningStreaming`) rather than the
 * assistant-ui part `status`, because the part status does not propagate
 * reliably through the external-store runtime; Pi's reasoning-before-content
 * ordering makes the two equivalent.
 */
export function ReasoningPart({ text, streaming }: { text: string; streaming: boolean }) {
  // `null` = follow the auto (streaming) state; once the user clicks, their
  // explicit choice sticks for the rest of the message's life.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? streaming;

  // "Thought for Xs": time from the first streaming frame to the think→done
  // flip. A message that mounts already-done (history) keeps no duration and
  // just reads "Reasoning".
  const startRef = useRef<number | null>(null);
  const prevStreaming = useRef(streaming);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  if (streaming && startRef.current === null) startRef.current = performance.now();
  useEffect(() => {
    if (prevStreaming.current && !streaming && startRef.current !== null) {
      setDurationSec(Math.max(1, Math.round((performance.now() - startRef.current) / 1000)));
    }
    prevStreaming.current = streaming;
  }, [streaming]);

  // Pin the peek to the bottom while streaming so the newest thought is always
  // in view (the tail is the "current" thinking).
  const scrollRef = useRef<HTMLDivElement>(null);
  // `text` is the trigger (re-pin on every streamed chunk), not read in the body.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-pin per chunk
  useLayoutEffect(() => {
    if (open && streaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [text, open, streaming]);

  if (!text.trim()) return null;
  const label = streaming ? 'Thinking…' : durationSec ? `Thought for ${durationSec}s` : 'Reasoning';

  return (
    <div className={cn('off-reasoning', streaming && 'is-streaming', open && 'is-open')}>
      <button
        type="button"
        className="off-reasoning-trigger off-focusable"
        aria-expanded={open}
        onClick={() => setUserOpen(!open)}
      >
        <ChevronRight className="off-reasoning-caret" aria-hidden size={13} />
        <span className="off-reasoning-label">{label}</span>
      </button>
      {open ? (
        <div ref={scrollRef} className="off-reasoning-scroll">
          <Markdown>{text}</Markdown>
        </div>
      ) : null}
    </div>
  );
}
