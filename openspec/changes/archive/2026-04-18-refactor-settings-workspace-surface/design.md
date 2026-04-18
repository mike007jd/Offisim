## Context

`SettingsWorkspaceSurface.tsx` 是 Settings workspace 的核心文件，3 个消费点全靠它的 `useSettingsWorkspaceController` hook 返回的 ~50 字段：

- `SettingsPage.tsx` — 调用 hook、把 controller 传给 `SettingsContentArea`、capture-phase Escape handler 调 `controller.requestDismiss()`
- `SettingsProviderTab.tsx` — 读 provider 字段（preset / apiKey / baseURL / model 等）+ setter
- `SettingsRuntimeTab.tsx` — 读 runtime policy 字段 + setter + 2 个 live reinit-triggered derived（isSaving / saveError）

当前实现把 24 个 useState 全扁平放一起，save / load / reinit 逻辑也堆在同一 function scope。该文件已经被 CLAUDE.md 点名过一次（"reinit 超时用独立 effect（只依赖 isReinitializing），版本检测 effect 独立（依赖 runtimeVersion），不要合并"），说明后来者很容易误合这些 effect — 即扁平结构正在制造认知负担。

## Goals / Non-Goals

**Goals:**

- Hook body 按 domain 拆成 4 个 sibling hook（provider / runtime policy / save orchestrator / dirty tracking）
- Barrel ≤ 180 NBNC
- Public API（`useSettingsWorkspaceController` 入参 + 返回字段名/类型/顺序 + `SettingsWorkspaceSurface` JSX）byte-identical
- CLAUDE.md 已记录的 gotcha 不变：2 个 reinit effect 独立；save 必须写 toolPermissions；requestDismiss 仍由 controller 暴露
- 2 个 snapshot JSON 字符串的字段集合与之前 byte-identical（dirty tracking 不误判）

**Non-Goals:**

- 不改 provider preset 配置 / runtime policy 字段定义
- 不改 JSX（MetricCard 布局、Tabs 结构、capture-phase Escape）
- 不改 consumer（SettingsPage / 4 tab 兄弟文件）
- 不引入 TS 不可表达的新抽象（不用 Zod / Immer / state machine）

## Decisions

### D1. 4 sibling hook 按 state ownership 切，不按 UI tab 切

**选择**：4 个 sibling hook 分别拥有 **state 子集**，而不是按"ProviderTab 的 hook / RuntimeTab 的 hook" 切。

**理由**：
- Provider 和 Runtime tab 共享很多字段（tab 只是视图分层，state 是统一的）
- `dirty tracking` 需要监听**所有**字段的 snapshot — 如果按 tab 切，dirty tracking 要手动拼 2 组 snapshot 字段集合，容易漏
- Save orchestrator 需要**同时**读 provider state 和 runtime policy state 来 build `ProviderConfig`，按 UI tab 切会让 save 要从 2 个 hook 各自 import helpers
- Controller 的 public API 是 ~50 个字段的扁平 object，split 后 barrel 只做 `{ ...providerState, ...runtimePolicyState, ...saveState, ...dirtyState, density, setDensity, notify }` spread 合成

### D2. Snapshot 字符串由 barrel 拼接，dirty tracking 只做字符串 diff

**选择**：

```ts
// useSettingsProviderState.ts
export function useSettingsProviderState() {
  const [preset, setPreset] = useState<string>(DEFAULT_PRESET_KEY);
  // ... 7 useState
  return {
    fields: { preset, apiKey, baseURL, model, defaultHeaders, acpCommand, hasStoredSecret },
    setters: { setPreset, setApiKey, setBaseURL, setModel, setDefaultHeaders, setAcpCommand, setHasStoredSecret },
    snapshot: { preset, apiKey, baseURL, model, defaultHeaders, acpCommand },  // hasStoredSecret NOT in snapshot (matches current behavior)
    handlePresetChange,
    applyFromSaved,   // (saved: ProviderConfig) => void
    applyDefaults,    // () => void
  };
}

// useSettingsRuntimePolicy.ts — same shape, 13 fields
// useSettingsDirtyTracking.ts
export function useSettingsDirtyTracking({ isActive, snapshotJson, onDismiss }) {
  const loadedSnapshotRef = useRef('');
  const pendingSnapshotCaptureRef = useRef(false);
  useEffect(() => {
    if (pendingSnapshotCaptureRef.current) {
      loadedSnapshotRef.current = snapshotJson;
      pendingSnapshotCaptureRef.current = false;
    }
  }, [snapshotJson]);
  const hasUnsavedChanges = isActive && loadedSnapshotRef.current !== '' && snapshotJson !== loadedSnapshotRef.current;
  return {
    hasUnsavedChanges,
    requestDismiss: useCallback(() => { ... }, [hasUnsavedChanges, onDismiss]),
    queueCapture: () => { pendingSnapshotCaptureRef.current = true; },  // save orchestrator / load effect 调
    resetLoadedSnapshot: (s: string) => { loadedSnapshotRef.current = s; },  // save 成功后调，与当前 `loadedSnapshotRef.current = currentSnapshot` 等价
  };
}

// barrel SettingsWorkspaceSurface.tsx
export function useSettingsWorkspaceController(options) {
  const provider = useSettingsProviderState();
  const runtimePolicy = useSettingsRuntimePolicy();
  const { density, setDensity } = useTheme();

  const snapshotJson = useMemo(
    () => JSON.stringify({ ...provider.snapshot, ...runtimePolicy.snapshot, density }),
    [provider.snapshot, runtimePolicy.snapshot, density],
  );
  const dirty = useSettingsDirtyTracking({ isActive: options.isActive, snapshotJson, onDismiss: options.onDismiss });

  const save = useSettingsSaveOrchestrator({
    ...options, provider, runtimePolicy, snapshotJson, queueCapture: dirty.queueCapture, resetLoadedSnapshot: dirty.resetLoadedSnapshot,
  });

  return { /* ~50 fields spread from provider / runtimePolicy / save / dirty + density/setDensity + notify */ };
}
```

**理由**：
- Snapshot 字段集合**仍然是一个地方定义**（provider.snapshot + runtimePolicy.snapshot + density）— 不是散落 2 个子 hook
- dirty tracking 完全不知道字段名，只 diff 字符串 — 与当前行为等价
- 字段顺序必须和原 hook 的 `JSON.stringify({...})` 一致（key 顺序）以保 byte-identical snapshot（避免 ref 加载时 snapshot 字符串变化导致 `hasUnsavedChanges` 瞬间翻 true）。实现时明确 spread 顺序对齐

### D3. Save orchestrator 保留"不合并 reinit effect"的 gotcha

**选择**：`useSettingsSaveOrchestrator.ts` 文件里**两个**独立 useEffect：

```ts
// Effect 1: runtimeVersion bump 检测
useEffect(() => {
  if (!isReinitializing || reinitBaseVersionRef.current === null) return;
  if (runtimeVersion > reinitBaseVersionRef.current) {
    setIsReinitializing(false);
    reinitBaseVersionRef.current = null;
  }
}, [runtimeVersion, isReinitializing]);

// Effect 2: 5s 超时兜底
useEffect(() => {
  if (!isReinitializing) return;
  const timer = window.setTimeout(() => {
    setIsReinitializing(false);
    reinitBaseVersionRef.current = null;
    setSaveError('Runtime failed to reinitialize. ...');
  }, 5000);
  return () => window.clearTimeout(timer);
}, [isReinitializing]);
```

**理由**：
- 这是 CLAUDE.md `ui-office/CLAUDE.md` 显式记录的 gotcha："reinit 超时用独立 effect（只依赖 isReinitializing），版本检测 effect 独立（依赖 runtimeVersion），不要合并"
- 两个 effect deps 不同，合并会让 runtimeVersion 每 tick 重置超时，导致兜底失效
- spec 要加一条 "两个 reinit effect 独立" 的 requirement 锁住这个不变量

### D4. Load effect 和 handleSave 同住 save orchestrator

**选择**：load useEffect（isActive dep）+ handleSave async + 2 个 reinit effect + isSaving/isReinitializing/saveError state 全部住 `useSettingsSaveOrchestrator.ts`。

**理由**：
- load 和 save 共用 `savingRef` + `reinitBaseVersionRef` + snapshot capture 语义
- load 调用 provider.applyFromSaved / applyDefaults 和 runtimePolicy.applyFromSaved / applyDefaults
- save 调用 provider.fields 读值 + runtimePolicy.buildRuntimePolicy() 构造
- 分成 2 个 hook（load / save）会让共享 ref 跨 hook 传参，复杂度更高

替代方案："load state" 单拆 `useSettingsLoader.ts`。**否决**：load 本质是 save orchestrator 的"反向操作"，状态生命周期共享。

### D5. formatter / parser 放哪

**选择**：
- 3 个 formatter（`formatCompatibilityLabel` / `formatSurfaceLabel` / `capabilitySummary`）只被 JSX 用，移到 `settings-primitives.tsx`
- 3 个 parser（`parsePositiveInt` / `parseNonNegativeInt` / `parseConfidence`）只被 save orchestrator 用，**文件内 private helper**，不 export 出 controller 目录

**理由**：
- formatter 是 JSX 展示层（"Anthropic-compatible" 等 label），属于 surface 概念
- parser 是 save-time 数据清洗，属于 orchestrator 私有
- 不为每 3 个函数造独立文件 — 避免 helper-sprawl

### D6. `controller/` 目录 vs `hooks/` 目录

**选择**：新目录 `packages/ui-office/src/components/settings/controller/`，不叫 `hooks/`。

**理由**：
- `ui-office/src/hooks/` 已存在，住全局跨 component 的 hook（`useEmployeeEditor` / `useSceneOrchestrator` / `useRuntimeActivityFeed` 等）
- Settings controller 是**本 component 私有**的 4 个 hook，放本 component 目录下子目录更合理
- `controller/` 命名对齐 `useSettingsWorkspaceController` — 新来的人搜 Controller 能直接找到

### D7. hasStoredSecret 归属

**选择**：`hasStoredSecret` state 归 `useSettingsProviderState`（7 个 provider state 之一），但不进 snapshot（与当前实现一致：snapshot 不含 hasStoredSecret，避免 tauri secret 状态变化触发 dirty）。

**理由**：当前行为就是如此（检视 currentSnapshot 字段集可证），保持 byte-identical。

## Risks / Trade-offs

- **风险：snapshot 字段集合 or 字段顺序走样** → spec 加 scenario"snapshot JSON bytes 与 pre-refactor 等价"；实现时先 copy 旧 `JSON.stringify({...})` 的 key 顺序到 barrel 的拼接顺序
- **风险：load effect 和 save handler 调用 provider/runtimePolicy 的 applyFromSaved / buildRuntimePolicy 时闭包陈旧** → helpers 设计为 pure function（读最新 state 从 hook 返回值），不依赖闭包 snapshot
- **风险：CLAUDE.md gotcha 被拆散后后来者重新合并** → spec 显式 lock"两个 reinit effect 独立"为 requirement + scenario
- **风险：外部 consumer（`SettingsPage` / tab 文件）通过 `Parameters<typeof useSettingsWorkspaceController>` 反推类型** → hook 签名 byte-identical（options 入参 + ReturnType）
- **风险：`onToast` 经 controller 的 `notify` 适配层走** → 保持现有 `notify: (msg, variant) => onToast?.(msg, variant)` 适配；归属 save orchestrator 还是 barrel 都可以，放 barrel 更简单
- **Trade-off：barrel compose 后 return object 分布到 4 个 hook 的 return** → barrel 要写显式 spread 保持字段顺序与原 return 一致（pre-commit grep 可辅助校验），不比 pre-refactor 更脆弱
