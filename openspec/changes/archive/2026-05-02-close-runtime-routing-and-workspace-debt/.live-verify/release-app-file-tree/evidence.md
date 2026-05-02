# Release App File Tree Live Verify

Date: 2026-05-02

Release artifact:
- `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- `apps/desktop/src-tauri/target/release/bundle/dmg/Offisim_0.0.1_aarch64.dmg`

Build and launch evidence:
- `pnpm --filter @offisim/desktop build` passed.
- `Offisim.app` mtime: `May 2 14:43:26 2026`.
- `Offisim_0.0.1_aarch64.dmg` mtime: `May 2 14:43:46 2026`.
- `codesign --verify --deep --strict --verbose=2 apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app` passed.
- `Info.plist` contains `LSRequiresCarbon = false`.
- Release app launched as pid `42697` and Computer Use attached to bundle id `com.offisim.desktop`.

Steps and observations:
1. Opened release `Offisim.app`.
2. Switched company to `Empty Verify Company`.
3. Selected project `Codex Bound Offisim`, bound to `/Users/haoshengli/Seafile/WebWorkSpace/Offisim`.
4. Opened project picker file tree.
5. Navigated `/.serena/cache/typescript`.
6. Selected `document_symbols.pkl` (`28.9 MB`).
7. UI displayed `preview truncated · 28.9 MB total`; screenshot: `large-file-truncated.png`.
8. Clicked refresh while still inside `/.serena/cache/typescript`.
9. UI kept current path `/.SERENA/CACHE/TYPESCRIPT`, selected `document_symbols.pkl`, and the truncation hint.
10. Switched to project `Codex Unbound Offisim`.
11. Project strip showed `No folder bound`; reopening project picker showed `No workspace folder`, with no previous file tree or preview visible.

IPC payload bound:
- UI wrapper requests `maxBytes: 8192` for previews.
- Rust command clamps any preview request to `MAX_PREVIEW_BYTES = 65536`.
- Live UI proof above confirms the 28.9 MB file did not stream as a full preview and rendered the truncation state from the bounded preview response.
