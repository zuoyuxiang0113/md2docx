#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$project_root"
python_bin=${MD2DOCX_SERVER_PYTHON:-"$HOME/miniconda3/envs/md2docx/bin/python"}
if [[ ! -x "$python_bin" ]]; then
  echo "Set MD2DOCX_SERVER_PYTHON to the md2docx environment Python." >&2
  exit 2
fi
exec "$python_bin" -m server --host "${MD2DOCX_HOST:-127.0.0.1}" --port "${MD2DOCX_PORT:-8000}" "$@"
