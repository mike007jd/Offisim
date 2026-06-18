import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const rootPackage = readJson('package.json');
const desktopPackage = readJson('apps/desktop/package.json');
const tauriConfig = readJson('apps/desktop/src-tauri/tauri.conf.json');

assert(
  rootPackage.scripts['build:pi-agent-host'] === 'node scripts/build-pi-agent-host.mjs',
  'root package must build the Pi Agent host',
);
assert(!('provider:check' in rootPackage.scripts), 'provider:check must not be a validation gate');
assert(
  rootPackage.scripts.validate.includes('pnpm harness:pi-agent-host'),
  'validate must include the Pi Agent host harness',
);
assert(
  rootPackage.scripts['check:pi-wire-contract'] === 'node scripts/check-pi-wire-contract.mjs',
  'root package must run the Pi Agent wire-contract gate',
);
assert(
  rootPackage.scripts.validate.includes('pnpm check:pi-wire-contract'),
  'validate must include the Pi Agent wire-contract gate',
);
assert(
  desktopPackage.scripts['build:frontend'].includes('build:pi-agent-host'),
  'desktop build must bundle the Pi Agent host',
);
assert(
  !desktopPackage.scripts['build:frontend'].includes('build:claude-agent-host') &&
    !desktopPackage.scripts['build:frontend'].includes('build:codex-agent-host'),
  'desktop build must not bundle Claude/Codex sidecars',
);
assert(
  tauriConfig.bundle.resources.includes('resources/pi-agent-host.mjs'),
  'release bundle must include the Pi Agent host',
);
assert(
  !tauriConfig.bundle.resources.some((resource) => /claude|codex/u.test(resource)),
  'release bundle must not include Claude/Codex sidecar resources',
);

const tempAgentDir = mkdtempSync(join(tmpdir(), 'offisim-pi-agent-host-'));
writeFileSync(
  join(tempAgentDir, 'models.json'),
  `{
    // Pi models.json accepts JSONC comments and trailing commas.
    "providers": {
      "local-test": {
        "baseUrl": "http://127.0.0.1:11434/v1",
        "api": "openai-completions",
        "apiKey": "test",
        "models": [{ "id": "fixture-model" }],
        "modelOverrides": {
          "builtin-model": { "name": "Fixture override" },
        },
      },
    },
  }`,
);

let result;
try {
  const status = spawnSync(process.execPath, ['scripts/tauri-pi-agent-host.entry.mjs'], {
    input: JSON.stringify({ mode: 'status', agentDir: tempAgentDir }),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  assert(status.status === 0, `Pi Agent status host failed: ${status.stderr || status.stdout}`);
  const resultLine = status.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => JSON.parse(line).kind === 'result');
  assert(resultLine, 'Pi Agent status host did not emit a result line');
  result = JSON.parse(resultLine);
  assert(result.response?.ok === true, 'Pi Agent status response must be ok');
  assert(
    Array.isArray(result.response.availableModels),
    'Pi Agent status response must include availableModels from Pi ModelRegistry',
  );
  assert(
    result.response.paths?.modelsPath,
    'Pi Agent status response must expose Pi models.json path',
  );
  assert(
    result.response.modelsConfig?.exists === true &&
      result.response.modelsConfig.providerCount === 1 &&
      result.response.modelsConfig.modelCount === 1 &&
      result.response.modelsConfig.overrideCount === 1 &&
      !result.response.modelsConfig.parseError,
    'Pi Agent status response must expose a safe JSONC models.json configuration summary',
  );
} finally {
  rmSync(tempAgentDir, { recursive: true, force: true });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      host: 'pi-agent',
      availableModels: result.response.availableModels.length,
      allModelCount: result.response.allModelCount,
      modelsConfig: result.response.modelsConfig,
    },
    null,
    2,
  ),
);
