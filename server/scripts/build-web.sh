#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$project_root/server/web"
node_dir=${MD2DOCX_NODE_DIR:-"$HOME/.local/md2docx-node"}
if [[ -x "$node_dir/bin/node" ]]; then
  export PATH="$node_dir/bin:$PATH"
fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo 'Missing Linux Node.js. Run: bash server/scripts/install-node.sh' >&2
  exit 2
fi
node -e 'if(process.platform !== "linux" || Number(process.versions.node.split(".")[0]) < 22) { console.error("Use Linux Node.js 22.12+ (recommended: the pinned installer)."); process.exit(2); }'
npm ci --registry="${MD2DOCX_NPM_REGISTRY:-https://registry.npmmirror.com}" --fetch-timeout=30000 --fetch-retries=2 --no-audit --no-fund --ignore-scripts
npm run build
printf '\nWeb ready. Restart the server, then open / (not /docs).\n'
