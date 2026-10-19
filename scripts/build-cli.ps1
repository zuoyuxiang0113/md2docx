param([string]$Python = "python")
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot "release"
$distRoot = Join-Path $releaseRoot "cli"
$buildRoot = Join-Path $projectRoot "build\cli"
$pandocRoot = Join-Path $projectRoot "runtime\pandoc"
if (!(Test-Path -LiteralPath (Join-Path $pandocRoot "pandoc.exe"))) { throw "runtime/pandoc/pandoc.exe is missing." }
& $Python -m PyInstaller --noconfirm --distpath $distRoot --workpath $buildRoot (Join-Path $projectRoot "packaging\md2docx.spec")
if ($LASTEXITCODE -ne 0) { throw "CLI build failed. Install build dependencies with: python -m pip install '.[build]'" }
$cliRoot = Join-Path $releaseRoot "cli\md2docx"
$runtimeTarget = Join-Path $cliRoot "runtime\pandoc"
New-Item -ItemType Directory -Path $runtimeTarget -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $pandocRoot "pandoc.exe") -Destination $runtimeTarget -Force
foreach ($name in @("COPYRIGHT.txt", "COPYING.rtf", "MANUAL.html")) {
    $source = Join-Path $pandocRoot $name
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $runtimeTarget -Force }
}
$profileTarget = Join-Path $cliRoot "profiles"
New-Item -ItemType Directory -Path $profileTarget -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot "core\defaults.json") -Destination (Join-Path $profileTarget "default.json") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "THIRD-PARTY-NOTICES.txt") -Destination $cliRoot -Force
Write-Output "CLI generated: $cliRoot\md2docx.exe"
