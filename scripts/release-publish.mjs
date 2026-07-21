#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  constants,
  accessSync,
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
import { readReleaseContract } from './release-contract.mjs';

const filePath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(filePath), '..');
const identity = 'Developer ID Application: Haosheng Li (9MP925J67C)';
const notaryProfile = 'offisim-notary';
const repository = 'mike007jd/Offisim';
const releaseBranch = 'main';
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
    releaseTarget: releaseBranch,
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

function resolveTool(name, candidates = []) {
  const pathCandidates = String(env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, name));
  for (const candidate of [...candidates, ...pathCandidates]) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue until an executable candidate is found.
    }
  }
  throw new Error(`required tool is missing: ${name}`);
}

const ghPath = resolveTool('gh', ['/opt/homebrew/bin/gh', '/usr/local/bin/gh']);
const pnpmPath = resolveTool('pnpm', ['/opt/homebrew/bin/pnpm', '/usr/local/bin/pnpm']);

function run(command, args, { label = path.basename(command), forward = false, cwd = root } = {}) {
  console.log(`[release] ${label}`);
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
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

export function assertApp(pathname, expectedVersion) {
  const metadata = lstatSync(pathname);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Offisim.app must be a real directory');
  }
  const infoPlist = path.join(pathname, 'Contents/Info.plist');
  assertRegularFile(infoPlist, 'Offisim Info.plist');
  for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) {
    const actualVersion = run('/usr/bin/plutil', ['-extract', key, 'raw', '-o', '-', infoPlist], {
      label: `read Offisim.app ${key}`,
    }).stdout.trim();
    if (actualVersion !== expectedVersion) {
      throw new Error(
        `Offisim.app ${key} must exactly match source version ${expectedVersion}; found ${actualVersion}`,
      );
    }
  }
}

function sha256(pathname) {
  return createHash('sha256').update(readFileSync(pathname)).digest('hex');
}

function safeVersion() {
  return readReleaseContract(root).version;
}

function assertReleaseTag(options, version) {
  const expectedTag = `v${version}`;
  if (options.tag && options.tag !== expectedTag) {
    throw new Error(`release tag must exactly match the source version: ${expectedTag}`);
  }
  const lookup = spawnSync(
    '/usr/bin/git',
    ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${expectedTag}`],
    { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (lookup.error) throw lookup.error;
  if (lookup.status === 0) {
    throw new Error(`release tag already exists on origin: ${expectedTag}`);
  }
  if (lookup.status !== 2) {
    throw new Error(`could not verify release tag availability: ${expectedTag}`);
  }
  return expectedTag;
}

function readReleaseSource(options) {
  run('/usr/bin/git', ['fetch', '--quiet', 'origin', releaseBranch], {
    label: `refresh origin/${releaseBranch}`,
  });
  const branch = run('/usr/bin/git', ['branch', '--show-current'], {
    label: 'verify release branch',
  }).stdout.trim();
  if (branch !== releaseBranch) {
    throw new Error(`release must run from ${releaseBranch}, found ${branch}`);
  }
  const commit = run('/usr/bin/git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
    label: 'resolve source commit',
  }).stdout.trim();
  const remoteCommit = run(
    '/usr/bin/git',
    ['rev-parse', '--verify', `origin/${releaseBranch}^{commit}`],
    { label: `resolve origin/${releaseBranch}` },
  ).stdout.trim();
  if (commit !== remoteCommit) {
    throw new Error(`release source HEAD must exactly match origin/${releaseBranch}`);
  }
  const releaseTargetCommit = run(
    '/usr/bin/git',
    ['rev-parse', '--verify', `${options.releaseTarget}^{commit}`],
    { label: 'resolve GitHub release target' },
  ).stdout.trim();
  if (commit !== releaseTargetCommit) {
    throw new Error('GitHub release target must resolve to the exact source HEAD');
  }
  if (!options.allowDirty) {
    const dirty = run('/usr/bin/git', ['status', '--porcelain'], {
      label: 'verify clean worktree',
    }).stdout.trim();
    if (dirty)
      throw new Error('release worktree is dirty; commit first or use --allow-dirty for QA');
  }
  return { branch, commit, releaseTargetCommit };
}

function assertPrerequisites(options, version) {
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
  run(ghPath, ['auth', 'status', '--active', '--hostname', 'github.com'], {
    label: 'verify GitHub CLI login',
  });
  if ((options.allowDirty || options.skipBuild || options.skipGates) && !options.draft) {
    throw new Error(
      '--allow-dirty, --skip-build, and --skip-gates are permitted only with --draft',
    );
  }
  assertReleaseTag(options, version);
  return readReleaseSource(options);
}

function assertSourceStillCurrent(source, options) {
  const current = readReleaseSource(options);
  if (
    current.branch !== source.branch ||
    current.commit !== source.commit ||
    current.releaseTargetCommit !== source.releaseTargetCommit
  ) {
    throw new Error('release source changed after preflight; rebuild from the new source state');
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
  const log = run(
    '/usr/bin/xcrun',
    [
      'notarytool',
      'log',
      report.id,
      '--keychain-profile',
      notaryProfile,
      '--output-format',
      'json',
    ],
    { label: `archive ${label} notarization log` },
  );
  JSON.parse(log.stdout);
  writeFileSync(path.join(evidenceDir, `notary-${label}-log.json`), log.stdout);
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

function publishDraft(options, version, artifacts, checksums, evidenceDir, sourceCommit) {
  const tag = `v${version}`;
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
    sourceCommit,
    '--title',
    title,
    '--notes-file',
    notesFile,
  ];
  if (options.draft) args.push('--draft');
  if (version.includes('-')) args.push('--prerelease');
  run(ghPath, args, {
    label: `create${options.draft ? ' draft' : ''} GitHub release`,
  });
  const release = run(
    ghPath,
    [
      'release',
      'view',
      tag,
      '--repo',
      repository,
      '--json',
      'url,tagName,isDraft,isPrerelease,assets',
    ],
    { label: 'verify GitHub release' },
  );
  const published = JSON.parse(release.stdout);
  if (published.isDraft !== options.draft || published.isPrerelease !== version.includes('-')) {
    throw new Error('GitHub release draft/prerelease state does not match the source version');
  }
  run('/usr/bin/git', ['fetch', '--force', 'origin', `refs/tags/${tag}:refs/tags/${tag}`], {
    label: 'verify published release tag',
  });
  const tagCommit = run('/usr/bin/git', ['rev-parse', '--verify', `${tag}^{commit}`], {
    label: 'resolve published release tag commit',
  }).stdout.trim();
  if (tagCommit !== sourceCommit) {
    throw new Error('published release tag does not resolve to the exact source HEAD');
  }
  return published;
}

function runReleaseGates() {
  run(pnpmPath, ['--filter', '@offisim/desktop-renderer...', 'build'], {
    label: 'build renderer and workspace dependencies',
    forward: true,
  });
  run(pnpmPath, ['--filter', '@offisim/desktop-renderer', 'typecheck'], {
    label: 'typecheck renderer',
    forward: true,
  });
  run(process.execPath, ['scripts/release-gates.mjs'], {
    label: 'run authoritative Node and Rust release gates',
    forward: true,
  });
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
  const source = assertPrerequisites(options, version);

  if (!options.skipGates) runReleaseGates();

  if (!options.skipBuild) {
    run(
      pnpmPath,
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
  assertApp(appPath, version);
  assertSourceStillCurrent(source, options);

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
  assertSourceStillCurrent(source, options);
  const release = publishDraft(options, version, artifacts, checksums, evidenceDir, source.commit);
  const evidence = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    repository,
    branch: source.branch,
    commit: source.commit,
    releaseTarget: options.releaseTarget,
    releaseTargetCommit: source.releaseTargetCommit,
    version,
    prerelease: version.includes('-'),
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
