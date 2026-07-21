#!/usr/bin/env node
/**
 * Locks the release workflow boundary for:
 *   - scripts/run-clean-release.mjs  (pnpm release:run)
 *   - scripts/release-publish.mjs    (pnpm release:publish)
 *   - scripts/release-contract.mjs   (version and Node truth)
 *   - scripts/build-pi-agent-host.mjs (bundled Node pin)
 *   - apps/desktop/src-tauri/src/app_update.rs (distribution verify)
 *
 * Positive (run-clean-release): gates → clean artifacts → build @offisim/desktop →
 * hash Offisim.app → post-build commit/dirty recheck → write evidence/summary →
 * prompt Computer Use; formal mode fail-closes on dirty worktree and on
 * source/worktree change during the run; releaseEvidence follows
 * evidenceDisqualifiers.
 * Positive (release-publish): source branch main; HEAD === origin/main === release
 * target; full scripts/release-gates.mjs; Apple-safe three-integer version locked
 * across root/desktop/renderer/Cargo.toml/Cargo.lock/tauri.conf; exact .nvmrc
 * Node; tag must be v{version}, absent on origin before publish, and after publish
 * fetch + ^{commit} must equal source HEAD; app uses codesign --verify (never
 * --force --deep re-sign); notarytool log archived; DMG may codesign independently.
 * Positive (build-pi-agent-host): same .nvmrc Node fail-close before bundling;
 * when APPLE_SIGNING_IDENTITY is set, resigns bundled Node with --timestamp
 * --options runtime and node-release.plist (no get-task-allow).
 * Positive (release-publish nested Node): verifies Developer ID Team/Authority,
 * hardened runtime, rejects get-task-allow, and checks the five required
 * runtime entitlements; still never --force --deep re-signs Offisim.app.
 * Positive (app_update): verify_distribution_app runs stapler validate before spctl.
 * Negative: no platform/renderer dev servers, no osascript, no shell `open` to
 * launch the app, no process/port killing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHarness, repoRoot } from './lib/harness-runner.mjs';

const CLEAN_TARGET = 'scripts/run-clean-release.mjs';
const PUBLISH_TARGET = 'scripts/release-publish.mjs';
const CONTRACT_TARGET = 'scripts/release-contract.mjs';
const PI_HOST_BUILD_TARGET = 'scripts/build-pi-agent-host.mjs';
const APP_UPDATE_TARGET = 'apps/desktop/src-tauri/src/app_update.rs';
const NODE_RELEASE_ENTITLEMENTS_TARGET =
  'apps/desktop/src-tauri/entitlements/node-release.plist';
const REQUIRED_NODE_RELEASE_ENTITLEMENTS = [
  'com.apple.security.cs.allow-dyld-environment-variables',
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-executable-page-protection',
  'com.apple.security.cs.disable-library-validation',
];
const cleanSource = readFileSync(join(repoRoot, CLEAN_TARGET), 'utf8');
const publishSource = readFileSync(join(repoRoot, PUBLISH_TARGET), 'utf8');
const contractSource = readFileSync(join(repoRoot, CONTRACT_TARGET), 'utf8');
const piHostBuildSource = readFileSync(join(repoRoot, PI_HOST_BUILD_TARGET), 'utf8');
const appUpdateSource = readFileSync(join(repoRoot, APP_UPDATE_TARGET), 'utf8');
const nodeReleaseEntitlementsSource = readFileSync(
  join(repoRoot, NODE_RELEASE_ENTITLEMENTS_TARGET),
  'utf8',
);
const h = createHarness('release-workflow-boundary gate');
const { check } = h;

function match(source, target, name, pattern, detail) {
  check(name, pattern.test(source), detail ?? `expected ${pattern} in ${target}`);
}

function noMatch(source, target, name, pattern, detail) {
  check(name, !pattern.test(source), detail ?? `forbidden ${pattern} found in ${target}`);
}

function matchClean(name, pattern, detail) {
  match(cleanSource, CLEAN_TARGET, name, pattern, detail);
}

function noMatchClean(name, pattern, detail) {
  noMatch(cleanSource, CLEAN_TARGET, name, pattern, detail);
}

function matchPublish(name, pattern, detail) {
  match(publishSource, PUBLISH_TARGET, name, pattern, detail);
}

function noMatchPublish(name, pattern, detail) {
  noMatch(publishSource, PUBLISH_TARGET, name, pattern, detail);
}

function matchContract(name, pattern, detail) {
  match(contractSource, CONTRACT_TARGET, name, pattern, detail);
}

function matchPiHostBuild(name, pattern, detail) {
  match(piHostBuildSource, PI_HOST_BUILD_TARGET, name, pattern, detail);
}

function matchAppUpdate(name, pattern, detail) {
  match(appUpdateSource, APP_UPDATE_TARGET, name, pattern, detail);
}

console.log(`reading ${CLEAN_TARGET}`);
console.log(`reading ${PUBLISH_TARGET}`);
console.log(`reading ${CONTRACT_TARGET}`);
console.log(`reading ${PI_HOST_BUILD_TARGET}`);
console.log(`reading ${APP_UPDATE_TARGET}`);
console.log(`reading ${NODE_RELEASE_ENTITLEMENTS_TARGET}`);

// --- required release:run workflow steps ---
matchClean(
  'imports RELEASE_GATES from release-gates.mjs',
  /import\s*\{\s*RELEASE_GATES\b[^}]*\}\s*from\s*['"]\.\/release-gates\.mjs['"]/u,
  'run-clean-release.mjs must import RELEASE_GATES from ./release-gates.mjs',
);
matchClean(
  'iterates RELEASE_GATES',
  /for\s*\(\s*const\s+gate\s+of\s+RELEASE_GATES\s*\)/u,
  'release gates must be executed via `for (const gate of RELEASE_GATES)`',
);
matchClean(
  'defines cleanBuildArtifacts()',
  /function\s+cleanBuildArtifacts\s*\(/u,
  'cleanBuildArtifacts() must remain the artifact cleanup entry',
);
matchClean(
  'calls cleanBuildArtifacts()',
  /cleanBuildArtifacts\s*\(\s*\)\s*;/u,
  'main() must call cleanBuildArtifacts() before the desktop build',
);
matchClean(
  'prepares gitignored Tauri resources before cargo-test',
  /if\s*\(\s*gate\.name\s*===\s*['"]cargo-test['"]\s*\)\s*ensureDesktopCargoTestPrereqs\(\)/u,
  'formal release must create inert resource prerequisites before cargo-test on a clean checkout',
);
matchClean(
  'builds @offisim/desktop release package',
  /run\(\s*['"]pnpm['"]\s*,\s*\[\s*['"]--filter['"]\s*,\s*['"]@offisim\/desktop['"]\s*,\s*['"]build['"]\s*\]\s*\)/u,
  'must run `pnpm --filter @offisim/desktop build` via run()',
);
matchClean(
  'hashes Offisim.app bundle path',
  /apps\/desktop\/src-tauri\/target\/aarch64-apple-darwin\/release\/bundle\/macos\/Offisim\.app/u,
  'appPath must point at the aarch64-apple-darwin release Offisim.app bundle',
);
matchClean(
  'appPath includes fixed aarch64 target triple',
  /aarch64-apple-darwin/u,
  'appPath must include the fixed aarch64-apple-darwin target triple',
);
matchClean(
  'computes bundle sha256 via hashAppBundle',
  /bundleSha256\s*=\s*await\s+hashAppBundle\s*\(\s*appPath\s*\)/u,
  'must assign summary.bundleSha256 from hashAppBundle(appPath)',
);
matchClean(
  'bundle hash records entry types and symlink targets',
  /directory\\0[\s\S]*?file\\0[\s\S]*?symlink\\0[\s\S]*?readlinkSync/u,
  'release evidence hash must distinguish directories, files, and symlink targets',
);
matchClean(
  'writes evidence under output/release-evidence',
  /output\/release-evidence/u,
  'evidenceDir must live under output/release-evidence',
);
matchClean('writes summary.json evidence', /summary\.json/u, 'evidence must include summary.json');
matchClean(
  'exposes writeSummary for gates/evidence',
  /const\s+writeSummary\s*=\s*\(\s*\)\s*=>\s*writeFileSync\s*\(\s*summaryPath/u,
  'writeSummary must persist summary.json during the release run',
);
matchClean(
  'prompts Computer Use for live verification',
  /Computer Use/u,
  'done message must tell the operator to verify with Computer Use',
);
matchClean(
  'does not claim the script itself launched the app',
  /done\.\s*Launch and verify the exact release app with Computer Use\./u,
  'final log must prompt Computer Use launch, not open the app itself',
);

// --- formal mode: dirty worktree fail-closed + evidenceDisqualifiers ---
matchClean(
  'records evidenceDisqualifiers including dirty_worktree',
  /evidenceDisqualifiers\s*:\s*\[[\s\S]*?dirty_worktree[\s\S]*?\]/u,
  'summary.evidenceDisqualifiers must include dirty_worktree when the worktree is dirty',
);
matchClean(
  'records gates_skipped disqualifier for --skip-gates',
  /skipGates\s*\?\s*\['gates_skipped'\]/u,
  '--skip-gates must add gates_skipped to evidenceDisqualifiers',
);
matchClean(
  'formal mode fail-closes on dirty or unreadable worktree',
  /if\s*\(\s*git\.dirty\s*!==\s*false\s*\)\s*\{[\s\S]*?process\.exit\s*\(\s*1\s*\)/u,
  'non-skip formal mode must exit(1) when git.dirty is not false',
);
matchClean(
  'releaseEvidence is controlled by evidenceDisqualifiers',
  /releaseEvidence\s*=\s*summary\.evidenceDisqualifiers\.length\s*===\s*0/u,
  'summary.releaseEvidence must be true only when evidenceDisqualifiers is empty',
);
matchClean(
  'dirty fail-closed path is gated behind !skipGates',
  /if\s*\(\s*skipGates\s*\)\s*\{[\s\S]*?\}\s*else\s*\{[\s\S]*?git\.dirty\s*!==\s*false/u,
  'dirty fail-closed must run in the formal (!skipGates) branch',
);

// --- post-build/hash source + dirty recheck (formal fail-close) ---
matchClean(
  're-reads git state after hashing the bundle',
  /bundleSha256\s*=\s*await\s+hashAppBundle\s*\(\s*appPath\s*\)[\s\S]*?const\s+finalGit\s*=\s*gitInfo\s*\(\s*\)/u,
  'must call gitInfo() again after hashAppBundle to catch mid-run drift',
);
matchClean(
  'disqualifies commit_changed_during_release',
  /commit_changed_during_release/u,
  'commit drift during gates/build must add commit_changed_during_release',
);
matchClean(
  'disqualifies worktree_changed_during_release',
  /worktree_changed_during_release/u,
  'dirty worktree after build/hash must add worktree_changed_during_release',
);
matchClean(
  'formal mode fail-closes when post-build evidence is disqualified',
  /if\s*\(\s*!skipGates\s*&&\s*!summary\.releaseEvidence\s*\)\s*\{[\s\S]*?process\.exit\s*\(\s*1\s*\)/u,
  'formal (!skipGates) mode must exit(1) when source/worktree changed during the run',
);

// --- forbidden: dev servers ---
noMatchClean(
  'does not start @offisim/platform dev',
  /['"]@offisim\/platform['"]\s*,\s*['"]dev['"]/u,
  'must not spawn/run `pnpm --filter @offisim/platform dev`',
);
noMatchClean(
  'does not start @offisim/desktop-renderer dev',
  /['"]@offisim\/desktop-renderer['"]\s*,\s*['"]dev['"]/u,
  'must not spawn/run `pnpm --filter @offisim/desktop-renderer dev`',
);
noMatchClean(
  'does not define startPlatformDev',
  /\bstartPlatformDev\b/u,
  'startPlatformDev helper must stay removed',
);
noMatchClean(
  'does not define startRendererDev',
  /\bstartRendererDev\b/u,
  'startRendererDev helper must stay removed',
);
noMatchClean(
  'does not wait on renderer/platform ports',
  /\b(waitForPort|waitForHttpOk|isPortOpen)\b/u,
  'port-wait helpers for local dev servers must stay removed',
);
noMatchClean(
  'does not import node:net for port probing',
  /from\s+['"]node:net['"]/u,
  'node:net port probing must stay removed from release:run',
);

// --- forbidden: AppleScript / shell open / process kill ---
noMatchClean(
  'does not call osascript',
  /\bosascript\b/u,
  'AppleScript/osascript must not control the release app',
);
noMatchClean(
  'does not shell-open the release app',
  /\brun\(\s*['"]open['"]/u,
  "must not `run('open', …)` to launch Offisim.app",
);
noMatchClean(
  'does not spawn/exec open to launch the app',
  /\b(?:spawn|spawnSync|execFileSync|execSync)\(\s*['"]open['"]/u,
  "must not spawn/execFileSync('open', …) to launch Offisim.app",
);
noMatchClean(
  'does not define killPort/killPid helpers',
  /\b(?:killPort|killPid|pidsForPort)\b/u,
  'port/process kill helpers must stay removed',
);
noMatchClean(
  'does not define killOffisimDesktop/Platform helpers',
  /\b(?:killOffisimDesktop|killOffisimPlatform)\b/u,
  'desktop/platform kill helpers must stay removed',
);
noMatchClean(
  'does not shell out to lsof for ports',
  /\blsof\b/u,
  'lsof port discovery must stay removed from release:run',
);
noMatchClean(
  'does not shell out to pgrep for process kill',
  /\bpgrep\b/u,
  'pgrep process discovery must stay removed from release:run',
);
noMatchClean(
  'does not call process.kill for cleanup',
  /\bprocess\.kill\s*\(/u,
  'process.kill must stay removed from release:run cleanup',
);
noMatchClean(
  'does not detach background children',
  /\bdetached\s*:\s*true\b/u,
  'detached background children (dev servers) must stay removed',
);

// --- release-publish: source branch / exact HEAD contract ---
matchPublish(
  'releaseBranch constant is main',
  /const\s+releaseBranch\s*=\s*['"]main['"]/u,
  'release-publish source branch must be main',
);
matchPublish(
  'default releaseTarget is releaseBranch (main)',
  /releaseTarget\s*:\s*releaseBranch/u,
  'default --target must resolve to releaseBranch (main)',
);
noMatchPublish(
  'does not hardcode legacy feature release branch',
  /feat\/r2-distribution-readiness/u,
  'legacy feat/r2-distribution-readiness must stay removed from release-publish',
);
matchPublish(
  'refreshes origin/main before source checks',
  /fetch[\s\S]*?origin[\s\S]*?releaseBranch/u,
  'must git fetch origin main before comparing HEAD',
);
matchPublish(
  'requires current branch === releaseBranch',
  /branch\s*!==\s*releaseBranch/u,
  'must reject any current branch other than main',
);
matchPublish(
  'requires HEAD === origin/main',
  /commit\s*!==\s*remoteCommit/u,
  'release source HEAD must exactly match origin/main',
);
matchPublish(
  'resolves origin via origin/${releaseBranch}',
  /origin\/\$\{releaseBranch\}\^\{commit\}/u,
  'remote commit must resolve from origin/${releaseBranch}^{commit}',
);
matchPublish(
  'requires release target commit === source HEAD',
  /commit\s*!==\s*releaseTargetCommit/u,
  'GitHub --target must resolve to the exact source HEAD',
);
matchPublish(
  're-checks source currency after build/sign',
  /function\s+assertSourceStillCurrent\s*\(/u,
  'assertSourceStillCurrent must remain to catch mid-run source drift',
);
matchPublish(
  'publishes against immutable source commit',
  /['"]--target['"]\s*,\s*sourceCommit/u,
  'gh release create --target must use the immutable source commit, not a mutable branch name',
);

// --- release-publish: draft-only skip/dirty escapes ---
matchPublish(
  'allow-dirty/skip-build/skip-gates require --draft',
  /\(options\.allowDirty\s*\|\|\s*options\.skipBuild\s*\|\|\s*options\.skipGates\)\s*&&\s*!options\.draft/u,
  '--allow-dirty/--skip-build/--skip-gates must be rejected unless --draft is set',
);
matchPublish(
  'draft-only escape error names the three flags',
  /--allow-dirty,\s*--skip-build,\s*and\s*--skip-gates are permitted only with --draft/u,
  'error text must name the three draft-only escape hatches',
);

// --- release-publish: full release-gates.mjs (no lane slice) ---
matchPublish(
  'publisher invokes full scripts/release-gates.mjs',
  /\[\s*['"]scripts\/release-gates\.mjs['"]\s*\]/u,
  'must run scripts/release-gates.mjs with no --lane= argument',
);
noMatchPublish(
  'publisher does not slice release-gates to --lane=node',
  /release-gates\.mjs['"]\s*,\s*['"]--lane=node['"]/u,
  'publisher must not invoke release-gates.mjs --lane=node',
);
noMatchPublish(
  'publisher does not inline cargo test as a substitute gate',
  /cargo[\s\S]{0,40}test[\s\S]{0,40}--locked/u,
  'must not reintroduce inline cargo test; reuse full release-gates.mjs',
);

// --- release-contract: Apple-safe three-integer version lock ---
matchContract(
  'rejects non-Apple-safe versions',
  /\/\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$\/u\.test\(\s*version\s*\)/u,
  'tauri.conf.json version must match Apple-safe /^[0-9]+\\.[0-9]+\\.[0-9]+$/',
);
matchContract(
  'compares package.json version to tauri.conf',
  /['"]package\.json['"][\s\S]*?version/u,
  'root package.json version must be compared to tauri.conf.json',
);
matchContract(
  'compares apps/desktop/package.json version to tauri.conf',
  /['"]apps\/desktop\/package\.json['"]/u,
  'apps/desktop/package.json version must be compared to tauri.conf.json',
);
matchContract(
  'compares apps/desktop/renderer/package.json version to tauri.conf',
  /['"]apps\/desktop\/renderer\/package\.json['"]/u,
  'apps/desktop/renderer/package.json version must be compared to tauri.conf.json',
);
matchContract(
  'compares Cargo.toml version to tauri.conf',
  /['"]apps\/desktop\/src-tauri\/Cargo\.toml['"]/u,
  'Cargo.toml version must be compared to tauri.conf.json',
);
matchContract(
  'compares Cargo.lock offisim-desktop version to tauri.conf',
  /['"]apps\/desktop\/src-tauri\/Cargo\.lock['"][\s\S]*?offisim-desktop/u,
  'Cargo.lock offisim-desktop version must be compared to tauri.conf.json',
);
matchContract(
  'fail-closes when any version source drifts from tauri.conf',
  /sourceVersion\s*!==\s*version[\s\S]*?must exactly match tauri\.conf\.json/u,
  'every version source must exactly match tauri.conf.json or throw',
);

// --- release-contract + build-pi-agent-host: exact .nvmrc Node ---
matchContract(
  'release reads .nvmrc for required Node',
  /readFileSync\(\s*path\.join\(\s*root\s*,\s*['"]\.nvmrc['"]\s*\)\s*,\s*['"]utf8['"]\s*\)\.trim\(\)/u,
  'release-contract must read repository .nvmrc',
);
matchContract(
  'release fail-closes unless process.version === v{.nvmrc}',
  /process\.version\s*!==\s*`v\$\{nodeVersion\}`/u,
  'release must require process.version to equal v + .nvmrc contents',
);
matchPiHostBuild(
  'pi-agent-host build reads .nvmrc for required Node',
  /readFile\(\s*resolve\(\s*ROOT\s*,\s*['"]\.nvmrc['"]\s*\)\s*,\s*['"]utf8['"]\s*\)/u,
  'build-pi-agent-host must read repository .nvmrc before bundling Node',
);
matchPiHostBuild(
  'pi-agent-host build fail-closes unless process.version === v{.nvmrc}',
  /process\.version\s*!==\s*`v\$\{requiredVersion\}`/u,
  'build-pi-agent-host must fail-close when process.version mismatches .nvmrc',
);
{
  const copyNodeIdx = piHostBuildSource.indexOf('const nodeRuntime = await copyNodeRuntime()');
  const buildHostIdx = piHostBuildSource.indexOf('await buildAgentHost(');
  check(
    'pi-agent-host validates and copies exact Node before writing host output',
    copyNodeIdx >= 0 && buildHostIdx >= 0 && copyNodeIdx < buildHostIdx,
    'copyNodeRuntime() must fail-close on the wrong Node before buildAgentHost() writes output',
  );
}

// --- release-publish: stale app fail-close, including --draft --skip-build ---
matchPublish(
  'publisher passes source version into app validation',
  /assertApp\(\s*appPath\s*,\s*version\s*\)/u,
  'publisher must validate the selected app against the source version even when build is skipped',
);
matchPublish(
  'validates CFBundleShortVersionString',
  /CFBundleShortVersionString/u,
  'app validation must inspect CFBundleShortVersionString',
);
matchPublish(
  'validates CFBundleVersion',
  /CFBundleVersion/u,
  'app validation must inspect CFBundleVersion',
);
matchPublish(
  'rejects app version drift before notarization',
  /actualVersion\s*!==\s*expectedVersion[\s\S]*?must exactly match source version/u,
  'stale app bundles must fail before signing, notarization, or packaging',
);
{
  const buildBranchIdx = publishSource.indexOf('if (!options.skipBuild)');
  const assertAppIdx = publishSource.indexOf('assertApp(appPath, version)');
  const verifySignatureIdx = publishSource.indexOf('verifyCodeSignature(appPath)');
  check(
    'stale app validation runs after optional build and before signing/notarization',
    buildBranchIdx >= 0 && assertAppIdx > buildBranchIdx && verifySignatureIdx > assertAppIdx,
    '--draft --skip-build must still validate app version before distribution work',
  );
}

// --- release-publish: exact tag + remote absence + post-publish HEAD match ---
matchPublish(
  'expected release tag is strictly v{version}',
  /const\s+expectedTag\s*=\s*`v\$\{version\}`/u,
  'release tag must be exactly v{version}',
);
matchPublish(
  'rejects operator --tag that drifts from v{version}',
  /options\.tag\s*&&\s*options\.tag\s*!==\s*expectedTag/u,
  '--tag must exactly match the source version tag',
);
matchPublish(
  'preflight ls-remote checks origin for the release tag',
  /ls-remote[\s\S]*?--tags[\s\S]*?origin[\s\S]*?refs\/tags\/\$\{expectedTag\}/u,
  'must ls-remote origin refs/tags/v{version} before publishing',
);
matchPublish(
  'fail-closes when the release tag already exists on origin',
  /release tag already exists on origin/u,
  'existing origin tag must abort publish',
);
matchPublish(
  'post-publish fetches the published tag from origin',
  /fetch[\s\S]*?--force[\s\S]*?origin[\s\S]*?refs\/tags\/\$\{tag\}:refs\/tags\/\$\{tag\}/u,
  'must fetch refs/tags/v{version} after GitHub release create',
);
matchPublish(
  'post-publish resolves tag^{commit} against source HEAD',
  /\$\{tag\}\^\{commit\}[\s\S]*?tagCommit\s*!==\s*sourceCommit/u,
  'published tag^{commit} must equal the exact source HEAD',
);

// --- release-publish: codesign verify only for app; no --force --deep re-sign ---
matchPublish(
  'verifies app signature with codesign --verify --deep',
  /codesign['"]\s*,\s*\[\s*['"]--verify['"]\s*,\s*['"]--deep['"]/u,
  'app verification must use codesign --verify --deep',
);
noMatchPublish(
  'does not re-sign the app with codesign --force --deep',
  /codesign[\s\S]{0,120}--force[\s\S]{0,80}--deep|codesign[\s\S]{0,120}--deep[\s\S]{0,80}--force/u,
  'Offisim.app must not be re-signed with codesign --force --deep',
);
matchPublish(
  'allows independent DMG codesign with --force --timestamp --sign',
  /codesign['"]\s*,\s*\[\s*['"]--force['"]\s*,\s*['"]--timestamp['"]\s*,\s*['"]--sign['"]/u,
  'DMG may be codesigned independently with --force --timestamp --sign',
);

// --- build-pi-agent-host: nested Node distribution resign under APPLE_SIGNING_IDENTITY ---
matchPiHostBuild(
  'pi-agent-host resigns bundled Node when APPLE_SIGNING_IDENTITY is set',
  /APPLE_SIGNING_IDENTITY[\s\S]*?codesign[\s\S]*?['"]--sign['"]\s*,\s*identity/u,
  'build-pi-agent-host must codesign --sign with APPLE_SIGNING_IDENTITY for bundled Node',
);
matchPiHostBuild(
  'pi-agent-host Node resign uses --timestamp --options runtime',
  /['"]--timestamp['"]\s*,\s*['"]--options['"]\s*,\s*['"]runtime['"]/u,
  'bundled Node resign must pass --timestamp --options runtime',
);
matchPiHostBuild(
  'pi-agent-host Node resign uses node-release.plist entitlements',
  /apps\/desktop\/src-tauri\/entitlements\/node-release\.plist[\s\S]*?['"]--entitlements['"]\s*,\s*NODE_RELEASE_ENTITLEMENTS/u,
  'bundled Node resign must use apps/desktop/src-tauri/entitlements/node-release.plist',
);
noMatch(
  nodeReleaseEntitlementsSource,
  NODE_RELEASE_ENTITLEMENTS_TARGET,
  'node-release.plist does not grant get-task-allow',
  /com\.apple\.security\.get-task-allow/u,
  'node-release.plist must not contain com.apple.security.get-task-allow',
);

// --- release-publish: bundled Node Developer ID + hardened runtime + entitlements ---
matchPublish(
  'publisher verifies bundled Node Developer ID Team and Authority',
  /nodeDetails[\s\S]*?TeamIdentifier=9MP925J67C[\s\S]*?Authority=\$\{identity\}/u,
  'bundled Node must be checked for Developer ID TeamIdentifier and Authority',
);
matchPublish(
  'publisher requires bundled Node hardened runtime marker',
  /nodeDetails[\s\S]*?\(runtime\)[\s\S]*?Timestamp=[\s\S]*?bundled Node is not Developer ID signed with hardened runtime and a secure timestamp/u,
  'bundled Node verification must require hardened runtime and a secure timestamp',
);
matchPublish(
  'publisher rejects bundled Node get-task-allow',
  /com\.apple\.security\.get-task-allow[\s\S]*?forbidden get-task-allow/u,
  'publisher must fail-close when bundled Node requests get-task-allow',
);
{
  const requiredListMatch = publishSource.match(
    /const\s+requiredNodeEntitlements\s*=\s*\[([\s\S]*?)\]/u,
  );
  const listed = requiredListMatch
    ? [...requiredListMatch[1].matchAll(/['"]([^'"]+)['"]/gu)].map((entry) => entry[1])
    : [];
  check(
    'publisher requiredNodeEntitlements lists the five runtime entitlements',
    listed.length === REQUIRED_NODE_RELEASE_ENTITLEMENTS.length &&
      REQUIRED_NODE_RELEASE_ENTITLEMENTS.every((entitlement, index) => listed[index] === entitlement),
    'requiredNodeEntitlements must exactly list the five Node release runtime entitlements',
  );
  matchPublish(
    'publisher verifies each required bundled Node entitlement',
    /for\s*\(\s*const\s+entitlement\s+of\s+requiredNodeEntitlements\s*\)[\s\S]*?missing required release entitlement/u,
    'publisher must loop requiredNodeEntitlements and fail-close on any missing entitlement',
  );
  matchPublish(
    'publisher rejects unexpected bundled Node entitlements',
    /unexpectedEntitlements[\s\S]*?contains unexpected release entitlements/u,
    'publisher must fail-close when bundled Node contains any entitlement outside the release allowlist',
  );
  for (const entitlement of REQUIRED_NODE_RELEASE_ENTITLEMENTS) {
    check(
      `node-release.plist grants ${entitlement}`,
      nodeReleaseEntitlementsSource.includes(`<key>${entitlement}</key>`),
      `${NODE_RELEASE_ENTITLEMENTS_TARGET} must grant ${entitlement}`,
    );
  }
}

// --- release-publish: notarytool log archived ---
matchPublish(
  'archives notarytool log after Accepted notarization',
  /notarytool['"]\s*,\s*['"]log['"]/u,
  'must call xcrun notarytool log after submit Accepted',
);
matchPublish(
  'persists notary log JSON under evidenceDir',
  /notary-\$\{label\}-log\.json/u,
  'notarytool log stdout must be written to notary-{label}-log.json',
);

// --- release-publish: exact aarch64 release app path ---
matchPublish(
  'publish target triple is aarch64-apple-darwin',
  /const\s+target\s*=\s*['"]aarch64-apple-darwin['"]/u,
  'publisher must pin target = aarch64-apple-darwin',
);
matchPublish(
  'publish appPath joins src-tauri/target + target + Offisim.app',
  /path\.join\(\s*root\s*,\s*['"]apps\/desktop\/src-tauri\/target['"]\s*,\s*target\s*,\s*['"]release\/bundle\/macos\/Offisim\.app['"]/u,
  'publisher appPath must resolve to …/target/<triple>/release/bundle/macos/Offisim.app',
);

// --- app_update: stapler validate before spctl ---
{
  const verifyFn = appUpdateSource.match(
    /async fn verify_distribution_app[\s\S]*?(?=\nasync fn |\nfn |\n#\[|$)/u,
  )?.[0];
  check(
    'defines verify_distribution_app',
    Boolean(verifyFn),
    'app_update.rs must define verify_distribution_app',
  );
  if (verifyFn) {
    const staplerIdx = verifyFn.search(/stapler[\s\S]{0,40}validate/u);
    const spctlIdx = verifyFn.search(/\/usr\/sbin\/spctl/u);
    check(
      'verify_distribution_app runs stapler validate before spctl',
      staplerIdx >= 0 && spctlIdx >= 0 && staplerIdx < spctlIdx,
      'stapler validate must precede /usr/sbin/spctl inside verify_distribution_app',
    );
  }
}
matchAppUpdate(
  'verify_distribution_app invokes xcrun stapler validate',
  /OsString::from\(\s*"stapler"\s*\)[\s\S]*?OsString::from\(\s*"validate"\s*\)/u,
  'distribution verify must call xcrun stapler validate',
);
matchAppUpdate(
  'verify_distribution_app invokes spctl assess',
  /\/usr\/sbin\/spctl/u,
  'distribution verify must call /usr/sbin/spctl after staple validation',
);

console.log(`\n${h.checks - h.failures}/${h.checks} checks passed`);
if (h.failures > 0) {
  console.error(`release-workflow-boundary gate FAILED (${h.failures} failing)`);
} else {
  console.log('release-workflow-boundary gate OK');
}
h.report();
