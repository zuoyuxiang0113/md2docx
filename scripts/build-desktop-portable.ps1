param([string]$Node = "node")
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$desktopRoot = Join-Path $projectRoot "desktop"
$electronRoot = Join-Path $desktopRoot "node_modules\electron\dist"
$cliRoot = Join-Path $projectRoot "release\cli\md2docx"
$target = Join-Path $projectRoot "release\desktop\MD2DOCX-portable"

if (!(Test-Path -LiteralPath (Join-Path $electronRoot "electron.exe"))) { throw "Electron runtime is missing. Install desktop dependencies first." }
if (!(Test-Path -LiteralPath (Join-Path $cliRoot "md2docx.exe"))) { throw "CLI release is missing. Run scripts/build-cli.ps1 first." }

& npm run build --prefix $desktopRoot
if ($LASTEXITCODE -ne 0) { throw "Desktop frontend build failed." }

if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -Path (Join-Path $electronRoot "*") -Destination $target -Recurse -Force
Move-Item -LiteralPath (Join-Path $target "electron.exe") -Destination (Join-Path $target "MD2DOCX.exe")

$resources = Join-Path $target "resources"
$appTarget = Join-Path $resources "app"
New-Item -ItemType Directory -Path (Join-Path $appTarget "src") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $resources "core") -Force | Out-Null

$desktopPackage = Get-Content -LiteralPath (Join-Path $desktopRoot "package.json") -Raw | ConvertFrom-Json
$package = @{
  name = "md2docx"
  productName = "MD2DOCX"
  version = $desktopPackage.version
  main = "src/main.cjs"
} | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $appTarget "package.json"), $package, [System.Text.UTF8Encoding]::new($false))

Copy-Item -LiteralPath (Join-Path $desktopRoot "dist") -Destination (Join-Path $appTarget "dist") -Recurse -Force
Get-ChildItem -LiteralPath (Join-Path $desktopRoot "src") -File | Where-Object { $_.Extension -eq ".cjs" } | Copy-Item -Destination (Join-Path $appTarget "src") -Force
Copy-Item -LiteralPath (Join-Path $desktopRoot "src\app-defaults.json") -Destination (Join-Path $appTarget "src\app-defaults.json") -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "core\defaults.json") -Destination (Join-Path $resources "core\defaults.json") -Force
Copy-Item -LiteralPath $cliRoot -Destination (Join-Path $resources "cli") -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot "THIRD-PARTY-NOTICES.txt") -Destination $target -Force

Write-Output "Desktop portable release generated: $target\MD2DOCX.exe"
