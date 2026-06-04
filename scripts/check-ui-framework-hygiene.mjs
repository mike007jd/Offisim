#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

const SOURCE_DIRS = [
  'apps/desktop/renderer/src',
  'apps/desktop/src-tauri/src',
  'apps/platform/src',
  'packages',
  'Docs/design',
];

const PRIMITIVE_DIR = 'apps/desktop/renderer/src/design-system/primitives';

const SOURCE_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.jsx',
  '.md',
  '.mjs',
  '.mts',
  '.rs',
  '.ts',
  '.tsx',
]);

const SKIP_SEGMENTS = new Set(['dist', 'target', 'node_modules']);

const checks = [
  {
    label: 'native select element',
    dirs: ['apps/desktop/renderer/src', 'Docs/design'],
    pattern: /<select\b/,
  },
  {
    label: 'native datalist suggestions',
    dirs: ['apps/desktop/renderer/src'],
    pattern: /<datalist\b|<option\b|\blist=["'{]/,
  },
  {
    label: 'design source raw select element/selector',
    dirs: ['Docs/design'],
    pattern: /<\/?select\b|<option\b|,\s*select\b|^\s*select[.#\s:{]|native select/i,
  },
  {
    label: 'design source raw textarea element/selector',
    dirs: ['Docs/design'],
    pattern: /<\/?textarea\b|,\s*textarea\b|^\s*textarea[.#\s:{]/m,
  },
  {
    label: 'hand-authored tab role',
    dirs: ['apps/desktop/renderer/src', 'Docs/design'],
    pattern: /role=["']tab(list)?["']/,
  },
  {
    label: 'Tailwind tracking utility',
    dirs: ['apps/desktop/renderer/src', 'Docs/design'],
    pattern: /tracking-(widest|wide|tight|tighter)|tracking-\[/,
  },
  {
    label: 'stale wired/unwired engineering copy',
    dirs: [
      'apps/desktop/renderer/src',
      'apps/platform/src',
      'packages/core/src',
      'packages/doc-engine',
      'Docs/design',
    ],
    pattern: /\b(unwired|not wired|wired yet)\b|until .*wired|\bwired\b/i,
    excludeFiles: ['packages/doc-engine/CLAUDE.md'],
  },
  {
    label: 'retired SOP/Kanban/Docs/Board surface',
    dirs: SOURCE_DIRS,
    pattern:
      /\b(SOP|Kanban|DocsApp|BoardView|BoardTask|useBoardTasks)\b|\bsop[-_]|\bkind:\s*['"]sop['"]|package_id:\s*['"][^'"]*\.sop\.|\/board|\/kanban|project board|queue board|hero board/i,
  },
  {
    label: 'retired Office Live run-axis surface',
    dirs: ['apps/desktop/renderer/src'],
    pattern:
      /\b(LiveRunAxis|StageRunAxis|stageRunAxis|toggleStageRunAxis|setStageRunAxis)\b|off-live\b|off-stage-live(?!dot)|off-stage-overlay|off-stage-runaxis|off-stage-entry|Live run-axis|Open Live|run axis/,
  },
  {
    label: 'retired Office design stage Board/Live run-axis',
    dirs: [
      'Docs/design/offisim-office-layout-v3-prototype.html',
      'Docs/design/offisim-states-prototype.html',
    ],
    pattern:
      /stage-runaxis|stage-entry|data-queue-toggle|RunStatusQueue|Board\s*[—-]\s*persistent stage entry|Live\s*[—-]\s*run broadcast|stage 'Live'|Live overlay|Board vs Live|run-axis|run axis/,
  },
  {
    label: 'retired design Plans app entry',
    dirs: ['Docs/design'],
    pattern:
      /<button[^>\n]*>(?:<svg[^>]*>[\s\S]{0,80}<\/svg>)?Plans<\/button>|Switch to Plans|Reusable process DAGs|Office\/Plans\/Market|Office \/ Plans \/ Market|Follow company Plans/,
  },
  {
    label: 'states design fake recovery/abort controls',
    dirs: ['Docs/design/offisim-states-prototype.html'],
    pattern:
      /Retry with same configuration|Re-dispatch task|Swap person|Swap model|Change LLM model|Stop execution|<button class="(?:pp-stop|sp-stop)|onSwapPerson|onSwapModel|onRetry|Select employee|no Retry \/ Swap/,
  },
  {
    label: 'workspace file row without action',
    dirs: ['apps/desktop/renderer/src/surfaces/office'],
    pattern: /<button\b(?=[\s\S]{0,500}off-tree-row)(?![\s\S]{0,500}onClick=)[\s\S]{0,500}>/,
  },
  {
    label: 'raw chat composer textarea',
    dirs: ['apps/desktop/renderer/src/assistant', 'apps/desktop/renderer/src/surfaces/workspace'],
    pattern: /<(textarea|Textarea)\b/,
  },
  {
    label: 'workspace chat disabled attachment picker',
    dirs: [
      'apps/desktop/renderer/src/assistant/OfficeThread.tsx',
      'apps/desktop/renderer/src/surfaces/workspace/apps/WorkspaceAssistantThread.tsx',
      'Docs/design/offisim-states-prototype.html',
    ],
    pattern:
      /Attach file unavailable|Workspace chat attachments need the desktop attachment store|disabled=\{!storageAvailable\}|storage unavailable in this browser window|try a non-private window|!storageAvailable[\s\S]{0,160}paperclip[\s\S]{0,160}disabled/,
  },
  {
    label: 'workspace chat fake disabled controls',
    dirs: ['apps/desktop/renderer/src/surfaces/workspace/apps'],
    pattern:
      /Mention unavailable|Conversation search unavailable|Start meeting unavailable|Members unavailable|More actions unavailable|No additional conversation actions are available|Mark all read unavailable|New chat unavailable|Pin artifact unavailable|System actions require a connected workflow target/,
  },
  {
    label: 'workspace contacts fake direct-chat button',
    dirs: [
      'apps/desktop/renderer/src/surfaces/workspace/apps/ContactsApp.tsx',
      'Docs/design/offisim-workspace-prototype.html',
    ],
    pattern:
      /No direct chat exists for this contact|<button[\s\S]{0,260}disabled[\s\S]{0,260}Direct chat|Direct chat[\s\S]{0,180}disabled/,
  },
  {
    label: 'teamdock fake disabled employee-message button',
    dirs: ['apps/desktop/renderer/src/surfaces/office/TeamDock.tsx'],
    pattern: /disabled=\{!thread\}[\s\S]{0,160}Message|Message[\s\S]{0,160}disabled=\{!thread\}/,
  },
  {
    label: 'retired Workspace Docs/More rail',
    dirs: [
      'apps/desktop/renderer/src/surfaces/workspace',
      'Docs/design/offisim-workspace-prototype.html',
    ],
    pattern:
      /No additional workspace apps are available|<span class="lab">(Docs|More)<\/span>|Docs · deliverables library|Chat \(messages\) \/ Files \(attachments shared here\) \/ Docs|Docs tab|Files\/Docs|doc \/ board/,
  },
  {
    label: 'hardcoded market outage detail',
    dirs: [
      'apps/desktop/renderer/src/surfaces/market',
      'Docs/design/offisim-market-prototype.html',
    ],
    pattern: /503 Service Unavailable|platform\s*:\d{2,5}/,
  },
  {
    label: 'fake registry token affordance',
    dirs: [
      'apps/desktop/renderer/src/surfaces/market',
      'Docs/design/offisim-market-prototype.html',
    ],
    pattern:
      /Paste registry token to publish|Publishing as @offisim-labs|Registry authentication is unavailable in this build/,
  },
  {
    label: 'market design fake community/update actions',
    dirs: ['Docs/design/offisim-market-prototype.html'],
    pattern:
      /Rating & Report — deferred placeholders|disabled stub|coming soon|stub-btn|placeholder rows|no origin → disabled|disabled when no <code>origin_listing_id<\/code>|workspace side panel|<button class="mbtn" disabled><svg class="ico"><use href="#i-cloud-up"\/><\/svg>Submit<\/button>/,
  },
  {
    label: 'market active stale disabled copy',
    dirs: [
      'apps/desktop/renderer/src/surfaces/market',
      'Docs/design/offisim-market-prototype.html',
    ],
    pattern:
      /Check disabled|Featured cards span two columns in the grid|mkt-card\.featured|grid-column: span 2/,
  },
  {
    label: 'market active preview-only catalog copy',
    dirs: ['apps/desktop/renderer/src/surfaces/market'],
    pattern: /preview-only|preview only|catalog row is preview/i,
  },
  {
    label: 'market detail fake version selector',
    dirs: ['apps/desktop/renderer/src/surfaces/market/MarketDetail.tsx'],
    pattern: /setVersion|DropdownMenuTrigger[\s\S]{0,220}off-vsel|onSelect=\{\(\) => setVersion/,
  },
  {
    label: 'market installed update check fixed-null fallback',
    dirs: [
      'apps/desktop/renderer/src/surfaces/market',
      'Docs/design/offisim-market-prototype.html',
    ],
    pattern:
      /manual update checks|Update is held until registry auth is connected|function\s+installedPackageToVm[\s\S]{0,420}latestVersion:\s*null/,
  },
  {
    label: 'market publish fixed draft history',
    dirs: ['apps/desktop/renderer/src/surfaces/market/PublishDialog.tsx'],
    pattern: /Registry not connected/,
  },
  {
    label: 'market hardcoded publish source fixture',
    dirs: ['apps/desktop/renderer/src/surfaces/market'],
    pattern:
      /const\s+(publishSources\s*:\s*PublishSource\[\]|publishedDrafts\s*:\s*PublishedDraft\[\])\s*=/,
  },
  {
    label: 'fake disabled unavailable action buttons',
    dirs: [
      'apps/desktop/renderer/src/assistant',
      'apps/desktop/renderer/src/surfaces/market',
      'apps/desktop/renderer/src/surfaces/office',
      'apps/desktop/renderer/src/surfaces/personnel',
      'apps/desktop/renderer/src/surfaces/settings',
      'apps/desktop/renderer/src/surfaces/workspace',
    ],
    pattern:
      /Registry auth unavailable; (update checks|package updates|draft editing|draft submission|draft deletion)|Registry authentication is not connected in this build|PR unavailable|Commit unavailable|Delegate unavailable|Meeting creation requires the calendar scheduling backend|Action item completion needs (calendar|meeting) persistence|Run retry needs persisted redispatch state|Person swap needs persisted redispatch state|Stage-level stop needs provider abort support|Provider profile creation requires the runtime profile editor flow|off-md-install is-installed" disabled|<Button[\s\S]{0,80}disabled[\s\S]{0,30}Close|Approval resolution requires a connected runtime interaction target|Grant scope changes need approval-resolution persistence|Runtime binding needs employee runtime-profile persistence|Browser vault mounting is unavailable in the desktop release|No browser vault directory is mounted/,
  },
  {
    label: 'provider registry static/pending fallback',
    dirs: ['apps/desktop/renderer/src/surfaces/settings'],
    pattern:
      /Runtime profile editor pending|PROVIDER_CONFIGS\.find\(\s*\([^)]*\)\s*=>[\s\S]{0,160}activeConfigId[\s\S]{0,160}runtime_provider_profile_upsert/,
  },
  {
    label: 'visible provider-source catalog ingestion copy',
    dirs: ['apps/desktop/renderer/src/surfaces/settings', 'Docs/design'],
    pattern:
      /provider-source|provider source|source-registry|source registry|catalog ingestion|remote catalog/i,
  },
  {
    label: 'settings desktop vault web-disabled stub',
    dirs: [
      'apps/desktop/renderer/src/surfaces/settings',
      'Docs/design/offisim-settings-prototype.html',
    ],
    pattern:
      /browser live-sync stays disabled|Browser mount is not part of desktop release|No mounted browser directory|VaultDirectorySection — web \(disabled stub\)|Download desktop app →|renders disabled variant when <code>!isTauri\(\)<\/code>|disabled vault<\/b> on web|vault-card disabled/,
  },
  {
    label: 'Personnel failed retry fake button',
    dirs: [
      'apps/desktop/renderer/src/surfaces/personnel',
      'Docs/design/offisim-personnel-prototype.html',
    ],
    pattern:
      /Employee retry requires runtime recovery wiring|runtime\.retryEmployee|failed row gets a Retry chip|<button[\s\S]{0,180}off-pers-retry-chip|<span class="retry-chip"[\s\S]{0,120}>Retry/,
  },
  {
    label: 'residual fake disabled surface controls',
    dirs: [
      'apps/desktop/renderer/src/surfaces/market',
      'apps/desktop/renderer/src/surfaces/office',
      'apps/desktop/renderer/src/surfaces/settings',
      'apps/desktop/renderer/src/surfaces/studio',
    ],
    pattern:
      /Add deliverable requires runtime artifact creation|placeholder="Registry auth unavailable"|Edit profile in Personnel"[\s\S]{0,160}disabled|<Button[\s\S]{0,80}disabled[\s\S]{0,80}Desktop layout required/,
  },
  {
    label: 'external employee session-only fallback',
    dirs: ['apps/desktop/renderer/src/surfaces/settings/ExternalEmployeesPane.tsx'],
    pattern:
      /session-external-|browser session|sessionEmployees|hiddenSessionIds|createSessionExternalEmployeeId|Token staged for this browser session|removed from browser session/,
  },
  {
    label: 'office design fake git/output controls',
    dirs: ['Docs/design/offisim-office-layout-v3-prototype.html'],
    pattern:
      /Commit selected files|Open compare|gw-textarea|gw-commit-btn|gw-pr-btn|Save-as-Plan|No Outputs Yet|<button class="dlv-btn">(Open|Download|Preview|Export)<\/button>|Save to Files|plan-promoted|DOCX<svg|file artifact: Download/,
  },
  {
    label: 'office design fake provider/recovery controls',
    dirs: ['Docs/design/offisim-office-layout-v3-prototype.html'],
    pattern:
      /Model switcher — cascading menu|Provider ▸ Model|Closed-state click[\s\S]{0,100}cycles think level|<span>Kimi<\/span>|<span>Gemini<\/span>|Confirm disabled until Retry|<button class="mp-btn outline" disabled>Resume<\/button>|Retry replays the failed turn|Swap Person|Swap Model/,
  },
  {
    label: 'lifecycle design stale output plan controls',
    dirs: ['Docs/design/offisim-lifecycle-prototype.html'],
    pattern:
      /PitchHall Outputs|right-rail Outputs panel|No outputs yet|save them as Plans|promoted Plan|<button class="a">(Preview|Export|Download)<\/button>|Save as Plan|onSaveAsSop|SopDefinition|plan\.template\.created|FileOutput \+ "No outputs yet"/,
  },
  {
    label: 'lifecycle browser-preview mutation success',
    dirs: ['apps/desktop/renderer/src/surfaces/lifecycle'],
    pattern: /Renamed in browser preview|Archived in browser preview|renamedNames|archivedIds/,
  },
  {
    label: 'release manage fixture fallback',
    dirs: [
      'apps/desktop/renderer/src/surfaces/settings',
      'apps/desktop/renderer/src/surfaces/market',
    ],
    pattern:
      /if\s*\(\s*!repos\s*\|\|\s*!companyId\s*\)\s*return\s+resolveAsync\((EXTERNAL_EMPLOYEES_FIXTURE|installedPackagesFixture)\)/,
  },
  {
    label: 'silent companyless persisted false mutation',
    dirs: ['apps/desktop/renderer/src/data'],
    pattern: /if\s*\(\s*!repos\s*\|\|\s*!companyId\s*\)\s*return\s+\{\s*persisted:\s*false/,
  },
  {
    label: 'Studio zone save without persisted check',
    dirs: ['apps/desktop/renderer/src/surfaces/studio'],
    pattern: /^\s*await\s+updateZone\.mutateAsync/m,
  },
  {
    label: 'timestamp-backed provider request id',
    dirs: ['apps/desktop/renderer/src'],
    pattern: /provider-test-[^`'"]*Date\.now|requestId:\s*`[^`]*Date\.now\(/,
  },
  {
    label: 'timestamp-backed Studio placement commit id',
    dirs: ['apps/desktop/renderer/src'],
    pattern:
      /commitId:\s*Date\.now\(|commitId:\s*0\b|readonly commitId:\s*number|lastCommitIdRef\s*=\s*useRef\(0\)/,
  },
  {
    label: 'timestamp-backed runtime identity',
    dirs: ['apps/desktop/renderer/src', 'packages/core/src', 'apps/platform/src'],
    pattern:
      /event_id:\s*`[^`]*Date\.now\(|meeting-solo-warn-\$\{Date\.now\(\)\}|Date\.now\(\)\.toString\(36\)/,
  },
  {
    label: 'JSX direct visual color/background',
    dirs: ['apps/desktop/renderer/src'],
    pattern: /style=\{\{[^}\n]*(background|color|fontSize)\s*:/,
  },
  {
    label: 'JSX direct pointer-events style',
    dirs: ['apps/desktop/renderer/src'],
    pattern: /style=\{\{[^}\n]*pointerEvents\s*:/,
  },
  {
    label: 'hand-rolled Office run progress bar',
    dirs: ['apps/desktop/renderer/src/assistant', 'apps/desktop/renderer/src/surfaces/office'],
    pattern: /off-pipe-bar-fill|style=\{\{[^}\n]*width:\s*`?\$\{[^}\n]*stepDone/,
  },
  {
    label: 'browser-native feedback dialog',
    dirs: ['apps/desktop/renderer/src'],
    pattern: /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/,
  },
  {
    label: 'unapproved motion package import',
    dirs: ['apps/desktop/renderer/src'],
    pattern:
      /from ['"](?:framer-motion|@react-spring\/[^'"]+|gsap|animejs)['"]|require\(['"](?:framer-motion|@react-spring\/[^'"]+|gsap|animejs)['"]\)/,
  },
  {
    label: 'raw active CSS micro typography/radius/motion',
    dirs: ['apps/desktop/renderer/src'],
    pattern:
      /font-size:\s*(?:7\.5|8\.5|9|9\.5|10|10\.5|12|19)px|font-size:\s*0\.9em|border-radius:\s*(?:4px|50%|999px|26%)|z-index:\s*(?:[1-9]\d*)|transition:\s*[^;]*(?:0\.14s|60ms|\sease(?:[;,]|\s))|animation:\s*[^;]*(?:0\.8s|0\.9s|1\.2s|1\.4s|1\.6s|3s|ease-in-out|\sease(?:\s|;)|\slinear(?:\s|;))/,
    excludeFiles: [
      'apps/desktop/renderer/src/styles/tokens.css',
      'apps/desktop/renderer/src/styles/motion.css',
    ],
  },
  {
    label: 'inline dynamic gradient expression',
    dirs: ['apps/desktop/renderer/src'],
    pattern: /linear-gradient\([^`]*\$\{/,
  },
  {
    label: 'raw MiniMax-style secret',
    dirs: SOURCE_DIRS.concat(['feedbacks', 'README.md', 'CLAUDE.md', 'AGENTS.md']),
    pattern: /sk-cp-[A-Za-z0-9_-]{20,}/,
  },
  {
    label: 'stale design-source MiniMax fixture copy',
    dirs: ['Docs/design'],
    pattern: /MiniMax|MiniMax-M2\.7|MiniMax · M2\.7|MiniMax-M2\.7-highspeed/,
    excludeFiles: ['Docs/design/offisim-settings-prototype.html'],
  },
  {
    label: 'non-settings provider-specific UI copy',
    dirs: ['apps/desktop/renderer/src'],
    pattern: /MiniMax|MiniMax-M2\.7|MiniMax · M2\.7|MiniMax-M2\.7-highspeed/,
    excludePrefixes: [
      'apps/desktop/renderer/src/surfaces/settings/',
      'apps/desktop/renderer/src/lib/provider-bridge.ts',
      // Provider-aware transport/runtime plumbing (not user-facing copy): these
      // map provider profiles onto transport schemes and filter provider stream
      // quirks, so they must name providers. Same exemption as provider-bridge.
      'apps/desktop/renderer/src/lib/tauri-llm-fetch.ts',
      'apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts',
      'apps/desktop/renderer/src/assistant/runtime/desktop-chat-runtime.ts',
    ],
  },
  {
    label: 'chat model chip fixture-provider fallback',
    dirs: [
      'apps/desktop/renderer/src/surfaces/office/ChatRail.tsx',
      'apps/desktop/renderer/src/surfaces/workspace/apps/MessengerApp.tsx',
    ],
    pattern:
      /find\(\(config\) => config\.hasStoredKey\)\?\.model\s*\?\?\s*providerConfigs\.data\?\.\[0\]\?\.model/,
  },
  {
    label: 'credentialless default chat provider selection',
    dirs: ['apps/desktop/renderer/src/lib/provider-bridge.ts'],
    pattern:
      /find\(\(candidate\) => candidate\.(?:id === 'minimax'|displayName\.toLowerCase\(\)\.includes\('minimax'\))\)/,
  },
  {
    label: 'non-settings broad provider-specific UI copy',
    dirs: ['apps/desktop/renderer/src', 'Docs/design'],
    pattern: /\b(?:OpenAI|Claude|Anthropic|OpenRouter)\b|openai\/|anthropic\/|claude-|gpt-4|sonnet/,
    excludePrefixes: [
      'apps/desktop/renderer/src/surfaces/settings/',
      'apps/desktop/renderer/src/lib/provider-bridge.ts',
      'Docs/design/offisim-settings-prototype.html',
      // Provider-aware transport/runtime plumbing (not user-facing copy): the
      // credential-isolated gateway fetch shim and the provider→scheme mapping
      // legitimately reference Anthropic/OpenAI SDK shapes. Same exemption as
      // provider-bridge.
      'apps/desktop/renderer/src/lib/tauri-llm-fetch.ts',
      'apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts',
      'apps/desktop/renderer/src/assistant/runtime/desktop-chat-runtime.ts',
    ],
  },
  {
    label: 'market provider-specific binding fixture copy',
    dirs: [
      'apps/desktop/renderer/src/surfaces/market',
      'Docs/design/offisim-market-prototype.html',
    ],
    pattern:
      /provider\/model|openai\/gpt|anthropic\/claude|google\/gemini|gpt-4o|claude-sonnet|gemini-2\.5/i,
  },
  {
    label: 'settings runtime provider-branded lane copy',
    dirs: [
      'apps/desktop/renderer/src/surfaces/settings/RuntimePane.tsx',
      'apps/desktop/renderer/src/surfaces/settings/settings-data.ts',
      'Docs/design/offisim-settings-prototype.html',
    ],
    pattern:
      /Claude engine|Codex engine|claude-agent-sdk:driver|codex-agent-sdk:replacement|Unavailable until release evidence/,
  },
  {
    label: 'stale design-source window.confirm copy',
    dirs: ['Docs/design'],
    pattern: /window\.confirm/,
  },
];

const primitiveCheck = {
  label: 'primitive Tailwind arbitrary styling',
  dirs: [PRIMITIVE_DIR],
  pattern:
    /\[[^\]]*(px|rem|vh|vw|0\.98|brightness|shadow|size|var)|z-50|w-72|h-px|w-px|h-full w-\[|h-\[|w-\[|size-\[|rounded-\[|text-\[|bg-\[|border-\[|p[xy]?-\[|m[xy]?-\[|gap-\[|font-\[|tracking-/,
};

const activeTsxArbitraryVisualCheck = {
  label: 'active TSX arbitrary visual sizing',
  dirs: ['apps/desktop/renderer/src'],
  pattern:
    /(?:^|\s)(?:sm:)?(?:size|h|w|min-h|max-h|min-w|max-w|left|right|top|bottom|pl|pr|pt|pb|px|py|p|ml|mr|mt|mb|mx|my|m|gap|rounded|text|max-w)-\[(?![^\]]*var\()[^\]]*(?:px|rem|vh|vw|%|\d)[^\]]*\]/,
};

const activeTsxRawVisualValueCheck = {
  label: 'active TSX raw visual values',
  dirs: ['apps/desktop/renderer/src'],
  pattern:
    /(?:minSize|maxSize|collapsedSize)=["'][0-9]+px["']|ctx\.font\s*=\s*["'][^"']*[0-9]+px[^"']*["']/,
  excludeFiles: ['apps/desktop/renderer/src/styles/visual-tokens.ts'],
};

const RAW_HEX_ALLOWED_FILES = new Set([
  'apps/desktop/renderer/src/data/color-palette.ts',
  'apps/desktop/renderer/src/surfaces/office/scene/r3d/scene-colors.ts',
  'apps/desktop/renderer/src/styles/tokens.css',
]);

const runtimeCssVars = new Set([
  '--off-av-a',
  '--off-av-b',
  '--off-av-font-size',
  '--off-av-size',
  '--off-chip-dot',
  '--off-csp-avatar-a',
  '--off-csp-avatar-b',
  '--off-drag-x',
  '--off-drag-y',
  '--off-ext-brand-a',
  '--off-ext-brand-b',
  '--off-market-role',
  '--off-pers-swatch',
  '--off-provider-brand-a',
  '--off-provider-brand-b',
  '--off-scope-badge-a',
  '--off-scope-badge-b',
  '--off-wiz-role-accent',
]);

const requiredChecks = [
  {
    label: 'Office assistant-ui thread primitives',
    file: 'apps/desktop/renderer/src/assistant/OfficeThread.tsx',
    patterns: [
      /AssistantRuntimeProvider/,
      /ThreadPrimitive\.Root/,
      /ThreadPrimitive\.Messages/,
      /ComposerPrimitive\.Root/,
      /ComposerPrimitive\.Input/,
      /ComposerPrimitive\.Send/,
    ],
  },
  {
    label: 'Office assistant-ui message primitives',
    file: 'apps/desktop/renderer/src/surfaces/office/rail/MessageItem.tsx',
    patterns: [/MessagePrimitive\.Root/, /MessagePrimitive\.Parts/, /MessagePartPrimitive\.Text/],
  },
  {
    label: 'Workspace assistant-ui thread primitives',
    file: 'apps/desktop/renderer/src/surfaces/workspace/apps/WorkspaceAssistantThread.tsx',
    patterns: [
      /AssistantRuntimeProvider/,
      /useExternalStoreRuntime/,
      /ThreadPrimitive\.Root/,
      /ThreadPrimitive\.Messages/,
      /MessagePrimitive\.Root/,
      /MessagePrimitive\.Parts/,
      /MessagePartPrimitive\.Text/,
      /ComposerPrimitive\.Root/,
      /ComposerPrimitive\.Input/,
      /ComposerPrimitive\.Send/,
    ],
  },
  {
    label: 'Market registry install receipt',
    file: 'apps/desktop/renderer/src/surfaces/market/market-data.ts',
    patterns: [/reportRegistryInstallReceipt/, /\.reportInstall\(/, /installReceiptError/],
  },
  {
    label: 'Office chat pitbar stores secondary panels',
    file: 'apps/desktop/renderer/src/assistant/OfficeThread.tsx',
    patterns: [/className="off-thread-pitbar"/, /<MeetingTray \/>/, /<ConvOutputs /],
  },
  {
    label: 'Office chat compact tokenized composer',
    file: 'apps/desktop/renderer/src/surfaces/office/office.css',
    patterns: [
      /min-height:\s*var\(--off-composer-input-min\)/,
      /max-height:\s*var\(--off-composer-input-max\)/,
      /height:\s*var\(--off-composer-send-h\)/,
    ],
  },
  {
    label: 'Surface nav is single-registry-driven (nav-registry SSOT)',
    file: 'apps/desktop/renderer/src/app/nav-registry.ts',
    patterns: [
      /export const NAV_ENTRIES/,
      /key:\s*'office'/,
      /key:\s*'workspace'/,
      /key:\s*'market'/,
      /key:\s*'personnel'/,
      /key:\s*'activity'/,
      /key:\s*'settings'/,
      /key:\s*'studio'/,
      /export const PRIMARY_NAV/,
      /export const UTILITY_NAV/,
    ],
  },
  {
    label: 'IconBar consumes the nav registry (utilities not hardcoded)',
    file: 'apps/desktop/renderer/src/design-system/shell/IconBar.tsx',
    patterns: [/UTILITY_NAV\.map/],
  },
  {
    label: 'WorkspaceNav consumes the nav registry (primary not hardcoded)',
    file: 'apps/desktop/renderer/src/design-system/shell/WorkspaceNav.tsx',
    patterns: [/PRIMARY_NAV\.map/],
  },
  {
    label: 'Command palette consumes the nav registry (no separate surface list)',
    file: 'apps/desktop/renderer/src/app/CommandPalette.tsx',
    patterns: [/NAV_ENTRIES\.map/],
  },
  {
    label: 'Market install schema version',
    file: 'apps/desktop/renderer/src/surfaces/market/market-data.ts',
    patterns: [/schemaVersion:\s*'2026-03'/],
  },
  {
    label: 'Desktop runtime vault install commands',
    file: 'apps/desktop/src-tauri/permissions/agent-bridges.toml',
    patterns: [
      /"runtime_vault_read_file"/,
      /"runtime_vault_write_file"/,
      /"runtime_vault_list_dir"/,
      /"runtime_vault_stat"/,
      /"runtime_vault_remove"/,
      /"runtime_vault_mkdir"/,
    ],
  },
  {
    label: 'Market publish draft history query',
    file: 'apps/desktop/renderer/src/surfaces/market/MarketSurface.tsx',
    patterns: [/usePublishedDrafts/, /drafts=\{publishedDrafts\.data \?\? \[\]\}/],
  },
  {
    label: 'Market publish draft history renderer',
    file: 'apps/desktop/renderer/src/surfaces/market/PublishDialog.tsx',
    patterns: [/function DraftHistory/, /drafts: PublishedDraft\[\]/, /drafts\.slice\(0, 3\)/],
  },
  {
    label: 'Platform publish retired-kind guard',
    file: 'apps/platform/src/routes/publish.ts',
    patterns: [/isActiveDraftKind/, /RETIRED_DRAFT_KIND/, /ACTIVE_DRAFT_KIND_SET/],
  },
  {
    label: 'Platform publish draft kind schema',
    file: 'apps/platform/src/schemas/index.ts',
    patterns: [/DraftCreateSchema[\s\S]{0,240}z\.enum\(VALID_KINDS/, /Invalid draft kind/],
  },
  {
    label: 'Platform registry artifact URL port',
    file: 'apps/platform/src/services/artifacts.ts',
    patterns: [/process\.env\.PORT \?\? '4100'/],
  },
  {
    label: 'chat thread employee metadata schema',
    file: 'packages/shared-types/src/project.ts',
    patterns: [/employee_id: string \| null/, /employee_id\?: string \| null/],
  },
  // NOTE: the desktop no longer runs a chat_threads.employee_id ALTER migration.
  // The single-baseline schema (packages/db-local/src/schema.sql, since
  // ba7788c9) declares employee_id in the chat_threads CREATE TABLE and is
  // bootstrapped on startup, so no migration function exists or is needed. The
  // former 'desktop chat thread employee migration' assertion was stale and was
  // removed; the metadata-schema assertion above still gates the type.
];

function extensionOf(path) {
  const match = path.match(/(\.[^.]+)$/);
  return match ? match[1] : '';
}

function shouldSkip(path) {
  return path.split('/').some((segment) => SKIP_SEGMENTS.has(segment) || segment.endsWith('.app'));
}

function collectFiles(entry) {
  const abs = join(ROOT, entry);
  let stats;
  try {
    stats = statSync(abs);
  } catch {
    return [];
  }
  if (stats.isFile()) {
    return SOURCE_EXTENSIONS.has(extensionOf(abs)) ? [abs] : [];
  }
  if (!stats.isDirectory()) return [];
  const out = [];
  const stack = [abs];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const next = join(dir, name);
      const rel = relative(ROOT, next);
      if (shouldSkip(rel)) continue;
      const itemStats = statSync(next);
      if (itemStats.isDirectory()) {
        stack.push(next);
      } else if (itemStats.isFile() && SOURCE_EXTENSIONS.has(extensionOf(next))) {
        out.push(next);
      }
    }
  }
  return out;
}

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
}

function scan(check) {
  const files = [...new Set(check.dirs.flatMap(collectFiles))];
  const failures = [];
  for (const file of files) {
    const relFile = relative(ROOT, file);
    if (check.excludeFiles?.includes(relFile)) continue;
    if (check.excludePrefixes?.some((prefix) => relFile.startsWith(prefix))) continue;
    const text = readFileSync(file, 'utf8');
    const pattern = new RegExp(check.pattern.source, `${check.pattern.flags.replace('g', '')}g`);
    for (const match of text.matchAll(pattern)) {
      failures.push({
        file: relFile,
        line: lineNumber(text, match.index ?? 0),
        match: match[0].slice(0, 120),
      });
    }
  }
  return failures;
}

const allChecks = checks.concat([
  primitiveCheck,
  activeTsxArbitraryVisualCheck,
  activeTsxRawVisualValueCheck,
]);
const failures = allChecks.flatMap((check) =>
  scan(check).map((failure) => ({ check: check.label, ...failure })),
);

const rawHexFiles = collectFiles('apps/desktop/renderer/src').filter((file) =>
  ['.ts', '.tsx', '.css'].includes(extensionOf(file)),
);
for (const file of rawHexFiles) {
  const relFile = relative(ROOT, file);
  if (RAW_HEX_ALLOWED_FILES.has(relFile)) continue;
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (!/(?:#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/.test(line)) return;
    if (line.includes('raw-hex-allowed')) return;
    failures.push({
      check: 'active raw visual color outside palette',
      file: relFile,
      line: index + 1,
      match: line.trim().slice(0, 120),
    });
  });
}

const cssFiles = collectFiles('apps/desktop/renderer/src').filter((file) => file.endsWith('.css'));
const definedCssVars = new Set();
const usedCssVars = [];
for (const file of cssFiles) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/--off-[a-z0-9-]+(?=\s*:)/g)) {
    definedCssVars.add(match[0]);
  }
  for (const match of text.matchAll(/var\((--off-[a-z0-9-]+)/g)) {
    usedCssVars.push({
      file: relative(ROOT, file),
      line: lineNumber(text, match.index ?? 0),
      name: match[1],
    });
  }
}
for (const cssVar of usedCssVars) {
  if (definedCssVars.has(cssVar.name) || runtimeCssVars.has(cssVar.name)) continue;
  failures.push({
    check: 'undefined Offisim CSS token',
    file: cssVar.file,
    line: cssVar.line,
    match: cssVar.name,
  });
}

for (const check of requiredChecks) {
  const file = join(ROOT, check.file);
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    failures.push({
      check: check.label,
      file: check.file,
      line: 1,
      match: 'required file missing',
    });
    continue;
  }
  for (const pattern of check.patterns) {
    if (!pattern.test(text)) {
      failures.push({
        check: check.label,
        file: check.file,
        line: 1,
        match: `missing ${pattern.source}`,
      });
    }
  }
}

if (failures.length > 0) {
  console.error('[check-ui-framework-hygiene] failed');
  for (const failure of failures.slice(0, 80)) {
    console.error(`- ${failure.check}: ${failure.file}:${failure.line} :: ${failure.match}`);
  }
  if (failures.length > 80) {
    console.error(`... ${failures.length - 80} more failures omitted`);
  }
  process.exit(1);
}

console.log('[check-ui-framework-hygiene] ok');
