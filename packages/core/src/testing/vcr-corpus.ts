import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlmResponse } from '../llm/gateway.js';

export interface VcrFixtureKeyInput {
  readonly nodeName: string;
  readonly provider: string;
  readonly model: string;
  readonly promptHash: string;
  readonly toolsHash: string;
  readonly policyHash: string;
  readonly middlewareHash: string;
}

export interface VcrFixture {
  readonly key: string;
  readonly response: LlmResponse;
}

export function vcrFixtureKey(input: VcrFixtureKeyInput): string {
  return [
    input.nodeName,
    input.provider,
    input.model,
    `${input.promptHash}@${input.toolsHash}@${input.policyHash}@${input.middlewareHash}`,
  ].join('/');
}

export async function loadVcrFixtures(directory: string): Promise<Map<string, LlmResponse>> {
  const fixtures = new Map<string, LlmResponse>();
  const files = await readdir(directory).catch(() => []);
  for (const file of files.filter((candidate) => candidate.endsWith('.json')).sort()) {
    const parsed = JSON.parse(await readFile(join(directory, file), 'utf8')) as VcrFixture;
    fixtures.set(parsed.key, parsed.response);
  }
  return fixtures;
}

export async function writeVcrFixture(directory: string, fixture: VcrFixture): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${fixture.key.replace(/[/:@]/gu, '_')}.json`),
    `${JSON.stringify(fixture, null, 2)}\n`,
  );
}
