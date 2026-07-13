# UI/UX 一致性专项验收证据

> 结论：PASS
> 最终核对：2026-07-14T02:08:07+10:00（AEST）
> 代码基线：`a142000cf360`
> 实现提交：将在后续 closure commit 回填
> 验收分支：`codex/ui-ux-consistency-pass`

## Artifact

- 最终标准构建：`apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- 验收绝对路径：`/private/tmp/offisim-ui-ux-consistency-pass/apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Mach-O SHA-256：`9f0a7838f5f587b0f17ee694b1721f235121893e3eba8b8ec002a8ddfc09fa17`
- Mach-O 大小：`28,986,688` bytes
- 最终构建时间：2026-07-14T01:57:23+10:00
- 签名：`codesign --verify --deep --strict` PASS；ad-hoc hardened runtime；未配置 notarization 凭证。
- 最终标准构建没有注入 registry 环境变量。T06 另用同一源码生成一次临时 registry-configured release，只验证完整 toolbar topology；截图完成后已无环境变量重建，最终 SHA 回到上述值。

## Window identity

所有窗口均先以进程绝对路径、PID、CGWindowNumber、标题与 bounds 绑定，再由 Computer Use 操作；未使用 bundle id、AppleScript 或盲切前台。

| 用途 | PID | CGWindowNumber | title | bounds |
|---|---:|---:|---|---|
| Round 1 标准 release | 58545 | 2755 | Offisim | 1440×879；随后 1024×700 |
| Round 2 标准 release | 94110 | 2816 | Offisim | 1440×879；随后 1024×700 |
| Round 2 presence fresh launch | 62413 | 2846 | Offisim | 1440×879；随后 1024×700 |
| T06 registry-configured 补充 | 3101 | 2874 | Offisim | 1440×879；随后 1024×700 |
| 最终标准 error rerun | 53381 | 2901 | Offisim | 1440×879 |

Tauri 请求的默认 inner size 是 1440×900；macOS 当前可用 frame 将默认窗口实际实现为 CG 1440×879。最小窗口由 Computer Use 调整并经 CG 精确核对为 1024×700。

## Gate summary

| Gate | 结果 |
|---|---|
| `check:ui-hygiene` | PASS |
| `check:ui-ux-drift` | PASS |
| `harness:conversation-run-controller` | PASS，28/28 |
| `harness:pi-agent-host` + delegation integration | PASS |
| `harness:run-cost-scope` | PASS |
| `harness:office-projection` | PASS，50/50 |
| `harness:office-visual-language-p4` | PASS，50/50；含 reduced-motion 静态信息不丢失 |
| `harness:chat-persistence` | PASS，7/7 |
| desktop renderer typecheck | PASS |
| desktop renderer production build | PASS |
| desktop release build | PASS |
| `validate` | PASS，exit 0；含全仓 typecheck、runtime/harness 与 deadcode gate |
| `lint` | PASS，exit 0；197 条既有 warning、0 error |
| `git diff --check` | 提交前再次执行 |

## Live matrix

### Rails 与最小窗口

- 1440：
  [展开/展开](./round2-1440-rails-expanded-expanded.jpeg)、
  [折叠/展开](./round2-1440-rails-collapsed-expanded.jpeg)、
  [折叠/折叠](./round2-1440-rails-collapsed-collapsed.jpeg)、
  [展开/折叠](./round2-1440-rails-expanded-collapsed.jpeg)。
- 1024×700：
  [展开/展开](./round2-1024-rails-expanded-expanded.jpeg)、
  [折叠/展开](./round2-1024-rails-collapsed-expanded.jpeg)、
  [折叠/折叠](./round2-1024-rails-collapsed-collapsed.jpeg)、
  [展开/折叠](./round2-1024-rails-expanded-collapsed.jpeg)。
- 两个 toggle 始终位于 topbar；collapsed column 为 0；Stage 接管空间；Company channels 不再保留旧补偿死块。

### Stop 与 run chrome

- [真实 free-lane run，compact Stage 与两个 Stop 入口](./round1-1024-stop-live.jpeg)。
- [点击全局 Stop 后同步退出 pill，保留 Interrupted/RESUMABLE partial output](./round1-1024-stop-interrupted.jpeg)。
- controller harness 证明重复 Stop 只 abort 一次、立即释放 global ownership；stale/expired approval 保留历史投影但不进入 `activeRuns`。
- fresh launch 与 Round 2 Office 截图均无幽灵全局 Stop；Stage 只有一处 token/cost readout。

### 六项全局导航

- [1440 Settings](./round2-1440-nav-settings.jpeg) 与 [返回 Office](./round2-1440-nav-office-return.jpeg)。
- [1024 Settings](./round2-1024-nav-settings.jpeg)。
- Office、Loops、Personnel、Market、Studio、Settings 在两种宽度下始终显示 label，DOM 顺序和按钮几何稳定。

### Market 四态

- 1440 未配置 registry：
  [Browse](./round2-1440-market-browse.jpeg)、
  [Installed](./round2-1440-market-installed.jpeg)。
- 1440 registry-configured chrome：
  [Browse](./round2-1440-market-configured-browse.jpeg)、
  [Installed](./round2-1440-market-configured-installed.jpeg)。
- 1024 registry-configured chrome：
  [Browse](./round2-1024-market-configured-browse.jpeg)、
  [Installed](./round2-1024-market-configured-installed.jpeg)。
- configured run 使用不可达的本机测试 URL，故不声称 registry 网络成功；它覆盖与真实 connected 状态相同的 search/filter/sort/action toolbar 分支。主 mode switch 的左起点始终固定，未配置态不再渲染透明 search placeholder。

### Error 与 presence

- 最终标准 artifact 的 error：[折叠](./round2-1440-chat-error-collapsed.jpeg)、[展开](./round2-1440-chat-error-expanded.jpeg)。summary、details、Retry/Dismiss 与消息内容列使用同一 inset。
- 1024 第一轮 error：[折叠](./round1-1024-chat-error-collapsed.jpeg)、[展开](./round1-1024-chat-error-expanded.jpeg)。
- 五态同屏：[Offline / Working / Failed / Idle](./round2-1024-presence-five-states.jpeg)；[Seed Blocked popover](./round2-1024-presence-blocked-popover.jpeg) 同时显示 `BLOCKED` 与 `Blocked · Team conversation`。
- Accessibility tree 同屏读出 `OFFLINE / WORKING / FAILED / IDLE / BLOCKED`。reduced-motion gate 证明 Working 动画冻结后文字和静态形状仍保留，截图本身也不依赖动画判读。

## 原始 finding closure map

| 原始截图 | 关闭证据 |
|---|---|
| 01 radius mismatch | semantic radius tokens + hygiene/drift gates + Rails/Market release 截图 |
| 02-05 rail controls | 两尺寸四组合矩阵 |
| 06 duplicate token/cost | Round 2 Office，仅 Stage 单一 readout |
| 07 run pill void | live compact run 与 interrupted 截图 |
| 08-09 nav | 1440/1024 nav 截图与六项顺序 |
| 10-11 Market | 未配置/configured × Browse/Installed |
| 12 Company channels dead block | rails 展开/折叠矩阵 |
| 13 Stop no response | live Stop、interrupted checkpoint、28/28 harness |
| 14 error inset | 最终 error 折叠/展开 |
| 15 idle/offline | 五态同屏与 Blocked popover |

## Cleanup

- `thread-c30addf5-b5dc-4f26-95fe-aaae5cfb596d`（Stop 验收）已按产品 deep-delete 顺序清理。
- `thread-0f207888-f169-43ce-8363-f96e158def2b`（error 验收）已按同一合同清理。
- presence 临时 graph rows 与 `uiux-presence-failed-20260714` 已删除，SQL 复核均为 0。
- `/tmp/offisim-p4-verify-project` 已确认空目录后删除。
- 最终 release app 已通过 Computer Use 关闭；没有遗留当前 worktree app 进程。
