import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGithubTarballRequest } from './github-tarball.ts';

test('buildGithubTarballRequest uses direct GitHub API when no proxy origin is provided', () => {
  const result = buildGithubTarballRequest('anthropics', 'skills');

  assert.equal(result.url, 'https://api.github.com/repos/anthropics/skills/tarball');
  assert.deepEqual(result.init, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Offisim-Skill-Installer',
    },
  });
});

test('buildGithubTarballRequest encodes refs on the direct GitHub API path', () => {
  const result = buildGithubTarballRequest('anthropics', 'skills', 'feature/skill install');

  assert.equal(
    result.url,
    'https://api.github.com/repos/anthropics/skills/tarball/feature%2Fskill%20install',
  );
});

test('buildGithubTarballRequest routes through the dev proxy when a proxy origin is provided', () => {
  const result = buildGithubTarballRequest('anthropics', 'skills', undefined, {
    proxyOrigin: 'http://localhost:5176',
  });

  assert.equal(result.url, 'http://localhost:5176/api/llm-proxy/repos/anthropics/skills/tarball');
  assert.deepEqual(result.init, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Offisim-Skill-Installer',
      'X-LLM-Base-URL': 'https://api.github.com',
    },
  });
});
