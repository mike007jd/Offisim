# PR-A2 plan conflict（未完整交付）

核对时间：2026-07-19（Pacific/Auckland）

## 结论

PR-A2 当前不能在严格遵守 §0 的前提下发布。以下三条不能同时成立：

1. §0 指定 `scripts/lib/harness-runner.mjs` 为已亲写锚点，要求直接使用、
   不得重写；固定 API 为 `createHarness(title)`，`report()` 在成功时
   必然输出 `\nall N checks passed`。
2. A2 要求 A1 之外的 104 个可执行 harness 全部迁到 runner，并以
   `h.report()` 结束。
3. A2 要求迁移前后 log 输出逐字节一致。

没有 suppression/adapter、runner option 或锚点修改时，成功的
`h.report()` 必然增加一条旧输出里不存在的摘要。§0.5 又禁止自行新增计划外
抽象层，因此本轮停止在冲突证据，不提交、不推送、不建 PR、不启动 A3/A4。

## 可复现分类

完整文件列表见 `conflict-classification.json`：

- 74 个 `noLocalRunnerChecks`：没有可迁到 `h.check` /
  `h.checkAsync` 的标准本地 check 骨架，旧 harness 已自行终止输出。
  机械接入 runner 后 `h.checks === 0`，`report()` 新增
  `all 0 checks passed`。
- 30 个 `customSummaryRunnerChecks`：标准 check 调用可以迁移，但旧 harness
  已有自定义统计行；`report()` 会再新增一条 runner 统计，形成重复摘要。

分类排除了 manifest 与 3 个 loader 文件；104 = 74 + 30。

## 最小样例

### 74 类：无 runner check

命令：

`node scripts/harness-ai-account-catalog.mjs`

旧输出只有：

`PASS dynamic AI account catalog (multi-provider, arbitrary leaves, safe payload)`

锚点不变的全量迁移草稿会额外输出：

`all 0 checks passed`

### 30 类：自定义统计

命令：

`pnpm --filter @offisim/platform exec tsx ../../scripts/harness-collaboration-profile.mts`

旧输出以 `8/8 checks passed.` 结束；锚点不变的迁移草稿随后又输出
`all 8 checks passed`。

## 全量 oracle

迁移前按旧命令串行捕获 104 个目标的 stdout+stderr、退出码与 SHA-256；
锚点不变的机械迁移草稿以相同命令重放：

- 退出码一致：104/104
- stdout+stderr 原始字节一致：4/104
- 即使只归一化 UUID、计时、临时路径和堆栈行号，仍只有 4/104 一致
- 唯一一致的 4 个是当前本来就非零并在 `report()` 前退出的 live harness
- 其余 100 个成功 harness 全部因固定 runner 摘要新增而不一致

逐文件结果见 `conflict-oracle-results.json`。比较器没有剥离 runner 摘要。

## 已回退的越界试验

曾本地试验给 `createHarness` 增加 `reportSuccess:false`，可同时做到
104/104 退出码一致、97/104 原始字节一致、其余 7 个仅运行时噪声归一化一致，
且 Node release gate 全绿。但这改写了 §0 的已亲写锚点，因此已完全回退，
未提交、未推送、未发布。

当前 runner 文件与 A1 基线 `e31aa3a5` 的 SHA-256 均为
`1c4025ae4063cda5b6f2ec7b2d5ec2a8266a549bcc4e08b0ceb0bdddab02ed3f`。

恢复执行所需条件：计划所有者必须明确放宽“锚点不可改”“全量迁移”或
“完整日志逐字节一致”中的至少一项；本任务不自行选择。
