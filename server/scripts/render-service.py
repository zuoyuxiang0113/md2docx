"""Generate a reviewable unit; never installs or starts system services."""
import argparse
import grp
import os
from pathlib import Path
import pwd
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--data-dir", type=Path, required=True)
args = parser.parse_args()
if os.getuid() == 0:
    parser.error("Generate and run this service as a dedicated unprivileged user, not root")
project = Path(__file__).resolve().parents[2]
values = {"USER": pwd.getpwuid(os.getuid()).pw_name, "GROUP": grp.getgrgid(os.getgid()).gr_name,
          "PROJECT": str(project), "DATA": str(args.data_dir.resolve()), "PYTHON": sys.executable}
if any(any(c.isspace() or c in '%\"\\' for c in v) for v in values.values()):
    parser.error("Unit paths/account names must not contain whitespace or systemd escape characters")
args.data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
unit = (project / "server/deploy/md2docx.service.in").read_text()
for key, value in values.items():
    unit = unit.replace("@" + key + "@", value)
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(unit)
print(args.output.resolve())
