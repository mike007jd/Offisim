import type { LlmGateway, LlmRequest, LlmResponse, LlmStreamChunk } from '../llm/gateway.js';
import { canonicalJson } from './canonical-json.js';
import { sha256Text } from './hash.js';

export interface ReplayFixture {
  readonly key: string;
  readonly response: LlmResponse;
}

export interface ReplayRequestHashes {
  readonly promptHash: string;
  readonly toolsHash: string;
}

export class ReplayGateway implements LlmGateway {
  readonly requests: LlmRequest[] = [];

  constructor(private readonly fixtures: ReadonlyMap<string, LlmResponse>) {}

  async chat(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const key = await fixtureKey(request);
    const fixture = this.fixtures.get(key);
    if (!fixture) throw new Error(`Replay fixture not found for ${key}`);
    return fixture;
  }

  async *chatStream(request: LlmRequest): AsyncIterable<LlmStreamChunk> {
    const response = await this.chat(request);
    if (response.content) yield { content: response.content, done: false };
    if (response.reasoningContent) yield { reasoning: response.reasoningContent, done: false };
    yield { done: true, toolCalls: response.toolCalls, usage: response.usage };
  }

  dispose(): void {}
}

export async function fixtureKey(request: LlmRequest): Promise<string> {
  return fixtureKeyFromHashes(await replayRequestHashes(request));
}

export async function replayRequestHashes(request: LlmRequest): Promise<ReplayRequestHashes> {
  const redacted = replayRequestInput(request);
  return {
    promptHash: await sha256Text(canonicalJson(redacted.messages)),
    toolsHash: await sha256Text(canonicalJson(redacted.tools ?? [])),
  };
}

export function fixtureKeyFromHashes(hashes: ReplayRequestHashes): string {
  return `${hashes.promptHash}@${hashes.toolsHash}`;
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
