# Offisim Codex CLI Stop 泄漏基线对照执行报告

## Status

`completed`

## 目标与结论

- 目标：在 Rust `src-tauri` 与 `main@f105efc2` 零差异的指定 release app 上，复现 Codex CLI lane 的 Stop 行为，判断 `sleep 300` 泄漏是存量还是 A3 引入。
- 明确结论：**是，基线 app 同样泄漏 `sleep 300`；Stop 后进程变为 `PPID 1`，并保留以自身 PID 为 PGID 的独立进程组。**
- 判定：该缺陷在基线已存在，不是 A3 分支新引入。stage `Stop` 与 conversation `Stop run` 两条 UI 路径均复现。

## 环境

- checkedAt：`2026-07-19`（Pacific/Auckland，NZST）
- 精确 app：`/Users/haoshengli/worktrees/offisim-refactor-u4/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`
- 启动/附着/点击/关闭：Computer Use，使用精确 app 路径；未使用 `open -b`、dev server、AppleScript 或 `osascript`。
- 员工/engine lane：Maya Lin / `Codex CLI`
- 精确消息：`Use the shell to run exactly: bash -lc 'sleep 300'. Do not reply until it finishes.`

## 执行记录与原始输出

### 1. 启动精确 release app 并证明主进程路径

Computer Use 以精确 app 路径启动并附着窗口。随后执行：

```sh
date '+%Y-%m-%d %H:%M:%S %Z'
ps -p 36767 -o pid=,ppid=,pgid=,stat=,lstart=,command=
```

输出：

```text
2026-07-19 17:47:11 NZST
36767     1 36767 S    Sun Jul 19 17:45:36 2026     /Users/haoshengli/worktrees/offisim-refactor-u4/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app/Contents/MacOS/offisim-desktop
```

### 2. stage Stop 子实验

任务运行态：

```sh
ps -p 36767,38674,38675,39233,39234 -o pid=,ppid=,pgid=,stat=,lstart=,command=
```

输出：

```text
36767     1 36767 S    Sun Jul 19 17:45:36 2026     /Users/haoshengli/worktrees/offisim-refactor-u4/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app/Contents/MacOS/offisim-desktop
38674 36767 38674 S    Sun Jul 19 17:47:00 2026     node /Users/haoshengli/.local/share/fnm/node-versions/v22.22.3/installation/lib/node_modules/@openai/codex/bin/codex.js app-server --stdio
38675 38674 38674 S    Sun Jul 19 17:47:00 2026     /Users/haoshengli/.local/share/fnm/node-versions/v22.22.3/installation/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex app-server --stdio
39233 38675 39233 S    Sun Jul 19 17:47:22 2026     /Users/haoshengli/.local/share/fnm/node-versions/v22.22.3/installation/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex-code-mode-host
39234 38675 39234 Ss   Sun Jul 19 17:47:22 2026     sleep 300
```

通过 Computer Use 点击 stage `Stop`。随后执行：

```sh
date '+%Y-%m-%d %H:%M:%S %Z'
ps -p 36767,38674,38675,39233,39234 -o pid=,ppid=,pgid=,stat=,lstart=,command=
```

输出：

```text
2026-07-19 17:48:14 NZST
36767     1 36767 S    Sun Jul 19 17:45:36 2026     /Users/haoshengli/worktrees/offisim-refactor-u4/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app/Contents/MacOS/offisim-desktop
39234     1 39234 Ss   Sun Jul 19 17:47:22 2026     sleep 300
```

结果：codex app-server 组 `38674` 与 code-mode-host `39233` 已退出；`sleep 300` 残留为 `PID=39234 PPID=1 PGID=39234 STAT=Ss`。

### 3. conversation Stop run 子实验

在同一 Codex CLI 对话再次发送相同精确消息。任务运行态：

```sh
date '+%Y-%m-%d %H:%M:%S %Z'
ps -p 36767,39234,42188,42189,42888,42889 -o pid=,ppid=,pgid=,stat=,lstart=,command=
```

输出：

```text
2026-07-19 17:50:22 NZST
36767     1 36767 S    Sun Jul 19 17:45:36 2026     /Users/haoshengli/worktrees/offisim-refactor-u4/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app/Contents/MacOS/offisim-desktop
39234     1 39234 Ss   Sun Jul 19 17:47:22 2026     sleep 300
42188 36767 42188 S    Sun Jul 19 17:49:13 2026     node /Users/haoshengli/.local/share/fnm/node-versions/v22.22.3/installation/lib/node_modules/@openai/codex/bin/codex.js app-server --stdio
42189 42188 42188 S    Sun Jul 19 17:49:14 2026     /Users/haoshengli/.local/share/fnm/node-versions/v22.22.3/installation/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex app-server --stdio
42888 42189 42888 S    Sun Jul 19 17:49:55 2026     /Users/haoshengli/.local/share/fnm/node-versions/v22.22.3/installation/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex-code-mode-host
42889 42189 42889 Ss   Sun Jul 19 17:49:55 2026     sleep 300
```

通过 Computer Use 点击 conversation `Stop run`。随后执行：

```sh
date '+%Y-%m-%d %H:%M:%S %Z'
ps -p 36767,39234,42188,42189,42888,42889 -o pid=,ppid=,pgid=,stat=,lstart=,command=
```

输出：

```text
2026-07-19 17:50:53 NZST
36767     1 36767 S    Sun Jul 19 17:45:36 2026     /Users/haoshengli/worktrees/offisim-refactor-u4/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app/Contents/MacOS/offisim-desktop
39234     1 39234 Ss   Sun Jul 19 17:47:22 2026     sleep 300
42889     1 42889 Ss   Sun Jul 19 17:49:55 2026     sleep 300
```

结果：第二个 codex app-server 组 `42188` 与 code-mode-host `42888` 已退出；第二个 `sleep 300` 残留为 `PID=42889 PPID=1 PGID=42889 STAT=Ss`。

### 4. 关闭 app 后复查

通过 Computer Use 点击精确 app 窗口关闭按钮。随后执行：

```sh
date '+%Y-%m-%d %H:%M:%S %Z'
ps -p 36767,39234,42188,42189,42888,42889 -o pid=,ppid=,pgid=,stat=,lstart=,command=
```

输出：

```text
2026-07-19 17:51:34 NZST
39234     1 39234 Ss   Sun Jul 19 17:47:22 2026     sleep 300
42889     1 42889 Ss   Sun Jul 19 17:49:55 2026     sleep 300
```

结果：Offisim 主进程 `36767` 已退出；两个残留 `sleep 300` 均继续存活。终端截图采集时第一个 `39234` 已超过 300 秒并自然结束，第二个 `42889` 仍以 `PPID=1 PGID=42889` 存活。

### 5. 残留清理

在残留截图完成后执行用户指定的进程组清理：

```sh
date '+%Y-%m-%d %H:%M:%S %Z'
kill -TERM -- -42889
sleep 1
ps -p 39234,42889 -o pid=,ppid=,pgid=,stat=,lstart=,command=
test -z "$(ps -p 39234,42889 -o pid=)" && echo 'CLEANUP_CONFIRMED: no experiment sleep 300 process remains'
```

输出：

```text
2026-07-19 17:54:06 NZST
CLEANUP_CONFIRMED: no experiment sleep 300 process remains
```

## 截图证据

- `01-running.png`：Codex CLI tool `bash` running，conversation `Stop` 可见。
- `02-after-stage-stop.png`：stage `Stop` 点击后的 app 画面；UI 短暂仍显示 working，进程事实以同时间段 `ps` 为准。
- `03-after-conversation-stop.png`：conversation `Stop run` 点击后的 app 画面；随后 UI 收敛为 `Codex turn was interrupted` / failed。
- `04-after-app-close-residual-ps.png`：精确 Terminal windowId `35170` 的关 app 后残留 `ps` 画面，显示 `42889 1 42889 Ss ... sleep 300`。

## 范围与完整性

- 未改源码，未 build，未使用 dev server，未 commit/push。
- 本次仅在 `tmp-a3-baseline-evidence/` 写入报告与截图；用于终端证据展示的临时 `show-residual.command` 已删除。
- 两个实验残留均已结束：`39234` 自然到期，`42889` 已通过 `kill -TERM -- -42889` 清理并确认不存在。
