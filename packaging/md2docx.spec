from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, copy_metadata

root = Path(SPECPATH).parent
datas = [(str(root / "core" / "defaults.json"), "core")]
datas += collect_data_files("docx")
for distribution in ("python-docx", "lxml", "typing_extensions"):
    datas += copy_metadata(distribution)

analysis = Analysis(
    [str(root / "cli" / "md2docx.py")],
    pathex=[str(root)],
    binaries=[],
    datas=datas,
    hiddenimports=["docx", "lxml.etree", "lxml._elementpath"],
    hookspath=[],
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
pyz = PYZ(analysis.pure)
exe = EXE(pyz, analysis.scripts, [], exclude_binaries=True, name="md2docx", debug=False, strip=False, upx=False, console=True)
collection = COLLECT(exe, analysis.binaries, analysis.datas, strip=False, upx=False, name="md2docx")
