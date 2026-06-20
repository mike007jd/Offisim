#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NODE_SERIES="24"
PNPM_VERSION="10.15.1"
NODE_DIR="${RUNNER_TEMP:-/tmp}/offisim-node-${NODE_SERIES}"

install_node_24() {
  local arch
  case "$(uname -m)" in
    arm64) arch="arm64" ;;
    x86_64) arch="x64" ;;
    *) echo "Unsupported macOS architecture: $(uname -m)" >&2; return 1 ;;
  esac

  local version
  version="$(curl -fsSL https://nodejs.org/dist/index.json | python3 -c 'import json, sys; print(next(item["version"] for item in json.load(sys.stdin) if item["version"].startswith("v24.")))')"
  local archive="node-${version}-darwin-${arch}.tar.gz"
  local base_url="https://nodejs.org/dist/${version}"

  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  curl -fsSLO "${base_url}/${archive}"
  curl -fsSLO "${base_url}/SHASUMS256.txt"
  grep " ${archive}$" SHASUMS256.txt | shasum -a 256 -c -
  tar -xzf "$archive" -C "$NODE_DIR" --strip-components=1
  rm -f "$archive" SHASUMS256.txt
  export PATH="$NODE_DIR/bin:$PATH"
}

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 19) ? 0 : 1)'; then
  install_node_24
fi

# Normalize every goal run to Node 24 even when the runner image exposes another supported major.
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_SERIES" ]]; then
  install_node_24
fi

npm install --global "pnpm@${PNPM_VERSION}"

printf 'goal_node='
node --version
printf 'goal_pnpm='
pnpm --version
printf 'goal_rustc='
rustc --version
printf 'goal_cargo='
cargo --version

pnpm install --frozen-lockfile
node .github/scripts/run-goal-capability-qa.mjs
