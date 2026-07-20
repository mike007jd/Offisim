# PR-D3：`builtin_tools.rs` clean rebuild 记录

- 状态：clean rebuild 已 rebase 到 D1 合入后的 `origin/main@0421d7303a5d79dd9363e802c8a58c1a1e1edd9f`；代码、门禁与当前 head release `.app` 已验证。
- 当前验证 head：`a8903fc3699b9f28ac1755618adf8c9d47148a81`。
- 核对时间：2026-07-20 NZST。
- 范围：仅把 `builtin_tools.rs` 中 process probe、workspace sandbox path、shell helpers 机械拆到 `builtin/{proc_probe,sandbox_path,shell}.rs`；根模块保留 Tauri command、装配与必要 re-export，不改变工具合同、错误文本或安全边界。
- D1 合并冲突只发生在 `scripts/harness-project-workspace.mts` 的源码路径 oracle；最终保留 D1 git 模块路径与 D3 builtin 模块路径并集，断言不变。

## 已实际通过

- `cargo fmt --all -- --check`
- `pnpm harness:project-workspace`：1/1。
- `node scripts/prepare-desktop-cargo-test.mjs && cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`：470 passed，0 failed。
- `node scripts/release-gates.mjs --lane=node`：4/4 gates green；validate 73/73 harness。
- GitNexus compare `origin/main`：MEDIUM，5 个代码/harness 文件、22 个索引符号、2 条预期的 `Project_list_dir` 文件系统执行流；未出现额外产品流。

## release `.app` live verify

- 精确产物：`apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`。
- arm64 release build 成功；Developer ID + hardened runtime 签名及 `codesign --deep --strict` 通过。
- 本机 `spctl` 返回 accepted，但 Gatekeeper assessments disabled；产物未 notarize、无 stapled ticket，本记录不把它表述为正式分发验收。
- Computer Use 绑定上述精确 `.app`，窗口 URL 为 `tauri://localhost`；独立临时 Project 为 `/private/tmp/offisim-d3-live-project.xt7qSZ`，独立 outside fixture 为 `/private/tmp/offisim-d3-live-outside.cfds2x`，未复用 W6 或 D2 sentinel。
- Pi built-in Read 读取 `read.txt` 得到 `D3_READ_OK`；Write 创建 `write.txt` 后 Read 回读 `D3_WRITE_OK`，磁盘精确为 `D3_WRITE_OK\n`。
- Pi built-in Bash 在 Project cwd 完成精确 `/bin/sh -c` 命令；界面最终结果报告 `D3_BASH_OK`。对应 Rust oracle `ordinary_shell_tool_excludes_ssh_auth_sock` 已随 470 个测试通过。
- 父目录 Read 与 Write 均被拒绝，原始错误为 `Workspace tool paths cannot contain a parent-directory segment.`。
- symlink Read 被 `fileRead failed: open project file parent without following symlinks failed ... (NotADirectory)` 拒绝。
- 独立 Kai conversation 只调用一次 symlink Write；`fileWrite failed: open project file parent without following symlinks failed ... (NotADirectory)`，4/4 stages completed。
- outside `outside.txt` 仍精确为 `D3_OUTSIDE_UNCHANGED\n`；`parent-write.txt` 与 `link-write.txt` 均不存在。
- 初次 Pi run 曾把 Bash 命令自行改写成不兼容当前 shell 的条件语法并重试；这部分失败未作为代码结论。单独发送的精确 `/bin/sh -c` 命令完成，Read/Write 边界结果均由工具原始错误和磁盘 oracle 独立确认。

## 清理

- 验收后已切回 Main Project 并关闭 exact release `.app`。
- 本轮 Project 记录及其 conversation/event 投影已按精确 project id 清理；不会删除 Pi native Agent Home/session。
- 两个精确 mktemp 目录已移入废纸篓，可恢复；W6、D2 sentinel 与既有 Project 文件未改动。

## 截图

- `current-release-bash-and-boundary.jpeg`：Pi live 的 Bash/父目录边界执行现场。
- `current-release-symlink-write-rejected.jpeg`：独立 Write 调用被 symlink boundary 拒绝的原始错误。

本记录不声称已合并、notarize 或发布。
