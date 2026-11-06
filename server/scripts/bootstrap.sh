#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$project_root"
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo "Bootstrap currently supports Linux x86_64 only." >&2
  exit 2
fi
conda_bin=${MD2DOCX_CONDA_EXE:-"$HOME/miniconda3/bin/conda"}
if [[ ! -x "$conda_bin" ]]; then
  echo "Install Linux Miniconda first, or set MD2DOCX_CONDA_EXE." >&2
  exit 2
fi
if ! command -v bwrap >/dev/null; then
  echo "Missing Bubblewrap. On Ubuntu: sudo apt-get update && sudo apt-get install bubblewrap" >&2
  exit 2
fi
if ! "$conda_bin" run -n md2docx python --version >/dev/null 2>&1; then
  "$conda_bin" create -n md2docx python=3.14.7 pip -y
fi
pip_index=${MD2DOCX_PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}
"$conda_bin" run --no-capture-output -n md2docx python -m pip install --index-url "$pip_index" --timeout 20 --retries 2 pip==26.2.2 setuptools==84.2.1 wheel==0.48.0
"$conda_bin" run --no-capture-output -n md2docx python -m pip install --index-url "$pip_index" --timeout 20 --retries 2 --no-build-isolation -r server/requirements-lock.txt -e .
prefix=$("$conda_bin" run -n md2docx python -c 'import sys; print(sys.prefix)')
bash server/scripts/install-pandoc.sh "$prefix"
"$conda_bin" run --no-capture-output -n md2docx python -m pip check
"$conda_bin" run --no-capture-output -n md2docx python cli/md2docx.py doctor --json
"$conda_bin" run --no-capture-output -n md2docx python -m server.check
printf '\nEnvironment ready. Start locally: bash server/scripts/run.sh\n'
