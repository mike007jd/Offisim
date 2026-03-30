# AI Runtime Policy — Follow-up Tasks

> Created: 2026-03-31
> Context: commit `bbb2f43` completed the main enforcement. These 3 tasks close the remaining gaps.
> Priority: Plan 1 > Plan 2 > Plan 3

---

## Plan 1: Rust cargo build verification

**Goal**: Confirm `runtime_secrets.rs` compiles, clean up stale dependencies from deleted `provider_secrets.rs`.

**Prerequisites**: Machine with Rust toolchain (`rustup`, `cargo`).

### Steps

1. `cd apps/desktop/src-tauri && cargo check`
   - Expected: compiles cleanly since `lib.rs` already references `mod runtime_secrets`
   - If warnings about unused deps appear, proceed to step 2

2. Check if `reqwest` is still needed:
   ```bash
   grep -r "reqwest" apps/desktop/src-tauri/src/ --include="*.rs" | grep -v provider_secrets
   ```
   - `reqwest` was used by `provider_secrets.rs` for HTTP calls to vendor APIs
   - If **only** `provider_secrets.rs` used it: remove `reqwest` from `Cargo.toml`
   - If `mcp_bridge.rs` or `deep_link.rs` also use it: keep it
   - If removing `reqwest`, also remove its feature flags (`json`, `rustls-tls`, etc.) from `Cargo.toml`

3. Check `serde_json` usage:
   ```bash
   grep -r "serde_json\|json!" apps/desktop/src-tauri/src/ --include="*.rs" | grep -v provider_secrets
   ```
   - `runtime_secrets.rs` still uses `serde::Serialize` but not `serde_json::json!`
   - `serde` and `serde_json` are likely used by other modules — do NOT remove unless confirmed unused

4. **Keyring account name change**: `ACCOUNT_NAME` changed from `"provider.api_key"` to `"runtime.secret"`. This means existing users' keyring entries won't be found. Verify behavior:
   - `runtime_secret_status` returns `{ has_secret: false }` on `NoEntry` — safe, no panic
   - If you want migration: add a one-time check for the old key name and copy it. Otherwise accept the clean break (users re-enter credentials).

5. Full build: `cargo build --release`

6. Run any existing Rust tests: `cargo test`

### Acceptance

- `cargo check` — zero errors, zero warnings
- `cargo build --release` — success
- `cargo test` — pass (if tests exist)

### Files

| File | Action |
|------|--------|
| `apps/desktop/src-tauri/Cargo.toml` | Possibly remove `reqwest` dependency |
| `apps/desktop/src-tauri/src/runtime_secrets.rs` | Already written — verify compiles |
| `apps/desktop/src-tauri/src/lib.rs` | Already updated — verify compiles |

---

## Plan 2: SettingsDialog deprecated alias migration

**Goal**: Replace 3 deprecated function calls in `SettingsDialog.tsx` with new names, then optionally remove the aliases.

### Steps

1. In `packages/ui-office/src/components/settings/SettingsDialog.tsx`, update the import:

   ```diff
   - import {
   -   clearProviderSecret,
   -   getProviderSecretStatus,
   -   setProviderSecret,
   - } from '../../lib/desktop-provider-secrets';
   + import {
   +   clearRuntimeSecret,
   +   getRuntimeSecretStatus,
   +   setRuntimeSecret,
   + } from '../../lib/desktop-provider-secrets';
   ```

2. Find and replace all call sites in `SettingsDialog.tsx`:

   | Old | New |
   |-----|-----|
   | `getProviderSecretStatus()` | `getRuntimeSecretStatus()` |
   | `status.hasApiKey` | `status.hasSecret` |
   | `setProviderSecret(...)` | `setRuntimeSecret(...)` |
   | `clearProviderSecret()` | `clearRuntimeSecret()` |

   Use these commands to find all occurrences:
   ```bash
   grep -n "getProviderSecretStatus\|setProviderSecret\|clearProviderSecret\|hasApiKey" \
     packages/ui-office/src/components/settings/SettingsDialog.tsx
   ```

3. Also update `hasStoredApiKey` state variable name to `hasStoredSecret` for consistency:
   ```diff
   - const [hasStoredApiKey, setHasStoredApiKey] = useState(false);
   + const [hasStoredSecret, setHasStoredSecret] = useState(false);
   ```
   Then update all references to `hasStoredApiKey` / `setHasStoredApiKey` in the file.

4. Confirm no other production files use the old names:
   ```bash
   grep -r "getProviderSecretStatus\|setProviderSecret\|clearProviderSecret" \
     packages/ apps/ --include="*.ts" --include="*.tsx" \
     | grep -v "__tests__" \
     | grep -v "desktop-provider-secrets.ts"
   ```
   After step 2, this should return empty.

5. If no production callers remain — remove the deprecated aliases from `desktop-provider-secrets.ts` (lines 44-53):
   ```diff
   - /** @deprecated Use `getRuntimeSecretStatus()` instead. */
   - export const getProviderSecretStatus = async () => {
   -   const status = await getRuntimeSecretStatus();
   -   return { hasApiKey: status.hasSecret };
   - };
   -
   - /** @deprecated Use `setRuntimeSecret()` instead. */
   - export const setProviderSecret = setRuntimeSecret;
   -
   - /** @deprecated Use `clearRuntimeSecret()` instead. */
   - export const clearProviderSecret = clearRuntimeSecret;
   ```

6. Update the test in `provider-gateway.test.ts` — if aliases are removed, change the test from "exports deprecated aliases" to "does NOT export old names":
   ```diff
   - it('exports deprecated backwards-compatible aliases', () => {
   -   expect(typeof desktopSecrets.getProviderSecretStatus).toBe('function');
   -   expect(typeof desktopSecrets.setProviderSecret).toBe('function');
   -   expect(typeof desktopSecrets.clearProviderSecret).toBe('function');
   - });
   + it('does not export old provider secret aliases (removed)', () => {
   +   const mod = desktopSecrets as Record<string, unknown>;
   +   expect(mod.getProviderSecretStatus).toBeUndefined();
   +   expect(mod.setProviderSecret).toBeUndefined();
   +   expect(mod.clearProviderSecret).toBeUndefined();
   + });
   ```

7. Run tests:
   ```bash
   pnpm --filter @offisim/ui-office test -- --run
   ```

### Acceptance

- Zero deprecated function calls in production code
- `pnpm --filter @offisim/ui-office test -- --run` — all pass

### Files

| File | Action |
|------|--------|
| `packages/ui-office/src/components/settings/SettingsDialog.tsx` | Replace 3 function calls + rename state variable |
| `packages/ui-office/src/lib/desktop-provider-secrets.ts` | Remove deprecated aliases (if no callers remain) |
| `packages/ui-office/src/__tests__/provider-gateway.test.ts` | Update alias test |

---

## Plan 3: CI static guard (P2-1)

**Goal**: Add a CI script that blocks vendor-direct API patterns from entering production code.

### Steps

1. Create `scripts/check-provider-policy.sh`:

   ```bash
   #!/usr/bin/env bash
   # AI Runtime Policy — CI static guard
   # Blocks vendor-direct API patterns in production code.
   set -euo pipefail

   FORBIDDEN_PATTERNS=(
     "new OpenAI("
     "new Anthropic("
     "api.openai.com"
     "api.anthropic.com"
     "openrouter.ai"
   )

   SCAN_DIRS=(
     "apps/web/src"
     "apps/market/src"
     "packages/ui-office/src"
   )

   EXCLUDE_PATTERNS=(
     "__tests__"
     "e2e/"
     ".test.ts"
     ".test.tsx"
     "gateway-factory.ts"
     "openai-adapter.ts"
     "anthropic-adapter.ts"
     "subscription-adapter.ts"
     "desktop-provider-secrets.ts"
   )

   FOUND=0

   for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
     EXCLUDE_ARGS=""
     for exc in "${EXCLUDE_PATTERNS[@]}"; do
       EXCLUDE_ARGS="$EXCLUDE_ARGS --glob=!*${exc}*"
     done

     for dir in "${SCAN_DIRS[@]}"; do
       if [ -d "$dir" ]; then
         MATCHES=$(rg --fixed-strings "$pattern" "$dir" $EXCLUDE_ARGS 2>/dev/null || true)
         if [ -n "$MATCHES" ]; then
           echo "AI Runtime Policy violation: '$pattern' found in production code:"
           echo "$MATCHES"
           FOUND=1
         fi
       fi
     done
   done

   if [ "$FOUND" -eq 1 ]; then
     echo ""
     echo "Production code must not contain vendor-direct API references."
     echo "See CLAUDE.md — AI Runtime Policy."
     exit 1
   fi

   echo "AI Runtime Policy check passed"
   ```

2. Make executable:
   ```bash
   chmod +x scripts/check-provider-policy.sh
   ```

3. Add to root `package.json` scripts:
   ```json
   "check:provider-policy": "bash scripts/check-provider-policy.sh"
   ```

4. Add to `turbo.json` tasks (if using Turborepo for CI):
   ```json
   "check:provider-policy": {
     "cache": false
   }
   ```

5. If GitHub Actions CI exists (check `.github/workflows/`), add a step:
   ```yaml
   - name: Check AI Runtime Policy
     run: pnpm check:provider-policy
   ```

6. Local verification:
   ```bash
   bash scripts/check-provider-policy.sh
   # Should print: "AI Runtime Policy check passed"
   ```

7. Negative test — temporarily add a violation and confirm detection:
   ```bash
   echo "// api.openai.com" >> apps/web/src/lib/browser-runtime.ts
   bash scripts/check-provider-policy.sh
   # Should fail with violation message
   git checkout apps/web/src/lib/browser-runtime.ts
   ```

### Acceptance

- Script passes on current codebase
- Script catches vendor-direct patterns when added to production code
- CI pipeline runs the check (if CI exists)

### Files

| File | Action |
|------|--------|
| `scripts/check-provider-policy.sh` | New — CI guard script |
| `package.json` (root) | Add `check:provider-policy` script |
| `turbo.json` | Add task (optional) |
| `.github/workflows/*.yml` | Add CI step (if exists) |

---

## Execution order

1. **Plan 1** first — may surface compile errors that need fixing
2. **Plan 2** second — simple text replacement, low risk
3. **Plan 3** third — additive, no existing code changes
