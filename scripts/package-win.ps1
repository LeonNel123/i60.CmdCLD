# Builds the Windows NSIS installer on machines without admin rights / Developer Mode.
#
# Why this exists: electron-builder's app-builder extracts winCodeSign-2.6.0.7z, which
# contains two macOS symlinks. Without the symlink-creation privilege, 7-Zip exits with
# code 2 and electron-builder aborts -- even though all Windows tools extract fine.
# We wrap 7za.exe with a shim (scripts/seven-zip-shim.cs) that maps that exit code to 0.
#
# Usage:  npm run package:win        (this script is what that npm script invokes)
#         pwsh -File scripts/package-win.ps1
#
# Idempotent: safe to re-run; re-applies the shim if npm reinstalled 7zip-bin.

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

$sevenZipDir = Join-Path $repo 'node_modules\7zip-bin\win\x64'
$realExe     = Join-Path $sevenZipDir '7za-real.exe'
$shimExe     = Join-Path $sevenZipDir '7za.exe'
$shimSrc     = Join-Path $repo 'scripts\seven-zip-shim.cs'

function Test-IsShim([string]$path) {
    # The shim is a tiny managed exe (< 32 KB); the real 7za.exe is ~1 MB.
    return (Test-Path $path) -and ((Get-Item $path).Length -lt 102400)
}

if (-not (Test-Path $sevenZipDir)) {
    throw "7zip-bin not found at $sevenZipDir -- run 'npm install' first."
}

# 1. Preserve the genuine 7za.exe as 7za-real.exe (only the first time).
if (-not (Test-Path $realExe)) {
    if (Test-IsShim $shimExe) {
        throw "7za.exe looks like a shim but 7za-real.exe is missing. Reinstall 7zip-bin (npm ci)."
    }
    Copy-Item $shimExe $realExe -Force
    Write-Host "package-win: preserved genuine 7-Zip as 7za-real.exe"
}

# 2. (Re)compile and install the shim if 7za.exe isn't already our shim.
if (-not (Test-IsShim $shimExe)) {
    $csc = Get-ChildItem 'C:\Windows\Microsoft.NET\Framework64' -Recurse -Filter csc.exe -ErrorAction SilentlyContinue |
        Select-Object -Last 1
    if (-not $csc) { throw "csc.exe (.NET Framework compiler) not found; cannot build the 7za shim." }

    $tmpExe = Join-Path $env:TEMP '7za-shim.exe'
    & $csc.FullName /nologo /optimize /target:exe "/out:$tmpExe" $shimSrc | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tmpExe)) { throw "Failed to compile the 7za shim." }

    Copy-Item $tmpExe $shimExe -Force
    Remove-Item $tmpExe -Force -ErrorAction SilentlyContinue
    Write-Host "package-win: installed 7za shim (maps symlink-only exit 2 -> 0)"
}

# 3. Build. Disable code-signing auto-discovery (no cert on this machine).
# Invoke the CLIs through `node` (a native exe) so PowerShell does not try to bind
# flags like --win to a cmdlet. Pass args as an array for reliable forwarding.
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
$viteCli    = Join-Path $repo 'node_modules\electron-vite\bin\electron-vite.js'
$builderCli = Join-Path $repo 'node_modules\electron-builder\out\cli\cli.js'

Write-Host "package-win: running electron-vite build ..."
& node $viteCli build
if ($LASTEXITCODE -ne 0) { throw "electron-vite build failed." }

Write-Host "package-win: running electron-builder --win nsis ..."
& node @($builderCli, '--win', 'nsis')
if ($LASTEXITCODE -ne 0) { throw "electron-builder failed." }

# Installer names carry the version (CmdCLD-Setup-1.2.3.exe) so GitHub Release assets
# and downloaded files are distinguishable. Read it from package.json rather than
# hardcoding, so this check follows artifactName automatically.
$version   = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $repo "dist\CmdCLD-Setup-$version.exe"
if (Test-Path $installer) {
    $mb = [math]::Round((Get-Item $installer).Length / 1MB, 1)
    Write-Host "package-win: SUCCESS -> dist\CmdCLD-Setup-$version.exe ($mb MB)"
} else {
    throw "Build reported success but dist\CmdCLD-Setup-$version.exe is missing."
}
