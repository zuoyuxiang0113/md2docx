"""Snapshot the installed runtime dependency closure, not unrelated dev packages."""
from importlib.metadata import distribution
from pathlib import Path
from packaging.markers import default_environment
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

root = Path(__file__).resolve().parents[1]
seen = {}
env = {**default_environment(), "extra": ""}

def visit(name):
    name = canonicalize_name(name)
    if name in seen:
        return
    package = distribution(name)
    seen[name] = package.version
    for value in package.requires or []:
        requirement = Requirement(value)
        if requirement.marker is None or requirement.marker.evaluate(env):
            visit(requirement.name)

for line in (root / "requirements.txt").read_text().splitlines():
    if line and not line.startswith("#"):
        visit(Requirement(line).name)
content = "# Resolved on Linux / Python 3.14.7. Regenerate only after deliberate dependency updates.\n"
content += "\n".join(f"{name}=={version}" for name, version in sorted(seen.items())) + "\n"
(root / "requirements-lock.txt").write_text(content)
print(content)
