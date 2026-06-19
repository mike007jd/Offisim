import { Markdown } from '@/design-system/grammar/Markdown.js';
import { MessagePartPrimitive, MessagePrimitive } from '@assistant-ui/react';
import { ReasoningPart } from './ReasoningPart.js';
import { ToolCallPart, toolCallPartView } from './ToolCallPart.js';

/**
 * The shared assistant-ui content-part switch for both chat surfaces (the Office
 * rail and the Workspace messenger): reasoning peek → inline tool-call chips →
 * Markdown answer with a streaming cursor. Both surfaces project their message
 * onto the same `{reasoning, tool-call, text}` parts (via `assembleAssistantContent`),
 * so the render belongs in one place. `reasoningStreaming` is the per-message
 * think-first flag (`isReasoningStreaming`) the caller computes.
 */
export function AssistantMessageParts({ reasoningStreaming }: { reasoningStreaming: boolean }) {
  return (
    <MessagePrimitive.Parts>
      {({ part }) => {
        if (part.type === 'reasoning') {
          return <ReasoningPart text={part.text} streaming={reasoningStreaming} />;
        }
        if (part.type === 'tool-call') {
          const view = toolCallPartView(part.result);
          return (
            <ToolCallPart name={part.toolName} status={view.status} durationMs={view.durationMs} />
          );
        }
        return part.type === 'text' ? (
          <span className="off-msg-text">
            <Markdown>{part.text}</Markdown>
            <MessagePartPrimitive.InProgress>
              <span className="off-msg-cursor">|</span>
            </MessagePartPrimitive.InProgress>
          </span>
        ) : null;
      }}
    </MessagePrimitive.Parts>
  );
}
