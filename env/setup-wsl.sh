#!/usr/bin/env bash
set -euo pipefail
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"
conda_bin=${MD2DOCX_CONDA_EXE:-"$HOME/miniconda3/bin/conda"}
if [[ ! -x "$conda_bin" ]]; then
  echo "Set MD2DOCX_CONDA_EXE to a working Linux Conda executable." >&2
  exit 2
fi
if ! "$conda_bin" run -n md2docx python --version >/dev/null 2>&1; then
  "$conda_bin" env create -f env/environment.yml -y
fi
"$conda_bin" run -n md2docx python -c 'import sys; assert sys.version_info[:2] == (3, 14), "Expected Python 3.14"'
pip_index=${MD2DOCX_PIP_INDEX_URL:-https://pypi.tuna.tsinghua.edu.cn/simple}
pip_args=(--index-url "$pip_index" --timeout 20 --retries 2)
if [[ -d env/verification/wheels ]]; then
  pip_args+=(--find-links env/verification/wheels)
fi
"$conda_bin" run --no-capture-output -n md2docx python -m pip install "${pip_args[@]}" pip==26.2.2 setuptools==84.2.1 wheel==0.48.0
"$conda_bin" run --no-capture-output -n md2docx python -m pip install "${pip_args[@]}" --no-build-isolation -r env/requirements.txt
prefix=$("$conda_bin" run -n md2docx python -c 'import sys; print(sys.prefix)')
bash env/install-pandoc.sh "$prefix"
"$conda_bin" run --no-capture-output -n md2docx python -m pip check
"$conda_bin" run --no-capture-output -n md2docx python cli/md2docx.py doctor --json
