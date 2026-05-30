import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlmGateway, LlmRequest, LlmResponse, LlmStreamChunk } from '../llm/gateway.js';
import { type ReplayRequestHashes, replayRequestHashes } from '../llm/replay-request-hashes.js';
import type { LlmCallRow } from '../runtime/repositories.js';

export { replayRequestHashes, type ReplayRequestHashes } from '../llm/replay-request-hashes.js';

export interface ReplayFixture {
  readonly key: string;
  readonly response: LlmResponse;
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
    yield {
      done: true,
      toolCalls: response.toolCalls,
      usage: response.usage,
      ...(response.stopReason ? { stopReason: response.stopReason } : {}),
    };
  }

  dispose(): void {}
}

export async function loadReplayFixturesFromDirectory(
  directory: string,
): Promise<Map<string, LlmResponse>> {
  const fixtures = new Map<string, LlmResponse>();
  const files = await readdir(directory).catch(() => []);
  for (const file of files.filter((candidate) => candidate.endsWith('.json')).sort()) {
    const raw = await readFile(join(directory, file), 'utf8');
    const parsed = JSON.parse(raw) as ReplayFixture;
    fixtures.set(parsed.key, parsed.response);
  }
  return fixtures;
}

export function replayFixturesFromLlmCalls(calls: readonly LlmCallRow[]): ReplayFixture[] {
  return calls.flatMap((call) => {
    if (!call.prompt_hash || !call.tools_hash || !call.response_json) return [];
    const response = JSON.parse(call.response_json) as LlmResponse;
    const key = fixtureKeyFromHashes({
      promptHash: call.prompt_hash,
      toolsHash: call.tools_hash,
    });
    return [{ key, response }];
  });
}

export async function writeReplayFixturesFromLlmCalls(
  calls: readonly LlmCallRow[],
  directory: string,
): Promise<ReplayFixture[]> {
  const fixtures = replayFixturesFromLlmCalls(calls);
  await mkdir(directory, { recursive: true });
  await Promise.all(
    fixtures.map((fixture) =>
      writeFile(
        join(directory, `${sanitizeFixtureKey(fixture.key)}.json`),
        `${JSON.stringify(fixture, null, 2)}\n`,
      ),
    ),
  );
  return fixtures;
}

export async function fixtureKey(request: LlmRequest): Promise<string> {
  return fixtureKeyFromHashes(await replayRequestHashes(request));
}

export function fixtureKeyFromHashes(hashes: ReplayRequestHashes): string {
  return `${hashes.promptHash}@${hashes.toolsHash}`;
}

function sanitizeFixtureKey(key: string): string {
  return key.replace(/^sha256:/u, '').replace(/@sha256:/u, '@');
}
