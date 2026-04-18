## Why

`packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx` 是 624 NBNC 的双-export 文件：450 行 `useSettingsWorkspaceController` hook + 100 行 `SettingsWorkspaceSurface` JSX 组件 + 3 个 formatter helper + 3 个 parser helper。

问题**全部集中在 hook body**，不在 JSX：

- **24 个 useState 扁平并存**：provider 7 个（preset/apiKey/baseURL/model/defaultHeaders/acpCommand/hasStoredSecret）+ runtime policy 13 个（executionMode + summarization 3 + memory 4 + tools 3 + modelPolicy 2）+ save/UI 3 个（isSaving/isReinitializing/saveError）+ 4 个 ref。24 个状态全在一个 function scope，读一个字段要先用眼睛过滤"这是 provider 还是 runtime policy"。
- **140 行 load 副作用**（lines 243–342，单个 useEffect body）：saved config → 逐字段 set 到 24 个 useState；no saved → 从 `DEFAULT_POLICY` 再 set 一遍；还穿插 `getRuntimeSecretStatus` async 读取 + `IS_DESKTOP` 分支 + 偏移 preset key 分支。
- **120 行 handleSave**（lines 366–484）：validate apiKey、Tauri secret vs browser apiKey 分支、build `runtimePolicy` object（24 字段对齐）、build `ProviderConfig` object、save + trigger reinit。
- **双 reinit effect** 不能合并（CLAUDE.md 已明写 gotcha），但现在躺在同一个 hook 里，很容易被后来者误合。

外部 consumer 只看 hook 的 return shape（~50 字段）和 `SettingsWorkspaceSurface` 组件。该拆分对它们透明。

## What Changes

- **Barrel `SettingsWorkspaceSurface.tsx`** 保留三件事：`SettingsWorkspaceSurface` JSX 组件、`useSettingsWorkspaceController` 作为薄 compose、`SettingsTab` type；目标 ≤ 180 NBNC
- **4 个 controller sibling hook**（新目录 `packages/ui-office/src/components/settings/controller/`）：
  - `useSettingsProviderState.ts` — preset / apiKey / baseURL / model / defaultHeaders / acpCommand / hasStoredSecret 7 个 state + `handlePresetChange` + `applyFromSaved(saved)` / `applyDefaults(presetKey)` 两个 apply helper + `snapshot` 导出（object）
  - `useSettingsRuntimePolicy.ts` — executionMode + summarization 3 + memory 4 + toolSearchEnabled + gitAutoCommit + toolPermissions + runtimeModelDefault + runtimeModelOverrides 共 13 个 state + `applyFromSaved(policy)` / `applyDefaults()` + `snapshot` 导出 + `buildRuntimePolicy(providerPreset, preset, model)` 在 save 时构造
  - `useSettingsSaveOrchestrator.ts` — 持 isSaving / isReinitializing / saveError 3 个 state + savingRef + reinitBaseVersionRef；拥有 load useEffect、handleSave async、2 个 reinit useEffect（**独立不合并**）；接收 provider / runtimePolicy hook 返回的 state + apply/build helpers + dirty tracking 的 captureLoadedSnapshot
  - `useSettingsDirtyTracking.ts` — loadedSnapshotRef + pendingSnapshotCaptureRef + `hasUnsavedChanges` + `requestDismiss`；接收 isActive + `snapshotJson`（由外层拼接）+ `onDismiss`；暴露 `captureLoadedSnapshot()` 和 `resetLoadedSnapshot(snapshot)` 供 save orchestrator 调
- **3 个 formatter helper**（`formatCompatibilityLabel` / `formatSurfaceLabel` / `capabilitySummary`）— 只被 JSX 用，移到 `settings-primitives.tsx`（已是 67 NBNC 的兄弟文件）
- **3 个 parser helper**（`parsePositiveInt` / `parseNonNegativeInt` / `parseConfidence`）— 只被 save 用，内联进 `useSettingsSaveOrchestrator.ts` 或同目录 `settings-save-helpers.ts`
- **Public API 不变**：`useSettingsWorkspaceController(options)` 的入参、return 的 ~50 字段、字段名全部 byte-identical。5 个外部 consumer（`SettingsPage` / `SettingsContentArea` / `SettingsProviderTab` / `SettingsRuntimeTab` / `SettingsTabNav`）不动
- **Observable 行为不变**：load / save / reinit / dirty-tracking / escape-confirmation 路径全部 byte-identical；字段顺序写入 `runtimePolicy` 和 `ProviderConfig` 两个 object 保持不变（避免 provider-config.ts 的 `findProviderPresetKeyByConfig` 在 key 顺序差异下不匹配）

## Capabilities

### New Capabilities

- `settings-controller-boundaries`

### Modified Capabilities

（无）

## Impact

- **目录新增**：`packages/ui-office/src/components/settings/controller/{useSettingsProviderState,useSettingsRuntimePolicy,useSettingsSaveOrchestrator,useSettingsDirtyTracking}.ts`
- **Barrel 重写**：`SettingsWorkspaceSurface.tsx` 624 → ≤180 NBNC
- **Sibling 扩展**：`settings-primitives.tsx` +3 formatter function（已有文件）
- **Consumer 不动**：`SettingsPage` / `SettingsContentArea` / `SettingsProviderTab` / `SettingsRuntimeTab` 不改一行
- **验证**：串行 `shared-types → ui-core → core → ui-office → web` build 绿 + typecheck 绿 + grep gate（barrel 不含 `useState<` 声明、不含 inline `setRuntimeSecret` / `loadProviderConfig` / `saveProviderConfig` / `getRuntimeSecretStatus` call） + live web 验证：打开 Settings → 改 provider preset → 改 runtime policy tab 字段 → Save → 观察 reinit 触发 → 重开 Settings → 字段持久化；dirty flag & Escape 未保存确认行为不变
- **无依赖升级 / 无 API 断裂 / 无 DB migration**
- **风险面**：主要在 4 个 hook 的调用顺序 + state lifting 时的闭包 deps。dirty-tracking 的 snapshot 字符串必须包含所有 24 个字段 + density，任一字段漏了会让 hasUnsavedChanges 误判
