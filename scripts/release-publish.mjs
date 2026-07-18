#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const filePath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(filePath), '..');
const identity = 'Developer ID Application: Haosheng Li (9MP925J67C)';
const notaryProfile = 'offisim-notary';
const repository = 'mike007jd/Offisim';
const target = 'aarch64-apple-darwin';
const appPath = path.join(
  root,
  'apps/desktop/src-tauri/target',
  target,
  'release/bundle/macos/Offisim.app',
);

function parseArgs(argv) {
  const result = {
    allowDirty: false,
    draft: false,
    evidenceDir: null,
    notesFile: null,
    releaseTarget: 'feat/r2-distribution-readiness',
    skipBuild: false,
    skipGates: false,
    tag: null,
    title: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--allow-dirty') result.allowDirty = true;
    else if (arg === '--draft') result.draft = true;
    else if (arg === '--skip-build') result.skipBuild = true;
    else if (arg === '--skip-gates') result.skipGates = true;
    else if (arg === '--evidence-dir') result.evidenceDir = argv[++index];
    else if (arg === '--notes-file') result.notesFile = argv[++index];
    else if (arg === '--target') result.releaseTarget = argv[++index];
    else if (arg === '--tag') result.tag = argv[++index];
    else if (arg === '--title') result.title = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return result;
}

function credentialFreeEnv() {
  const env = { ...process.env, APPLE_SIGNING_IDENTITY: identity };
  for (const key of Object.keys(env)) {
    if (
      /APPLE_(?:ID|PASSWORD|APP_SPECIFIC_PASSWORD|API_KEY|API_ISSUER)|GH_TOKEN|GITHUB_TOKEN/iu.test(
        key,
      )
    ) {
      delete env[key];
    }
  }
  return env;
}

const env = credentialFreeEnv();

function run(command, args, { label = path.basename(command), forward = false, cwd = root } = {}) {
  console.log(`[release] ${label}`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (forward) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed with status ${result.status ?? 'unknown'}`);
  }
  return result;
}

function assertTool(pathname) {
  if (!existsSync(pathname)) throw new Error(`required tool is missing: ${pathname}`);
}

function assertRegularFile(pathname, label) {
  const metadata = lstatSync(pathname);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0) {
    throw new Error(`${label} must be a non-empty regular file`);
  }
}

function assertApp(pathname) {
  const metadata = lstatSync(pathname);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Offisim.app must be a real directory');
  }
  assertRegularFile(path.join(pathname, 'Contents/Info.plist'), 'Offisim Info.plist');
}

function sha256(pathname) {
  return createHash('sha256').update(readFileSync(pathname)).digest('hex');
}

function safeVersion() {
  const config = JSON.parse(
    readFileSync(path.join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
  );
  const version = String(config.version ?? '');
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error('tauri.conf.json version is not release-safe SemVer');
  }
  return version;
}

function assertPrerequisites(options) {
  if (process.platform !== 'darwin') throw new Error('macOS release publishing requires macOS');
  for (const tool of [
    '/usr/bin/codesign',
    '/usr/bin/ditto',
    '/usr/bin/hdiutil',
    '/usr/sbin/spctl',
  ]) {
    assertTool(tool);
  }
  const identities = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], {
    label: 'verify Developer ID identity',
  });
  if (!identities.stdout.includes(`"${identity}"`)) {
    throw new Error(`keychain identity is unavailable: ${identity}`);
  }
  run(
    '/usr/bin/xcrun',
    ['notarytool', 'history', '--keychain-profile', notaryProfile, '--output-format', 'json'],
    { label: 'verify notary keychain profile' },
  );
  run('/opt/homebrew/bin/gh', ['auth', 'status', '--active', '--hostname', 'github.com'], {
    label: 'verify GitHub CLI login',
  });
  const branch = run('/usr/bin/git', ['branch', '--show-current'], {
    label: 'verify release branch',
  }).stdout.trim();
  if (branch !== 'feat/r2-distribution-readiness') {
    throw new Error(`release must run from feat/r2-distribution-readiness, found ${branch}`);
  }
  if (!options.allowDirty) {
    const dirty = run('/usr/bin/git', ['status', '--porcelain'], {
      label: 'verify clean worktree',
    }).stdout.trim();
    if (dirty)
      throw new Error('release worktree is dirty; commit first or use --allow-dirty for QA');
  }
}

function verifyCodeSignature(pathname) {
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', pathname], {
    label: 'verify app code signature',
  });
  const details = run('/usr/bin/codesign', ['-dv', '--verbose=4', pathname], {
    label: 'verify app signing authority',
  });
  if (
    !details.stderr.includes('TeamIdentifier=9MP925J67C') ||
    !details.stderr.includes(`Authority=${identity}`)
  ) {
    throw new Error('Offisim.app is not signed by the expected Developer ID');
  }
}

function notarize(pathname, evidenceDir, label) {
  const result = run(
    '/usr/bin/xcrun',
    [
      'notarytool',
      'submit',
      pathname,
      '--keychain-profile',
      notaryProfile,
      '--wait',
      '--timeout',
      '30m',
      '--output-format',
      'json',
    ],
    { label: `notarize ${label}` },
  );
  const report = JSON.parse(result.stdout);
  if (report.status !== 'Accepted') {
    throw new Error(`${label} notarization status was ${report.status ?? 'unknown'}`);
  }
  writeFileSync(
    path.join(evidenceDir, `notary-${label}.json`),
    `${JSON.stringify({ id: report.id, status: report.status, message: report.message }, null, 2)}\n`,
  );
  return report;
}

function stapleAndAssess(pathname, label, type = 'exec') {
  run('/usr/bin/xcrun', ['stapler', 'staple', pathname], { label: `staple ${label}` });
  run('/usr/bin/xcrun', ['stapler', 'validate', pathname], {
    label: `validate ${label} staple`,
  });
  const args =
    type === 'exec'
      ? ['-a', '-vv', '--type', 'exec', pathname]
      : ['-a', '-vv', '-t', 'open', '--context', 'context:primary-signature', pathname];
  return run('/usr/sbin/spctl', args, { label: `Gatekeeper assess ${label}` });
}

function packageArtifacts(version, outputDir) {
  const zipName = `Offisim_${version}_aarch64.app.zip`;
  const zipPath = path.join(outputDir, zipName);
  run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath], {
    label: 'package update ZIP',
  });
  assertRegularFile(zipPath, 'update ZIP');

  const dmgName = `Offisim_${version}_aarch64.dmg`;
  const dmgPath = path.join(outputDir, dmgName);
  const stagingRoot = mkdtempSync(path.join(os.tmpdir(), 'offisim-dmg-'));
  try {
    const stagedApp = path.join(stagingRoot, 'Offisim.app');
    run('/usr/bin/ditto', [appPath, stagedApp], { label: 'stage app for DMG' });
    symlinkSync('/Applications', path.join(stagingRoot, 'Applications'), 'dir');
    run(
      '/usr/bin/hdiutil',
      ['create', '-volname', 'Offisim', '-srcfolder', stagingRoot, '-format', 'UDZO', dmgPath],
      { label: 'package DMG' },
    );
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
  assertRegularFile(dmgPath, 'DMG');
  run('/usr/bin/hdiutil', ['verify', dmgPath], { label: 'verify DMG filesystem' });
  run('/usr/bin/codesign', ['--force', '--timestamp', '--sign', identity, dmgPath], {
    label: 'sign DMG',
  });
  return { dmgName, dmgPath, zipName, zipPath };
}

function writeChecksums(artifacts) {
  const zipSha = sha256(artifacts.zipPath);
  const dmgSha = sha256(artifacts.dmgPath);
  const zipSidecar = `${artifacts.zipPath}.sha256`;
  const dmgSidecar = `${artifacts.dmgPath}.sha256`;
  writeFileSync(zipSidecar, `${zipSha}  ${artifacts.zipName}\n`);
  writeFileSync(dmgSidecar, `${dmgSha}  ${artifacts.dmgName}\n`);
  return { dmgSha, dmgSidecar, zipSha, zipSidecar };
}

function publishDraft(options, version, artifacts, checksums, evidenceDir) {
  const tag = options.tag ?? `v${version}`;
  const title = options.title ?? `Offisim ${version}`;
  const notesFile = options.notesFile
    ? path.resolve(root, options.notesFile)
    : path.join(evidenceDir, 'release-notes.md');
  if (!options.notesFile) {
    writeFileSync(
      notesFile,
      `Offisim ${version}\n\nSigned and notarized macOS distribution artifacts.\n`,
    );
  }
  const args = [
    'release',
    'create',
    tag,
    artifacts.dmgPath,
    checksums.dmgSidecar,
    artifacts.zipPath,
    checksums.zipSidecar,
    '--repo',
    repository,
    '--target',
    options.releaseTarget,
    '--title',
    title,
    '--notes-file',
    notesFile,
  ];
  if (options.draft) args.push('--draft');
  run('/opt/homebrew/bin/gh', args, {
    label: `create${options.draft ? ' draft' : ''} GitHub release`,
  });
  const release = run(
    '/opt/homebrew/bin/gh',
    ['release', 'view', tag, '--repo', repository, '--json', 'url,tagName,isDraft,assets'],
    { label: 'verify GitHub release' },
  );
  return JSON.parse(release.stdout);
}

function runReleaseGates() {
  run('/opt/homebrew/bin/pnpm', ['--filter', '@offisim/desktop-renderer...', 'build'], {
    label: 'build renderer and workspace dependencies',
    forward: true,
  });
  run('/opt/homebrew/bin/pnpm', ['--filter', '@offisim/desktop-renderer', 'typecheck'], {
    label: 'typecheck renderer',
    forward: true,
  });
  run(process.execPath, ['scripts/release-gates.mjs', '--lane=node'], {
    label: 'run Node release gates',
    forward: true,
  });
  run('/opt/homebrew/bin/pnpm', ['prepare:desktop-cargo-test'], {
    label: 'prepare desktop cargo tests',
    forward: true,
  });
  run(
    path.join(os.homedir(), '.cargo/bin/cargo'),
    ['test', '--locked', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml', '--lib'],
    { label: 'run desktop cargo library tests', forward: true },
  );
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const version = safeVersion();
  const evidenceDir = path.resolve(
    root,
    options.evidenceDir ?? `output/release-evidence/offisim-${version}-${Date.now()}`,
  );
  const outputDir = path.join(evidenceDir, 'artifacts');
  mkdirSync(outputDir, { recursive: true });
  assertPrerequisites(options);

  if (!options.skipGates) runReleaseGates();

  if (!options.skipBuild) {
    run(
      '/opt/homebrew/bin/pnpm',
      [
        '--filter',
        '@offisim/desktop',
        'exec',
        'tauri',
        'build',
        '--bundles',
        'app',
        '--target',
        target,
      ],
      { label: 'build release Offisim.app', forward: true },
    );
  }
  assertApp(appPath);

  run(
    '/usr/bin/codesign',
    ['--force', '--deep', '--options', 'runtime', '--timestamp', '--sign', identity, appPath],
    { label: 'sign release Offisim.app' },
  );
  verifyCodeSignature(appPath);

  const notaryUpload = path.join(evidenceDir, `Offisim_${version}_notary.zip`);
  run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, notaryUpload], {
    label: 'package app for notarization',
  });
  const appNotary = notarize(notaryUpload, evidenceDir, 'app');
  rmSync(notaryUpload, { force: true });
  const appSpctl = stapleAndAssess(appPath, 'app');

  const artifacts = packageArtifacts(version, outputDir);
  const dmgNotary = notarize(artifacts.dmgPath, evidenceDir, 'dmg');
  const dmgSpctl = stapleAndAssess(artifacts.dmgPath, 'dmg', 'open');
  const checksums = writeChecksums(artifacts);
  const release = publishDraft(options, version, artifacts, checksums, evidenceDir);
  const commit = run('/usr/bin/git', ['rev-parse', 'HEAD'], {
    label: 'record source commit',
  }).stdout.trim();
  const evidence = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    repository,
    branch: 'feat/r2-distribution-readiness',
    commit,
    version,
    identity,
    notaryProfile,
    gates: options.skipGates ? 'skipped' : 'passed',
    notarization: {
      app: { id: appNotary.id, status: appNotary.status },
      dmg: { id: dmgNotary.id, status: dmgNotary.status },
    },
    gatekeeper: {
      app: `${appSpctl.stdout}${appSpctl.stderr}`.trim(),
      dmg: `${dmgSpctl.stdout}${dmgSpctl.stderr}`.trim(),
    },
    artifacts: {
      dmg: { name: artifacts.dmgName, sha256: checksums.dmgSha },
      updateZip: { name: artifacts.zipName, sha256: checksums.zipSha },
    },
    release,
  };
  writeFileSync(
    path.join(evidenceDir, 'release-evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  console.log(`[release] complete: ${evidenceDir}`);
}

if (path.resolve(process.argv[1] ?? '') === filePath) {
  try {
    main();
  } catch (error) {
    console.error(`[release] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
