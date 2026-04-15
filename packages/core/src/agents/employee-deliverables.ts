import { recordedLlmCall } from '../llm/recorded-call.js';
import type { EmployeeRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { inferDeliverableFile } from './infer-deliverable-file.js';

const FILE_DELIVERABLE_REQUEST_RE =
  /\b(single[- ]file|file|html|css|javascript|typescript|json|markdown|csv|yaml|yml|xml|download|artifact|open it directly|full file contents|code block)\b/i;
const ARTIFACT_REPAIR_PROMPT = `You are converting a draft response into a real user-takeaway file artifact.

Rules:
- If the task asks for a single file or code artifact, output the complete file body.
- Output exactly one filename line in the form: Filename: <name>
- Then output exactly one fenced code block with the full file contents.
- No bullets, no summary, no explanation outside the filename line and code block.
- Do not describe the file. Provide the actual file contents.`;

interface DeliverableRepairRequest {
  model: string;
  provider: string;
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
}

interface DeliverableResponse {
  content: string;
}

function buildInferredArtifact(
  taskDescription: string,
  content: string,
):
  | {
      fileName: string | null;
      mimeType: string | null;
      artifactContent: string;
    }
  | null {
  const inferred = inferDeliverableFile(taskDescription, content);
  if (!inferred) return null;

  return {
    fileName: inferred.fileName ?? null,
    mimeType: inferred.mimeType ?? null,
    artifactContent: content,
  };
}

export function buildEmployeeDeliverableTitle(
  taskDescription: string,
  fileName: string | null,
): string {
  if (fileName) return fileName;
  const trimmed = taskDescription.trim();
  if (!trimmed) return 'Deliverable';
  return trimmed.replace(/\s+/g, ' ').slice(0, 80);
}

function taskNeedsFileDeliverable(taskDescription: string): boolean {
  return FILE_DELIVERABLE_REQUEST_RE.test(taskDescription);
}

export async function materializeFileDeliverableIfNeeded(
  runtimeCtx: RuntimeContext,
  taskDescription: string,
  employee: EmployeeRow,
  response: DeliverableResponse,
  request: DeliverableRepairRequest,
  taskRunId?: string,
): Promise<
  | {
      fileName: string | null;
      mimeType: string | null;
      artifactContent: string;
    }
  | null
> {
  const primaryArtifact = buildInferredArtifact(taskDescription, response.content);
  if (primaryArtifact) return primaryArtifact;
  if (!taskNeedsFileDeliverable(taskDescription)) return null;

  const repaired = await recordedLlmCall(
    runtimeCtx,
    {
      messages: [
        { role: 'system', content: ARTIFACT_REPAIR_PROMPT },
        {
          role: 'user',
          content: `Task:\n${taskDescription}\n\nDraft response from ${employee.name}:\n${response.content}`,
        },
      ],
      model: request.model,
      temperature: 0.2,
      maxTokens: request.maxTokens,
      signal: request.signal,
    },
    {
      nodeName: 'employee',
      provider: request.provider,
      model: request.model,
      taskRunId,
    },
  );

  return buildInferredArtifact(taskDescription, repaired.content);
}
