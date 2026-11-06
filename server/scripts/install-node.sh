#!/usr/bin/env bash
set -euo pipefail
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo 'The pinned Node.js installer supports Linux x86_64.' >&2
  exit 2
fi
version=24.22.2
checksum=48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75
node_dir=${MD2DOCX_NODE_DIR:-"$HOME/.local/md2docx-node"}
if [[ -x "$node_dir/bin/node" ]] && [[ "$("$node_dir/bin/node" --version)" == "v$version" ]] && "$node_dir/bin/node" "$node_dir/lib/node_modules/npm/bin/npm-cli.js" ci --help >/dev/null 2>&1; then
  echo "Node.js v$version already installed: $node_dir"
  exit 0
fi
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
archive="node-v${version}-linux-x64.tar.xz"
base_url=${MD2DOCX_NODE_DOWNLOAD_BASE:-https://nodejs.org/dist}
curl -fL --retry 2 --connect-timeout 15 --max-time 180 "$base_url/v$version/$archive" -o "$tmp/$archive"
printf '%s  %s\n' "$checksum" "$tmp/$archive" | sha256sum --check -
mkdir -p "$tmp/runtime" "$(dirname -- "$node_dir")"
tar -xJf "$tmp/$archive" --strip-components=1 -C "$tmp/runtime"
if [[ -e "$node_dir" ]]; then
  mv -- "$node_dir" "${node_dir}.previous-$(date +%s)-$$"
fi
mv -- "$tmp/runtime" "$node_dir"
"$node_dir/bin/node" --version
