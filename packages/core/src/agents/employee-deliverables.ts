import { recordedLlmCall } from '../llm/recorded-call.js';
import type { EmployeeRow } from '../runtime/repositories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { isNewDeliverableRequest } from './deliverable-intent.js';
import { inferDeliverableFile } from './infer-deliverable-file.js';

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

export interface MaterializedEmployeeDeliverable {
  kind: 'document' | 'file';
  fileName: string | null;
  mimeType: string | null;
  artifactContent: string;
}

function buildInferredArtifact(
  taskDescription: string,
  content: string,
): MaterializedEmployeeDeliverable | null {
  const inferred = inferDeliverableFile(taskDescription, content);
  if (!inferred) return null;

  return {
    kind: 'file',
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

export async function materializeFileDeliverableIfNeeded(
  runtimeCtx: RuntimeContext,
  taskDescription: string,
  employee: EmployeeRow,
  response: DeliverableResponse,
  request: DeliverableRepairRequest,
  taskRunId?: string,
  projectId?: string | null,
): Promise<MaterializedEmployeeDeliverable | null> {
  if (!isNewDeliverableRequest(taskDescription)) return null;
  const primaryArtifact = buildInferredArtifact(taskDescription, response.content);
  if (primaryArtifact) return primaryArtifact;
  if (/\b(document|doc)\b/i.test(taskDescription) || /(文档|产物)/.test(taskDescription)) {
    return {
      kind: 'document',
      fileName: null,
      mimeType: null,
      artifactContent: response.content,
    };
  }

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
      projectId,
      employeeId: employee.employee_id,
    },
  );

  return buildInferredArtifact(taskDescription, repaired.content);
}
