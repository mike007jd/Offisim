## 1. Pre-work audit

- [x] 1.1 `grep -cvE '^\s*(//|$|/\*|\*)' packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx` 记录基线 NBNC（预期 624）
- [x] 1.2 捕获 baseline：当前 `useSettingsWorkspaceController` return 的所有字段名 + 类型列表（用 `Parameters<typeof ...>` 或人工 grep `return {`）
- [x] 1.3 捕获 baseline：当前 `currentSnapshot` useMemo 里 JSON.stringify 对象的 key 顺序（lines 185–208）
- [x] 1.4 确认 5 个 consumer 的 import 方式（`SettingsPage` / `SettingsContentArea` / `SettingsProviderTab` / `SettingsRuntimeTab` / `SettingsTabNav`）—— 记录是否只用 hook return 的 public fields

## 2. 创建 `controller/` 目录 + 4 个 sibling hook 文件

- [x] 2.1 新建目录 `packages/ui-office/src/components/settings/controller/`
- [x] 2.2 `controller/useSettingsProviderState.ts`：7 个 useState + `handlePresetChange` + `applyFromSaved(saved)` + `applyDefaults(presetKey)` + `snapshot` object（不含 `hasStoredSecret`）+ return 所有 field + setter
- [x] 2.3 `controller/useSettingsRuntimePolicy.ts`：13 个 useState + `applyFromSaved(policy)` + `applyDefaults()` + `buildRuntimePolicy(providerPreset, isSubscription, model)` + `snapshot` object + return 所有 field + setter
- [x] 2.4 `controller/useSettingsDirtyTracking.ts`：`loadedSnapshotRef` + `pendingSnapshotCaptureRef` + 1 个 useEffect（从 `snapshotJson` 同步到 loadedSnapshotRef）+ `hasUnsavedChanges` + `requestDismiss` + `queueCapture` + `resetLoadedSnapshot` 的 return
- [x] 2.5 `controller/useSettingsSaveOrchestrator.ts`：
  - state `isSaving` / `isReinitializing` / `saveError` + refs `savingRef` / `reinitBaseVersionRef`
  - load `useEffect`（deps `[isActive]`）：调 provider.applyFromSaved / applyDefaults + runtimePolicy.applyFromSaved / applyDefaults + `getRuntimeSecretStatus()` 读 Tauri secret
  - `handleSave` async：调 provider.fields 读值 + runtimePolicy.buildRuntimePolicy() 构造 ProviderConfig + `setRuntimeSecret` / `clearRuntimeSecret` / `saveProviderConfig`
  - **两个独立** reinit `useEffect`（CLAUDE.md gotcha）
  - 私有 parser 下沉至 `useSettingsRuntimePolicy.ts`（buildRuntimePolicy 处实际使用），save orchestrator 不直接引用

## 3. Barrel 重写

- [x] 3.1 `SettingsWorkspaceSurface.tsx` 改为 thin compose：导入 4 个 hook + `useTheme`（`useOffisimRuntimeStatus` 下沉到 save orchestrator），compose 成 `useSettingsWorkspaceController`，保留 JSX 组件 `SettingsWorkspaceSurface` 不变
- [x] 3.2 在 barrel 里构造 `snapshotJson = useMemo(() => JSON.stringify({ ...provider.snapshot, ...runtimePolicy.snapshot, density }))`，**key 顺序与 baseline 1.3 完全一致**
- [x] 3.3 barrel 通过 sibling `controller/assembleSettingsControllerApi.ts` 把 4 个 hook 的 field / setter / handler + derived（isSubscription / selectedPreset / isThinkingProvider / showBaseURL / isSaveDisabled / selected*）组合成 50 字段 return，字段名 byte-identical
- [x] 3.4 `notify: (message, variant) => onToast?.(message, variant)` 保留（在 assembleSettingsControllerApi 里）
- [x] 3.5 `isSaving: isSaving || isReinitializing` 合并逻辑放在 assembleSettingsControllerApi（barrel 下游）
- [x] 3.6 移 `formatCompatibilityLabel` / `formatSurfaceLabel` / `capabilitySummary` 3 个 formatter 到 `settings-primitives.tsx`（兄弟文件），在 barrel + assemble helper 里改为 import

## 4. 验证 barrel thin

- [x] 4.1 `grep -cvE '^\s*(//|$|/\*|\*)' packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx` ≤ 180 → 159
- [x] 4.2 barrel 里 `grep -E 'useState<|loadProviderConfig\(|saveProviderConfig\(|setRuntimeSecret\(|clearRuntimeSecret\(|getRuntimeSecretStatus\(|Number\.parseInt\(|Number\.parseFloat\('` 零匹配
- [x] 4.3 `grep -E '^export (type SettingsTab|function useSettingsWorkspaceController|function SettingsWorkspaceSurface)'` 3 个都在

## 5. 构建 + typecheck + single-owner grep gate

- [x] 5.1 串行 build：`pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build`
- [x] 5.2 `pnpm typecheck` 绿
- [x] 5.3 Provider state single-owner：grep `setApiKey|setBaseURL|setDefaultHeaders|setAcpCommand|handlePresetChange` 声明 → 全在 `controller/useSettingsProviderState.ts`
- [x] 5.4 Runtime policy single-owner：grep `setExecutionMode|setSummarizationEnabled|setMemoryMaxFacts|setToolPermissions|setRuntimeModelDefault|buildRuntimePolicy` 声明 → 全在 `controller/useSettingsRuntimePolicy.ts`
- [x] 5.5 Save single-owner：grep `loadProviderConfig\(|saveProviderConfig\(|setRuntimeSecret\(|clearRuntimeSecret\(|getRuntimeSecretStatus\(|savingRef|reinitBaseVersionRef|5000` → 全在 `controller/useSettingsSaveOrchestrator.ts`
- [x] 5.6 Dirty single-owner：grep `loadedSnapshotRef|pendingSnapshotCaptureRef` 声明 → 全在 `controller/useSettingsDirtyTracking.ts`（consumer 通过 controller prop 读 `hasUnsavedChanges`，不改动）
- [x] 5.7 两个 reinit effect 独立：useEffect 1 deps `[runtimeVersion, isReinitializing]`；useEffect 2 deps `[isReinitializing]` + `window.setTimeout(..., 5000)`

## 6. Snapshot byte parity 校验

- [x] 6.1 baseline 1.3 vs 新 barrel 的 `snapshotJson` 构造 key 顺序逐字符比对（详见 verify-notes.md）
- [x] 6.2 单元推理（不写 test）：给定相同的 24 字段值，pre/post `JSON.stringify` 输出字符串相等 — spread preserves source order, `provider.snapshot` 6 keys + `runtimePolicy.snapshot` 13 keys + `density` = 20 keys，顺序与 baseline 逐字相等
- [x] 6.3 `hasStoredSecret` 不出现在新 snapshotJson 中（provider.snapshot 类型 `ProviderStateSnapshot` 仅含 6 字段）

## 7. Live runtime verification（web dev server 5176）

- [x] 7.1 `cd apps/web && pnpm dev` 已启动，Playwright 打开 `http://localhost:5176`
- [x] 7.2 进入 Settings → Provider tab → MetricCards 渲染正常（compatibility / Models & Access 区域）
- [x] 7.3 preset 下拉显示 "MiniMax Global"（findProviderPresetKeyByConfig 把 env-backed config 正确匹配到 `minimax-intl-anthropic-coding`）
- [x] 7.4 改 apiKey 字段一个字符 → Save 按钮 class 从 `opacity-50 cursor-not-allowed` 变 `bg-cyan-500 hover:bg-cyan-400`（hasUnsavedChanges = true）
- [x] 7.5 切 Runtime tab → Runtime orchestration / Runtime controls / Summarization / Memory / Tool search / Git auto-commit / Display density 全部渲染
- [x] 7.6 按 Save → reinit 触发，saveError 为空，约 2s 后 button 变回 disabled（runtimeVersion bump 成功关掉 isReinitializing）
- [x] 7.7 按 Save 成功后 → hasUnsavedChanges 回到 false（button disabled + not-dirty class）
- [x] 7.8 按 Escape（未改字段） → 直接关闭 Settings，无 confirm
- [x] 7.9 按 Escape（有改动） → `window.confirm('Discard unsaved changes in Settings?')` 弹出，文案 byte-identical
- [x] 7.10 切 MCP tab → `McpConfigPanel` 正常渲染（Add MCP Server 表单 + 空态提示）
- [x] 7.11 dev console 0 error 0 warn（Playwright console_messages error/warning 均为空）
- [x] 7.12 观察记录到 `verify-notes.md`

## 8. 最终 gate

- [x] 8.1 `openspec validate refactor-settings-workspace-surface --strict` 绿
- [x] 8.2 通知用户等 `/opsx:archive`
