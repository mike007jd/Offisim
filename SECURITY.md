# Security Policy

## Supported Versions

Security fixes are targeted at the latest release candidate on `main` and the
latest tagged stable release, once stable releases begin.

## Reporting A Vulnerability

Please do not open public GitHub issues for suspected security vulnerabilities.

Report vulnerabilities privately by:

- Opening a GitHub Security Advisory if you have repository access
- Or emailing the maintainers listed on the repository profile

Include:

- A clear description of the issue
- Affected versions or commit SHAs
- Reproduction steps or proof of concept
- Impact assessment
- Suggested mitigation, if known

## Response Expectations

- Initial acknowledgement: within 5 business days
- Triage and reproduction: as soon as practical
- Fix and coordinated disclosure: depends on severity and exploitability

We will make a best effort to keep reporters informed throughout the process.

## Scope Notes

For Offisim 1.0, the highest-priority reports are:

- Remote code execution
- Auth or privilege escalation issues in `apps/platform`
- Secret exposure
- Install or package trust bypasses
- Unsafe tool execution or approval bypasses
- Data exfiltration from the local-first runtime

## Local Runtime Threat Model

Offisim desktop is the 1.0 reference runtime. The webview is not trusted to pick
credential destinations or arbitrary local execution roots.

- The production gateway hosts coexisting Pi API and Codex CLI orchestration
  adapters, with exactly one engine lane owning each run. Claude Code is not
  shipped until its own orchestration adapter and release evidence exist.
- Pi provider keys cross the narrow save command and are written to Pi-owned
  `~/.pi/agent/models.json`; the renderer receives only secret-free summaries.
  External CLIs retain native login, model choice, session files, compaction,
  and global memory; Offisim does not copy them into product storage.
- The API model projection contains safe account-owned metadata and configured
  exact ids. Official source/checkedAt metadata is strict; user-configured source
  metadata is optional. External CLI models are not an Offisim catalog.
- Tauri binds the backend-authorized effective task workspace and routes the
  turn to either the bundled API adapter host or native Codex app-server host.
  Host output is projected and credential-shaped values are filtered before
  they reach the webview.
- Local path open/save, git, and shell commands are scoped to a project
  workspace. Shell execution scrubs inherited environment variables and records
  approval/network-policy metadata. Current network policy is disclosure plus
  approval/audit unless an OS-level sandbox/proxy/firewall gate is explicitly
  added and verified; do not describe it as network denial without that proof.
- MCP stdio servers are high-risk local processes. Registration requires a
  user/developer/installed-asset source, approval id, command fingerprint, risk
  class, and startup/tool-call audit. Unknown or ambiguous MCP side effects
  should be treated as high risk until the permission engine classifies them.

## Marketplace And Platform Boundaries

- Publishing is a platform trust boundary. Draft create/update/submit and
  moderation updates must verify that the listing belongs to the authenticated
  creator; auth middleware alone is not enough.
- Marketplace manifests should be validated with the canonical
  `@offisim/asset-schema` contract. Platform envelope validation should only
  check route shape.
- Installable artifacts require sha256 and size metadata. Active package
  versions must persist `artifact_sha256` and `artifact_size_bytes`.
- Arbitrary `external_url` artifact fetches are SSRF-sensitive. Production must
  either use a hardened fetcher with redirect, DNS/IP, timeout, byte-cap, and
  streaming-hash checks, or fail closed to registry object upload. A normal HTTP
  client without those controls is not acceptable for broad third-party
  marketplace distribution.
- Signed artifact provenance and publisher identity attestation are future
  hardening requirements before broad third-party marketplace distribution; they
  are not satisfied by the 1.0 local-first release candidate alone.
