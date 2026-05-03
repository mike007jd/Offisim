# fix-chat-run-isolation release verify

Date: 2026-05-03

Runtime:
- Release app: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Rebuilt binary timestamp observed before launch: 2026-05-03 22:12
- Computer Use attached app: `com.offisim.desktop`
- Release window URL: `tauri://localhost`

## Results

| Task | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| 8.3 | Maya direct chat sends `在忙吗`; verify no Boss chip pollutes the direct-chat rail. | PASS for Boss isolation. The visible speaker is `Employee`, not `Boss`. The remaining `Employee -> REASONING` chip is a separate presentation-policy issue. | `8.3-direct-chat-no-boss.png` |
| 8.4 | Team/project chat sends `hi`, then `hello`; verify two distinct assistant turns with no cross-pollination. | PASS on a clean project thread named `Chat Isolation Verify`. The original root Team thread was already polluted by pre-fix history, so it was not used as final evidence. The UI disables second send while a turn is active; the second turn was sent immediately after the first returned to ready. | `8.4-project-thread-hi-hello-no-cross-pollination.png` |
| 8.5 | Trigger reconnect/background_sync while Maya direct chat is visible. | PASS. With Maya direct chat open in the release `.app`, Wi-Fi was toggled off and back on through `networksetup` (`en0`). After reconnect, Maya's rail stayed empty except for the direct-chat placeholder; no Boss chip, Boss message, or background_sync artifact appeared in the direct-chat rail. | `8.5-background-sync-no-maya-pollution.png` |
| 8.6 | `fix-doubled-boss-bubble` candidate, using the rapid-send/repeated-turn pattern. | PASS on the same clean project-thread evidence as 8.4. The rail shows one Boss bubble for `hi` and one Boss bubble for `Hello`; no doubled Boss bubble reproduced. | `8.6-doubled-boss-bubble-candidate-single-bubble-per-turn.png` |

## Notes

- The root all-company Team thread is not clean evidence after earlier pre-fix attempts: its Boss reasoning contained old Maya direct-chat content. That is persisted historical pollution, not a current-code verification surface.
- `Chat Isolation Verify` was created specifically to provide a fresh project thread for post-fix verification.
- Phase 8 release-app live verification is complete for 8.3 / 8.4 / 8.5 / 8.6.
