#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 || ! -d "$1/bin" ]]; then
  echo "Usage: bash env/install-pandoc.sh <existing-conda-environment-prefix>" >&2
  exit 2
fi
if [[ "$(uname -s)" != Linux || "$(uname -m)" != x86_64 ]]; then
  echo "This pinned Pandoc artifact supports Linux x86_64 only." >&2
  exit 2
fi
version=3.12.1
project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
mkdir -p "$1/share/licenses/pandoc"
cp "$project_root/runtime/pandoc/COPYRIGHT.txt" "$1/share/licenses/pandoc/COPYRIGHT.txt"
cp "$project_root/runtime/pandoc/COPYING.rtf" "$1/share/licenses/pandoc/COPYING.rtf"
expected=d0c90410e90204c9ca83b8539fac5c7aed01fd537207e4585849f8abc5df20b8
if [[ -x "$1/bin/pandoc" ]] && [[ "$("$1/bin/pandoc" --version | head -n 1)" == "pandoc $version" ]]; then
  echo "Pandoc $version is already installed in $1"
  exit 0
fi
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
archive="$work/pandoc.tar.gz"
curl --fail --location --retry 3 --connect-timeout 15 --max-time 300 \
  "https://github.com/jgm/pandoc/releases/download/$version/pandoc-$version-linux-amd64.tar.gz" \
  --output "$archive"
printf '%s  %s\n' "$expected" "$archive" | sha256sum --check -
tar --extract --gzip --file "$archive" --directory "$work"
install -m 0755 "$work/pandoc-$version/bin/pandoc" "$1/bin/pandoc"
"$1/bin/pandoc" --version | head -n 2
