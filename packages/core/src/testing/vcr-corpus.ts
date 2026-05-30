import { join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import type { LlmResponse } from '../llm/gateway.js';

export interface VcrFixture {
  readonly key: string;
  readonly response: LlmResponse;
}

export async function loadVcrFixtures(directory: string): Promise<Map<string, LlmResponse>> {
  const fixtures = new Map<string, LlmResponse>();
  const files = await readdir(directory).catch(() => []);
  for (const file of files.filter((candidate) => candidate.endsWith('.json')).sort()) {
    let parsed: VcrFixture;
    try {
      parsed = JSON.parse(await readFile(join(directory, file), 'utf8')) as VcrFixture;
    } catch (error) {
      // Skip the offending file rather than aborting the whole corpus load.
      console.warn(`[vcr] skipping unreadable fixture ${file}: ${(error as Error).message}`);
      continue;
    }
    if (typeof parsed?.key !== 'string' || parsed.response == null) {
      console.warn(`[vcr] skipping malformed fixture ${file}: missing key/response`);
      continue;
    }
    fixtures.set(parsed.key, parsed.response);
  }
  return fixtures;
}
