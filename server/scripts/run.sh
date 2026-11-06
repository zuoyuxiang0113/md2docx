#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$project_root"
python_bin=${MD2DOCX_SERVER_PYTHON:-""}
if [[ -z "$python_bin" ]]; then
  active_python=/nonexistent
  if [[ "${CONDA_DEFAULT_ENV:-}" == md2docx ]]; then active_python="${CONDA_PREFIX:-/nonexistent}/bin/python"; fi
  for candidate in "$active_python" "$HOME/miniconda3/envs/md2docx/bin/python" "$HOME/miniconda/envs/md2docx/bin/python"; do
    if [[ -x "$candidate" ]] && "$candidate" -c 'import fastapi, docx, server' >/dev/null 2>&1; then python_bin=$candidate; break; fi
  done
fi
if [[ ! -x "$python_bin" ]]; then
  echo "Set MD2DOCX_SERVER_PYTHON to the md2docx environment Python." >&2
  exit 2
fi
exec "$python_bin" -m server --host "${MD2DOCX_HOST:-127.0.0.1}" --port "${MD2DOCX_PORT:-8000}" "$@"
