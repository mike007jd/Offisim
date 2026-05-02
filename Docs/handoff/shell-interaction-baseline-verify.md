# shell-interaction-baseline — live verify handoff

**Branch**: `main` (uncommitted WIP — see `git status`).
**Build artifact**: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app` (built 2026-05-02; aarch64).
**Bundle ID**: `com.offisim.desktop` — but per CLAUDE.md "release 桌面验收要用新 UI dist" + "多 worktree 桌面验收不能靠 bundle id"，启动用精确 `.app` 路径，不要 `open -b`。

## Status calibration (2026-05-03 — 真因定位 + fix 落地)

- **#10 / #12 真因已定位 + fix 落地**：trace 显示 `useSyncExternalStore` 监听 popstate 但 pushState 不触发 popstate → snapshot drift → 后续 render 触发 input-side effect with stale URL → `applyParsed` revert state。**修法**：`useUrlSync.ts` 删除 `useSyncExternalStore`，改成手动 `useState` + `popstate` listener，input-side effect 只在真 popstate fire。Spec 合规（未引入 onMouseDown / debounce / setTimeout）。**未关单** — 等 v3 release verify 通过。
- **#21 = 上一轮未复现**。本轮 verify 时如再次遇到，按同样路径导出。否则继续保留 open。
- **Diag instrumentation 仍在线**（不删，等 v3 verify 通过后一并 strip）。激活路径不变：`Cmd+Shift+Option+S`。
- **Archive gate 不开**。

## Verify v3 — 真因 fix 已落地，re-verify

新 release `.app` 已重新构建在原路径（`apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`，2026-05-03）。

按 §0 启用 diag，重做 §1 §2，**重点是 §3 #10/#12 的连续点击不再有奇偶失败**：

- 期望 trace 形态：每次点击 = `activateWorkspaceLink X` → `setActiveWorkspace reducer` → `App render activeWorkspace=X` → `useUrlSync serialize effect pushState`。**不再出现 `popstate effect`** 在我们自己 click 之后跑（除非按 Back/Forward）。
- 如果还出现 `popstate effect snapshot=<旧URL> ... reverted=false` 紧接 click 之后，说明 fix 没生效或 snapshot drift 还在另一条路径上 — 把 trace 贴回 §3，我据证据再调。
- 如果 6 peer + 4 settings 都 single-click 通过，§3 #10/#12 段写"v3 verify pass，trace 中无 popstate effect 在 click 之后"即可（不必再贴完整 trace）。

## What's landed in this build

| Issue | Status | Where |
|-------|--------|-------|
| #4 Settings collapse 按钮删除 | ✅ landed | `SettingsTabNav.tsx` 删除 `collapsed` / `onToggleCollapse` props + `verticalCollapsed` 派生；`SettingsPage.tsx` 不再读 `useSidebarCollapse('settings')` |
| #5 Chat slash / mention menu kbd scroll | ✅ landed | `ChatInput.tsx` 加 `slashItemRefs` / `mentionItemRefs` + `scrollIntoView({ block: 'nearest' })` `useEffect` |
| #10 / #12 Workspace + Settings 双击 | ⚠️ v3 fix landed, pending release verify | 真因：`useSyncExternalStore` 跟 location 但 subscribe 只听 popstate，pushState 后 snapshot drift 触发 input-side effect with stale URL → revert state。Fix：`useUrlSync.ts` 删 `useSyncExternalStore`，改手动 `useState`+`popstate` listener，effect 只在真 popstate fire。详见 `design.md` "Diagnosis (2026-05-03 — evidence-driven)"。 |
| #13 Notification badge 裁切 | ✅ landed | `NotificationCenter.tsx` 把 Bell + badge 包进 `<span className="relative inline-flex h-5 w-5">`，badge 落 button content box 内，无 ancestor `overflow: visible` 依赖 |
| #21 Tasks tab activation kills handle | ⚠️ diag-only（本轮交付次优） | 当前只挂 `?diag=shell` console / outline。**下个 cycle 改成 release app 内可导出 hit-test 证据**，用户不再开 DevTools。 |

## How to verify (Tauri release `.app`)

打开 release `.app` 用精确路径：

```bash
open /Users/haoshengli/Seafile/WebWorkSpace/Offisim/apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app
```

### 0. 启用 diag instrumentation（先做这一步）

打开 release `.app`：

```bash
open /Users/haoshengli/Seafile/WebWorkSpace/Offisim/apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app
```

进入 Office workspace。在 app 窗口任意位置按 **`Cmd + Shift + Option + S`**（macOS）。
- 立即看到右栏 collapse handle 出现**粉色 outline**。
- 屏幕左下角出现粉色 `Export shell diag` 按钮。
- 没看到 = 快捷键没收到，重按一次。flag 状态存 localStorage，重启 app 仍生效；想关掉再按一次。

确认 instrumentation 在线后做 §1 §2 §3。

### 1. #10 #12 single-click navigation — verify（**带 diag**）

既然第一轮已确认仍双击，直接做带 diag 的复现：
- Office workspace 默认。
- 单击 Market（一次）→ 观察是否切换。再单击 Personnel（一次）→ 是否切换。Activity → Settings 同样。
- 在 Settings 内单击 Runtime（一次）→ 是否切换。
- 任何一次"单击没到位、要二次点击"**之后立刻**点左下角 `Export shell diag` 按钮，把内容粘进 §3 第一段。

`Export shell diag` 此时会把 diag ring buffer 里**全部 trace** 也一起 copy（按时间顺序）。期望可见：
- `activateWorkspaceLink personnel` → `setActiveWorkspace reducer` → `App render` 是否真带新 `activeWorkspace`。
- `useUrlSync serialize effect` 是否触发了 push。
- 哪一步链断了。

### 2. #4 Settings 折叠按钮 + #5 Chat menu scroll + #13 Badge — 视觉 verify

- **Settings**：进 Settings，左栏只显示 4 个 tab 按钮，**顶部不再有 chevron 折叠按钮**。light + dark theme 都看一眼。
- **Chat 命令滚动**：office workspace 右栏 Chat 标签输入 `/`，slash menu 出来后用 ↓ 一直按到第二屏命令，**菜单应自动滚动让 active 行始终可见**。再试 `@` mention。
- **通知 badge**：触发任意未读通知（最简单：`/auto-stage` 之类 chat command 触发 task 完成，会有未读通知），看 Header 右侧铃铛图标，**红 badge 应完整显示**（一个圆形小 chip 在 bell 右上角，不被父容器裁切）。light + dark 都看。

### 3. #21 — 仍按"复现 1 次 + 按按钮"路径

由于上一轮 #21 暂时不可复现，本轮如果再次遇到（Tasks subtab 激活后 handle 不可点），**当下立刻**点左下角 `Export shell diag` 按钮。按钮 dump 包括：
- diag ring buffer 全部 trace（含切到 Tasks / 切 subtab 的事件链）。
- handle 自身 bbox + computed style。
- handle 5 个采样点 `elementsFromPoint` 全栈。
- handle → body 的 `offsetParent` 链每层 bbox + style。

如果整轮都不复现，§3 就写"未复现"即可，#21 暂保留 open 状态等下次自然遇到。

**Clipboard 兜底**：按钮提示 `Clipboard blocked` 时再开 DevTools 一次抓 `[diag:shell] export (clipboard failed)` 那条日志的 payload。但 macOS Tauri 默认 webview 应允许 clipboard，正常不会触发。

### 4. 视口与主题矩阵

- 1440×900 + light theme — 跑 §1 + §2。
- 1440×900 + dark theme — 跑 §1 + §2。
- 1280×800 + light theme — 跑 §1。
- 浏览器 SPA 390×844 narrow tier — 单跑 Settings horizontal nav 应无折叠按钮 + tabs single-click。

## What to fill in below after verifying

把 verify 的具体观察记下来。如有失败/截图，附路径或贴 console 日志。

### §1 Workspace single-click

- [x] 1440×900 light：v3 release verify pass（user Computer Use sequence SOPs → Market → Personnel → Activity → Settings → Runtime → MCP → External, 全单击到位；trace 38 条无 click 后 popstate effect）。
- [ ] 1440×900 dark：未跑（同 useUrlSync 修复，无 theme 分支）。
- [x] 1280×800 light：user Tauri verify pass — Office → SOPs → Market → Personnel → Activity → Settings → Runtime → MCP all single-click, 视觉与 1440×900 一致无 responsive 回归。
- [x] Settings 4 tabs 1440×900 light single-click：v3 release verify pass。
- [ ] Settings 4 tabs 1440×900 dark single-click：未跑。
- [x] 浏览器 SPA narrow tier 横向 nav single-click：playwright @ 390×844 verify pass，详情见 §3 narrow report。

### §2 Visual

- [ ] Settings 折叠按钮已不存在（light + dark）：
- [ ] Slash menu ↓ 滚动正常：
- [ ] Mention `@` menu ↓ 滚动正常：
- [ ] 通知 badge 不裁切（light + dark）：

### §3.0 narrow tier (browser SPA 390×844) — 2026-05-03

Run via playwright at `http://localhost:5176/` post diag-strip build (no instrumentation in tree):

- Settings page renders Settings nav as `<navigation>` with 4 buttons (Provider / Runtime / MCP / External Employees) and **no chevron / collapse button at top**. Layout = horizontal orientation per narrow tier.
- Settings tab single-click matrix all PASS:
  - `/settings/provider` → click Runtime → URL `/settings/provider` → `/settings/runtime`, Runtime tab marked `[active]`.
  - → click MCP → `/settings/mcp`.
  - → click External Employees → `/settings/external`.
  - → click Provider → `/settings/provider`.
- Peer workspace nav (drawer in narrow tier) single-click PASS:
  - From `/settings/provider`: open workspace menu → click Market → URL `/market/explore`, header `<h1>Market</h1>` rendered.
  - From `/market/explore`: open workspace menu → click Personnel → URL `/personnel`, header `<h1>Personnel</h1>` rendered.

narrow tier verdict: spec scenarios for #4 (no collapse button) + #10 (peer workspace single-click) + #12 (Settings tab single-click) all hold at 390×844.

### §3 Diag report (paste from `Export shell diag`)

#### #10/#12 v3 verify

```text
v3 pass — release .app built 2026-05-03 00:04:57.
Computer Use sequence: SOPs → Market → Personnel → Activity → Settings → Runtime → MCP → External Employees.
All clicks reached the target page/tab on first click.
Exported trace had 38 entries and no `useUrlSync popstate effect` after any click; each click followed the expected path:
activateWorkspaceLink / SettingsTabNav click → setActiveWorkspace reducer or settings state update → App render → useUrlSync serialize effect pushState.
#21 not encountered in this v3 run.
```

#### #10/#12 historical v2 failure export（superseded by v3 pass; retained as root-cause evidence）

```json
{
  "cycle": "shell-interaction-baseline / next-cycle-diag",
  "timestamp": "2026-05-02T11:58:36.730Z",
  "url": "/settings/provider",
  "trace": [
    {
      "t": 1777723028072,
      "flag": "shell",
      "msg": "activateWorkspaceLink sops",
      "payload": {
        "button": 0,
        "metaKey": false,
        "ctrlKey": false,
        "shiftKey": false,
        "altKey": false,
        "defaultPrevented": false
      }
    },
    {
      "t": 1777723028072,
      "flag": "shell",
      "msg": "setActiveWorkspace reducer",
      "payload": {
        "target": "sops",
        "prev": "office",
        "noop": false
      }
    },
    {
      "t": 1777723028073,
      "flag": "shell",
      "msg": "App render",
      "payload": {
        "activeWorkspace": "sops",
        "overlay": null,
        "pendingDeepLinkActive": false,
        "location": "/"
      }
    },
    {
      "t": 1777723028084,
      "flag": "shell",
      "msg": "useUrlSync serialize effect pushState",
      "payload": {
        "from": "/",
        "to": "/sops",
        "workspace": "sops"
      }
    },
    {
      "t": 1777723042421,
      "flag": "shell",
      "msg": "activateWorkspaceLink market",
      "payload": {
        "button": 0,
        "metaKey": false,
        "ctrlKey": false,
        "shiftKey": false,
        "altKey": false,
        "defaultPrevented": false
      }
    },
    {
      "t": 1777723042421,
      "flag": "shell",
      "msg": "setActiveWorkspace reducer",
      "payload": {
        "target": "market",
        "prev": "sops",
        "noop": false
      }
    },
    {
      "t": 1777723042421,
      "flag": "shell",
      "msg": "App render",
      "payload": {
        "activeWorkspace": "market",
        "overlay": null,
        "pendingDeepLinkActive": false,
        "location": "/sops"
      }
    },
    {
      "t": 1777723042428,
      "flag": "shell",
      "msg": "useUrlSync popstate effect",
      "payload": {
        "snapshot": "/sops",
        "parsedWorkspace": "sops",
        "fallbackWorkspace": "sops",
        "reverted": false
      }
    },
    {
      "t": 1777723042440,
      "flag": "shell",
      "msg": "App render",
      "payload": {
        "activeWorkspace": "sops",
        "overlay": null,
        "pendingDeepLinkActive": false,
        "location": "/sops"
      }
    },
    {
      "t": 1777723079772,
      "flag": "shell",
      "msg": "activateWorkspaceLink market",
      "payload": {
        "button": 0,
        "metaKey": false,
        "ctrlKey": false,
        "shiftKey": false,
        "altKey": false,
        "defaultPrevented": false
      }
    },
    {
      "t": 1777723079772,
      "flag": "shell",
      "msg": "setActiveWorkspace reducer",
      "payload": {
        "target": "market",
        "prev": "sops",
        "noop": false
      }
    },
    {
      "t": 1777723079773,
      "flag": "shell",
      "msg": "App render",
      "payload": {
        "activeWorkspace": "market",
        "overlay": null,
        "pendingDeepLinkActive": false,
        "location": "/sops"
      }
    },
    {
      "t": 1777723079786,
      "flag": "shell",
      "msg": "useUrlSync serialize effect pushState",
      "payload": {
        "from": "/sops",
        "to": "/market/explore",
        "workspace": "market"
      }
    },
    {
      "t": 1777723088438,
      "flag": "shell",
      "msg": "activateWorkspaceLink settings",
      "payload": {
        "button": 0,
        "metaKey": false,
        "ctrlKey": false,
        "shiftKey": false,
        "altKey": false,
        "defaultPrevented": false
      }
    },
    {
      "t": 1777723088438,
      "flag": "shell",
      "msg": "setActiveWorkspace reducer",
      "payload": {
        "target": "settings",
        "prev": "market",
        "noop": false
      }
    },
    {
      "t": 1777723088439,
      "flag": "shell",
      "msg": "App render",
      "payload": {
        "activeWorkspace": "settings",
        "overlay": null,
        "pendingDeepLinkActive": false,
        "location": "/market/explore"
      }
    },
    {
      "t": 1777723088442,
      "flag": "shell",
      "msg": "useUrlSync popstate effect",
      "payload": {
        "snapshot": "/market/explore",
        "parsedWorkspace": "market",
        "fallbackWorkspace": "market",
        "reverted": false
      }
    },
    {
      "t": 1777723088451,
      "flag": "shell",
      "msg": "App render",
      "payload": {
        "activeWorkspace": "market",
        "overlay": null,
        "pendingDeepLinkActive": false,
        "location": "/market/explore"
      }
    },
    {
      "t": 1777723097395,
      "flag": "shell",
      "msg": "activateWorkspaceLink settings",
      "payload": {
        "button": 0,
        "metaKey": false,
        "ctrlKey": false,
        "shiftKey": false,
        "altKey": false,
        "defaultPrevented": false
      }
    },
    {
      "t": 1777723097395,
      "flag": "shell",
      "msg": "setActiveWorkspace reducer",
      "payload": {
        "target": "settings",
        "prev": "market",
        "noop": false
      }
    },
    {
      "t": 1777723097395,
      "flag": "shell",
      "msg": "App render",
      "payload": {
        "activeWorkspace": "settings",
        "overlay": null,
        "pendingDeepLinkActive": false,
        "location": "/market/explore"
      }
    },
    {
      "t": 1777723097416,
      "flag": "shell",
      "msg": "useUrlSync serialize effect pushState",
      "payload": {
        "from": "/market/explore",
        "to": "/settings/provider",
        "workspace": "settings"
      }
    },
    {
      "t": 1777723106277,
      "flag": "shell",
      "msg": "SettingsTabNav click runtime",
      "payload": {
        "activeTabBefore": "provider"
      }
    },
    {
      "t": 1777723106277,
      "flag": "shell",
      "msg": "App render",
      "payload": {
        "activeWorkspace": "settings",
        "overlay": null,
        "pendingDeepLinkActive": false,
        "location": "/settings/provider"
      }
    },
    {
      "t": 1777723106284,
      "flag": "shell",
      "msg": "useUrlSync popstate effect",
      "payload": {
        "snapshot": "/settings/provider",
        "parsedWorkspace": "settings",
        "fallbackWorkspace": "settings",
        "reverted": false
      }
    },
    {
      "t": 1777723106284,
      "flag": "shell",
      "msg": "App render",
      "payload": {
        "activeWorkspace": "settings",
        "overlay": null,
        "pendingDeepLinkActive": false,
        "location": "/settings/provider"
      }
    }
  ],
  "hitTest": null
}
```

#### #21 失败时点的导出（如本轮再次遇到才填，否则写 "未复现"）

```json
"未复现"
```

## Next-cycle plan

1. **#21 升级诊断**（不再让用户开 DevTools）：在 release app 加一个角落 "Export shell diag" 按钮（仅 `?diag=shell` 生效），用户复现"Tasks 子 tab 激活后 handle 不可点"现象，点这个按钮就把以下三件事写进 clipboard 或下载文件：
   - **(a)** 点击点（handle 中心 + handle bbox 四角共 5 个采样点）的 `document.elementsFromPoint(x, y)` 全量栈，含每层节点 `tagName / id / classList / data-* / computed pointer-events / computed z-index / position`。
   - **(b)** Handle 自身 `getBoundingClientRect()` + `getComputedStyle()` 的 `transform` / `pointer-events` / `z-index` / `position` / `overflow`。
   - **(c)** 从 handle 往上溯 `offsetParent` 链直到 body，每层的 `position` / `overflow` / `pointer-events` / `transform` / `z-index` / `bbox`。
   - **限界**：只这三件，不再加更细的探针。
2. 用户在 release app 复现 1 次 + 点导出按钮 + 把内容贴回。
3. 我据证据落 #21 fix。
4. 同 cycle 删 `?diag=shell` instrumentation + 三处 diag log（task 3.3）。
5. 用户跑一次 release `.app` final verify（§1 / §2 / 新 §3 confirm 不需要 diag）。
6. archive gate 三查 + `openspec validate --strict` + `/opsx:archive`。
