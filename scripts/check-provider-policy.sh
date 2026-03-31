#!/usr/bin/env bash
set -euo pipefail

# AI Runtime Policy — CI static guard
# Blocks vendor-direct API patterns in production code paths.

FORBIDDEN_PATTERNS=(
  "new OpenAI("
  "new Anthropic("
  "api.openai.com"
  "api.anthropic.com"
  "openrouter.ai"
)

SCAN_DIRS=(
  "apps/web/src"
  "packages/ui-office/src"
)

EXCLUDE_GLOBS=(
  "!**/__tests__/**"
  "!**/e2e/**"
  "!**/*.test.ts"
  "!**/*.test.tsx"
  "!**/gateway-factory.ts"
  "!**/openai-adapter.ts"
  "!**/anthropic-adapter.ts"
  "!**/subscription-adapter.ts"
  "!**/desktop-provider-secrets.ts"
  "!**/provider-presets.ts"
)

FOUND=0

for pattern in "${FORBIDDEN_PATTERNS[@]}"; do
  for dir in "${SCAN_DIRS[@]}"; do
    [ -d "$dir" ] || continue

    args=(--fixed-strings --glob '*.ts' --glob '*.tsx')
    for glob in "${EXCLUDE_GLOBS[@]}"; do
      args+=(--glob "$glob")
    done

    matches="$(rg "$pattern" "$dir" "${args[@]}" 2>/dev/null || true)"
    if [ -n "$matches" ]; then
      echo "AI Runtime Policy violation: '$pattern' found in production code:"
      echo "$matches"
      FOUND=1
    fi
  done
done

if [ "$FOUND" -eq 1 ]; then
  echo
  echo "Production code must not contain vendor-direct API references."
  echo "See CLAUDE.md — AI Runtime Policy."
  exit 1
fi

echo "AI Runtime Policy check passed"
