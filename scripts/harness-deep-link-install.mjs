#!/usr/bin/env node
/**
 * Static deep-link install regression gate.
 *
 * Locks the cold-start queue handshake, strict offisim://install parse contract,
 * renderer listen-then-ready order, Market exact-version review path, and the
 * rule that a deep link never auto-confirms install. Reads source only — no
 * Offisim.app launch, no network.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHarness, repoRoot } from './lib/harness-runner.mjs';

const DEEP_LINK_RS = 'apps/desktop/src-tauri/src/deep_link.rs';
const LIB_RS = 'apps/desktop/src-tauri/src/lib.rs';
const CARGO_TOML = 'apps/desktop/src-tauri/Cargo.toml';
const PERMISSION_TOML = 'apps/desktop/src-tauri/permissions/deep-link-install.toml';
const CAPABILITY_JSON = 'apps/desktop/src-tauri/capabilities/deep-link-install.json';
const BRIDGE_TS = 'apps/desktop/renderer/src/app/DeepLinkInstallBridge.tsx';
const APP_TSX = 'apps/desktop/renderer/src/App.tsx';
const MAIN_TSX = 'apps/desktop/renderer/src/main.tsx';
const MARKET_TSX = 'apps/desktop/renderer/src/surfaces/market/MarketSurface.tsx';
const MARKET_QUERIES = 'apps/desktop/renderer/src/data/market/queries.ts';
const PLATFORM_MARKET = 'apps/platform/src/routes/market.ts';
const HARNESS_SELF = 'scripts/harness-deep-link-install.mjs';

const deepLinkRs = readFileSync(join(repoRoot, DEEP_LINK_RS), 'utf8');
const libRs = readFileSync(join(repoRoot, LIB_RS), 'utf8');
const cargoToml = readFileSync(join(repoRoot, CARGO_TOML), 'utf8');
const permissionToml = readFileSync(join(repoRoot, PERMISSION_TOML), 'utf8');
const capabilityJson = readFileSync(join(repoRoot, CAPABILITY_JSON), 'utf8');
const bridgeTs = readFileSync(join(repoRoot, BRIDGE_TS), 'utf8');
const appTsx = readFileSync(join(repoRoot, APP_TSX), 'utf8');
const mainTsx = readFileSync(join(repoRoot, MAIN_TSX), 'utf8');
const marketTsx = readFileSync(join(repoRoot, MARKET_TSX), 'utf8');
const marketQueries = readFileSync(join(repoRoot, MARKET_QUERIES), 'utf8');
const platformMarket = readFileSync(join(repoRoot, PLATFORM_MARKET), 'utf8');
const harnessSelf = readFileSync(join(repoRoot, HARNESS_SELF), 'utf8');
const intentBlock =
  /\/\/ Resolve the URL against current registry truth\.([\s\S]*?)async function handlePackageFile/u.exec(
    marketTsx,
  )?.[1];
const macosOpenedArm =
  /tauri::RunEvent::Opened\s*\{\s*urls\s*\}\s*=>\s*\{([\s\S]*?)\n\s*\}/u.exec(libRs)?.[1] ?? '';

const h = createHarness('deep-link-install gate');
const { check } = h;

function match(source, target, name, pattern, detail) {
  check(name, pattern.test(source), detail ?? `expected ${pattern} in ${target}`);
}

function noMatch(source, target, name, pattern, detail) {
  check(name, !pattern.test(source), detail ?? `forbidden ${pattern} found in ${target}`);
}

console.log(`reading ${DEEP_LINK_RS}`);
console.log(`reading ${LIB_RS}`);
console.log(`reading ${PERMISSION_TOML}`);
console.log(`reading ${CAPABILITY_JSON}`);
console.log(`reading ${BRIDGE_TS}`);
console.log(`reading ${APP_TSX}`);
console.log(`reading ${MAIN_TSX}`);
console.log(`reading ${MARKET_TSX}`);

// --- 1) DeepLinkState cold-start queue / single drain / emit failure requeue ---
match(
  deepLinkRs,
  DEEP_LINK_RS,
  'DeepLinkState queues while renderer is not ready',
  /fn\s+queue_until_renderer_ready[\s\S]*?if\s+inner\.renderer_ready\s*\{[\s\S]*?return\s+Ok\(\s*false\s*\)[\s\S]*?inner\.pending\.push\(payload\)[\s\S]*?Ok\(\s*true\s*\)/u,
  'queue_until_renderer_ready must push pending when renderer_ready is false',
);

match(
  bridgeTs,
  BRIDGE_TS,
  'pending intent renders a declarative accessible notice',
  /if\s*\(\s*!intent\s*\)\s*return\s+null[\s\S]*?<aside\s+className="off-deep-link-notice off-icard"\s+role="status"\s+aria-live="polite"/u,
  'the notice must render directly from pending state without an imperative toast subscription',
);
noMatch(
  bridgeTs,
  BRIDGE_TS,
  'deep-link notice does not depend on Sonner or animation timing',
  /from\s+['"]sonner['"]|requestAnimationFrame|setToasterReady|useToasterReady/u,
  'pending deep-link truth must stay visible without a transient notification bus or timing delay',
);
match(
  deepLinkRs,
  DEEP_LINK_RS,
  'pending queue is bounded and deduplicated',
  /MAX_PENDING_INSTALLS[\s\S]*?inner\.pending\.iter\(\)\.any[\s\S]*?inner\.pending\.len\(\)\s*>=\s*MAX_PENDING_INSTALLS/u,
  'external URLs must not create an unbounded or duplicate pending queue',
);
match(
  deepLinkRs,
  DEEP_LINK_RS,
  'mark_renderer_ready drains pending once via mem::take',
  /fn\s+mark_renderer_ready[\s\S]*?inner\.renderer_ready\s*=\s*true[\s\S]*?Ok\(\s*std::mem::take\(\s*&mut\s+inner\.pending\s*\)\s*\)/u,
  'mark_renderer_ready must set ready and drain pending with std::mem::take',
);
noMatch(
  deepLinkRs,
  DEEP_LINK_RS,
  'missing target never broadcasts install intent',
  /app\.emit\(\s*"deep-link-install"/u,
  'install intent must target the main window or requeue, never broadcast',
);
noMatch(
  deepLinkRs,
  DEEP_LINK_RS,
  'rejection log does not include raw URL',
  /Ignoring unrecognized deep link:\s*\{raw\}/u,
  'untrusted query data must not be written to logs',
);
match(
  deepLinkRs,
  DEEP_LINK_RS,
  'deep_link_mark_renderer_ready command drains via mark_renderer_ready',
  /#\[tauri::command\][\s\S]*?fn\s+deep_link_mark_renderer_ready[\s\S]*?state\.mark_renderer_ready\(\)/u,
  'command must call state.mark_renderer_ready()',
);
match(
  cargoToml,
  CARGO_TOML,
  'single-instance plugin enables deep-link integration',
  /tauri-plugin-single-instance\s*=\s*\{[^}]*features\s*=\s*\[\s*"deep-link"\s*\]/u,
  'desktop second-instance URL delivery requires the official deep-link feature',
);
match(
  libRs,
  LIB_RS,
  'cold start drains plugin get_current after live listener registration',
  /on_open_url[\s\S]*?deep_link\(\)\.get_current\(\)[\s\S]*?handle_deep_link_urls/u,
  'cold-start URLs must be read with get_current and enter the validated queue',
);
match(
  libRs,
  LIB_RS,
  'macOS Opened arm handles deep links under cfg(macos)',
  /#\[cfg\(target_os\s*=\s*"macos"\)\]\s*tauri::RunEvent::Opened\s*\{\s*urls\s*\}\s*=>\s*\{[\s\S]*?deep_link::handle_deep_link_urls\(\s*app\s*,\s*urls\s*\)/u,
  '#[cfg(target_os = "macos")] must immediately guard RunEvent::Opened { urls } calling handle_deep_link_urls(app, urls)',
);
noMatch(
  macosOpenedArm,
  LIB_RS,
  'macOS Opened arm does not create or reactivate the main window',
  /ensure_main_window|set_activation_policy/u,
  'cold Opened arrives before Tauri finishes creating configured windows, so this arm must only queue URLs',
);
match(
  libRs,
  LIB_RS,
  'plugin on_open_url bridge remains live on macOS',
  /deep_link\(\)\.on_open_url[\s\S]*?handle_deep_link_urls/u,
  'on_open_url must remain registered on macOS for URLs delivered after setup',
);
match(
  libRs,
  LIB_RS,
  'plugin get_current cold drain is cfg(not macos)',
  /#\[cfg\(not\(target_os\s*=\s*"macos"\)\)\]\s*\{[\s\S]*?deep_link\(\)\.get_current\(\)[\s\S]*?handle_deep_link_urls/u,
  'get_current must be guarded by #[cfg(not(target_os = "macos"))] because macOS cold URLs enter through RunEvent::Opened',
);
match(
  deepLinkRs,
  DEEP_LINK_RS,
  'emit failure requeues and clears ready',
  /fn\s+requeue_after_emit_failure[\s\S]*?inner\.renderer_ready\s*=\s*false[\s\S]*?inner\.pending\.push\(payload\)/u,
  'requeue_after_emit_failure must mark not-ready and push the payload back',
);
match(
  deepLinkRs,
  DEEP_LINK_RS,
  'handle_deep_link_urls requeues on emit Err',
  /if\s+let\s+Err\(e\)\s*=\s+emit_result\s*\{[\s\S]*?state\.requeue_after_emit_failure\(payload\)/u,
  'emit Err path must call requeue_after_emit_failure',
);
match(
  deepLinkRs,
  DEEP_LINK_RS,
  'unit test asserts handshake drains once then emits live',
  /fn\s+renderer_handshake_drains_pending_intents_once[\s\S]*?mark_renderer_ready\(\)[\s\S]*?Ok\(Vec::new\(\)\)[\s\S]*?queue_until_renderer_ready\(payload\),\s*Ok\(false\)/u,
  'Rust test must prove first drain returns pending and later queues return false',
);

// --- 2) lib.rs manage / command / PageLoad Started not-ready ---
match(
  libRs,
  LIB_RS,
  'lib.rs manages DeepLinkState',
  /\.manage\(\s*deep_link::DeepLinkState::default\(\)\s*\)/u,
  'DeepLinkState must be managed on the Tauri builder',
);
match(
  libRs,
  LIB_RS,
  'lib.rs registers deep_link_mark_renderer_ready',
  /deep_link::deep_link_mark_renderer_ready\s*,/u,
  'invoke handler must register deep_link_mark_renderer_ready',
);
match(
  libRs,
  LIB_RS,
  'PageLoad Started marks renderer not-ready',
  /PageLoadEvent::Started[\s\S]*?deep_link::mark_renderer_not_ready\(\s*webview\.app_handle\(\)\s*\)/u,
  'main webview PageLoad Started must call mark_renderer_not_ready',
);

// --- 2b) Dedicated ACL for deep_link_mark_renderer_ready ---
match(
  permissionToml,
  PERMISSION_TOML,
  'permission identifier is deep-link-install',
  /^\[\[permission\]\]\s*\nidentifier\s*=\s*"deep-link-install"/mu,
  'permission file must declare identifier deep-link-install',
);
match(
  permissionToml,
  PERMISSION_TOML,
  'permission allowlist is exactly deep_link_mark_renderer_ready',
  /commands\.allow\s*=\s*\[\s*"deep_link_mark_renderer_ready"\s*\]/u,
  'deep-link-install permission must allow only deep_link_mark_renderer_ready',
);
match(
  capabilityJson,
  CAPABILITY_JSON,
  'capability identifier is offisim:deep-link-install',
  /"identifier"\s*:\s*"offisim:deep-link-install"/u,
  'capability must use identifier offisim:deep-link-install',
);
match(
  capabilityJson,
  CAPABILITY_JSON,
  'capability targets main and main-live only',
  /"webviews"\s*:\s*\[\s*"main"\s*,\s*"main-live"\s*\]/u,
  'capability must target only main and main-live webviews',
);
match(
  capabilityJson,
  CAPABILITY_JSON,
  'capability grants only deep-link-install',
  /"permissions"\s*:\s*\[\s*"deep-link-install"\s*\]/u,
  'capability must grant only the deep-link-install permission',
);

// --- 3) parse_install_url contract ---
match(
  deepLinkRs,
  DEEP_LINK_RS,
  'parse_install_url bounds the raw URL length',
  /fn\s+parse_install_url[\s\S]*?raw\.len\(\)\s*>\s*512[\s\S]*?return\s+None/u,
  'untrusted install URLs must be rejected before parsing when over 512 bytes',
);
match(
  deepLinkRs,
  DEEP_LINK_RS,
  'parse_install_url requires offisim scheme',
  /fn\s+parse_install_url[\s\S]*?url\.scheme\(\)\s*!=\s*"offisim"/u,
  'only offisim:// URLs may parse as install intents',
);
match(
  deepLinkRs,
  DEEP_LINK_RS,
  'parse_install_url requires install host',
  /fn\s+parse_install_url[\s\S]*?host\s*!=\s*"install"/u,
  'host must be install (offisim://install)',
);
match(
  deepLinkRs,
  DEEP_LINK_RS,
  'parse_install_url validates listing_id as UUID',
  /fn\s+parse_install_url[\s\S]*?!is_uuid\(\s*&listing_id\s*\)/u,
  'listing_id must pass is_uuid',
);
match(
  deepLinkRs,
  DEEP_LINK_RS,
  'parse_install_url validates version as SemVer',
  /fn\s+parse_install_url[\s\S]*?semver::Version::parse\(\s*&version\s*\)\.is_err\(\)/u,
  'version must parse as SemVer',
);
match(
  deepLinkRs,
  DEEP_LINK_RS,
  'parse_install_url rejects duplicate listing_id/version params',
  /"listing_id"\s*\|\s*"version"\s*=>\s*return\s+None/u,
  'duplicate listing_id or version query keys must return None',
);
match(
  deepLinkRs,
  DEEP_LINK_RS,
  'parse_install_url rejects unknown query params',
  /"listing_id"\s*\|\s*"version"\s*=>\s*return\s+None,?\s*_\s*=>\s*return\s+None/u,
  'unknown query keys must not be silently accepted',
);

// --- 4) TS initialize: listen then ready; UUID/SemVer defense ---
match(
  bridgeTs,
  BRIDGE_TS,
  'initialize listens deep-link-install before ready invoke',
  /await\s+listen<unknown>\(\s*['"]deep-link-install['"][\s\S]*?await\s+invokeCommand\(\s*['"]deep_link_mark_renderer_ready['"]\s*\)/u,
  'listener must attach before deep_link_mark_renderer_ready so cold-start drain is safe',
);
match(
  bridgeTs,
  BRIDGE_TS,
  'payload parser enforces UUID',
  /const\s+UUID\s*=\s*\/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}\$\/iu[\s\S]*?!UUID\.test\(\s*payload\.listing_id\s*\)/u,
  'parseDeepLinkInstallPayload must reject non-UUID listing_id',
);
match(
  bridgeTs,
  BRIDGE_TS,
  'payload parser enforces SemVer',
  /const\s+SEMVER\s*=[\s\S]*?!SEMVER\.test\(\s*payload\.version\s*\)/u,
  'parseDeepLinkInstallPayload must reject non-SemVer version',
);

// --- 5) App mounts navigator; main starts bridge ---
match(
  appTsx,
  APP_TSX,
  'App mounts DeepLinkInstallNavigator',
  /<DeepLinkInstallNavigator\s*\/>/u,
  'App must render DeepLinkInstallNavigator',
);
match(
  mainTsx,
  MAIN_TSX,
  'main starts initializeDeepLinkInstallBridge',
  /void\s+initializeDeepLinkInstallBridge\(\s*\)\s*;/u,
  'renderer entry must start the deep-link install bridge',
);

// --- 6) Market exact version + review path; bridge never confirms install ---
match(
  marketTsx,
  MARKET_TSX,
  'Market resolves the authoritative listing by id',
  /useMarketListingById\(companyId,\s*deepLinkInstallIntent\?\.listing_id\)/u,
  'deep-link resolution must not depend on the paginated browse list',
);
match(
  marketQueries,
  MARKET_QUERIES,
  'listing-id query calls the direct registry detail endpoint',
  /loadRegistryListingById[\s\S]*?getListingDetail\(listingId\)/u,
  'a visible listing beyond the browse page must still resolve by exact id',
);
match(
  platformMarket,
  PLATFORM_MARKET,
  'direct listing detail includes verified artifact metadata',
  /artifact:\s*latestVersion[\s\S]*?artifact_url:\s*latestVersion\.artifact_url[\s\S]*?artifact_sha256:\s*latestVersion\.artifact_sha256/u,
  'direct detail must return the same latest artifact metadata used by install review',
);
match(
  marketTsx,
  MARKET_TSX,
  'Market requires exact version match',
  /listing\.version\s*!==\s*deepLinkInstallIntent\.version/u,
  'version mismatch must be an explicit rejection branch',
);
match(
  marketTsx,
  MARKET_TSX,
  'version mismatch says Nothing was installed',
  /Nothing was installed\./u,
  'mismatch toast must state Nothing was installed',
);
match(
  intentBlock ?? '',
  MARKET_TSX,
  'matching deep link opens detail for explicit review',
  /consumeDeepLinkInstallIntent\(deepLinkInstallIntent\.intentId\);\s*openDetail\(listing\)/u,
  'success path must stop at Market detail until the user clicks Install',
);
noMatch(
  intentBlock ?? '',
  MARKET_TSX,
  'deep-link intent block never prepares or confirms install',
  /\b(openInstall|prepareRegistryInstall|confirmPackageInstall|mutateAsync)\b/u,
  'a URL may open detail but must not download, import, or materialize a package',
);
match(
  marketTsx,
  MARKET_TSX,
  'MarketSurface mounts InstallDialog',
  /<InstallDialog\b/u,
  'InstallDialog must remain the permission/binding review UI',
);
noMatch(
  bridgeTs,
  BRIDGE_TS,
  'bridge does not call confirm install mutation',
  /\b(useConfirmPackageInstall|confirmPackageInstall|mutateAsync)\b/u,
  'DeepLinkInstallBridge must never confirm installation itself',
);
match(
  bridgeTs,
  BRIDGE_TS,
  'navigator comment forbids direct install',
  /a deep link never installs directly/u,
  'DeepLinkInstallNavigator must document review-only ownership',
);
match(
  bridgeTs,
  BRIDGE_TS,
  'navigator keeps an explicit persistent review notice',
  /<aside[\s\S]*?Install link received[\s\S]*?<Button\s+size="sm"[\s\S]*?>\s*Open Market\s*<\/Button>/u,
  'the user must explicitly choose Open Market before the pending intent is reviewed',
);
match(
  bridgeTs,
  BRIDGE_TS,
  'navigator opens Market only from the explicit action callback',
  /<Button\s+size="sm"\s+onClick=\{\(\)\s*=>\s*setSurface\(\s*['"]market['"]\s*\)\}>\s*Open Market/u,
  'setSurface(market) must be nested under the explicit Open Market action',
);
check(
  'navigator has exactly one Market navigation call',
  (bridgeTs.match(/setSurface\(\s*['"]market['"]\s*\)/gu) ?? []).length === 1,
  'additional Market navigation calls could bypass the explicit review action',
);

// --- 7) This harness must stay static: no app launch / network ---
match(
  harnessSelf,
  HARNESS_SELF,
  'harness only imports fs/path/harness-runner',
  /^import\s+\{\s*readFileSync\s*\}\s+from\s+['"]node:fs['"];\s*\nimport\s+\{\s*join\s*\}\s+from\s+['"]node:path['"];\s*\nimport\s+\{\s*createHarness,\s*repoRoot\s*\}\s+from\s+['"]\.\/lib\/harness-runner\.mjs['"];/mu,
  'deep-link harness must stay file-static (fs + path + harness-runner only)',
);
noMatch(
  harnessSelf,
  HARNESS_SELF,
  'harness has no child_process import',
  /from\s+['"]node:child_process['"]|require\(\s*['"](?:node:)?child_process['"]\s*\)/u,
  'deep-link harness must not import child_process',
);
noMatch(
  harnessSelf,
  HARNESS_SELF,
  'harness has no http/https/net import',
  /from\s+['"]node:(?:http|https|net|undici)['"]/u,
  'deep-link harness must not import network modules',
);

console.log(`\n${h.checks - h.failures}/${h.checks} checks passed`);
if (h.failures > 0) {
  console.error(`deep-link-install gate FAILED (${h.failures} failing)`);
} else {
  console.log('deep-link-install gate OK');
}
h.report();
