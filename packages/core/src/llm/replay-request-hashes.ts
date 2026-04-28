import { canonicalJson } from '../utils/canonical-json.js';
import { sha256Text } from '../utils/hash.js';
import type { LlmRequest } from './gateway.js';

export interface ReplayRequestHashes {
  readonly promptHash: string;
  readonly toolsHash: string;
}

export async function replayRequestHashes(request: LlmRequest): Promise<ReplayRequestHashes> {
  const redacted = replayRequestInput(request);
  return {
    promptHash: await sha256Text(canonicalJson(redacted.messages)),
    toolsHash: await sha256Text(canonicalJson(redacted.tools ?? [])),
  };
}

function replayRequestInput(request: LlmRequest): {
  readonly messages: LlmRequest['messages'];
  readonly tools?: LlmRequest['tools'];
} {
  return {
    messages: request.messages,
    ...(request.tools !== undefined ? { tools: request.tools } : {}),
  };
}
