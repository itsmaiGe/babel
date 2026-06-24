<#
  Babel — Discord translator plugin: Windows uninstaller (no Node.js required).

  Usage:
    powershell -ExecutionPolicy Bypass -File Uninstall-Babel.ps1

  Restores the original Discord loader from backup and removes the Babel payload
  from every Discord desktop core it finds. Restart Discord afterwards.
#>
[CmdletBinding()]
param(
  [string]$BaseDir = (Join-Path $env:LOCALAPPDATA "Discord")
)

$ErrorActionPreference = "Stop"

$LoaderMarker   = "DiscordTranslatorMod desktop-core loader"
$PayloadDirName = "discord-translator-mod"
$BackupName     = "index.js.dtm-original"
$VanillaIndex   = "module.exports = require('./core.asar');`n"

$changed = 0

if (Test-Path $BaseDir) {
  Get-ChildItem -Path $BaseDir -Directory |
    Where-Object { $_.Name -match '^app-\d+\.\d+\.\d+$' } |
    ForEach-Object {
      $modules = Join-Path $_.FullName "modules"
      if (-not (Test-Path $modules)) { return }
      Get-ChildItem -Path $modules -Directory |
        Where-Object { $_.Name -match '^discord_desktop_core-\d+$' } |
        ForEach-Object {
          $core = Join-Path $_.FullName "discord_desktop_core"
          $indexPath  = Join-Path $core "index.js"
          $backupPath = Join-Path $core $BackupName
          $payloadDest = Join-Path $core $PayloadDirName
          $currentIndex = if (Test-Path $indexPath) { Get-Content -Raw $indexPath } else { "" }

          if (Test-Path $backupPath) {
            Copy-Item $backupPath $indexPath -Force
            Remove-Item $backupPath -Force
            $script:changed++
          }
          elseif ($currentIndex -like "*$LoaderMarker*") {
            Set-Content -NoNewline -Path $indexPath -Value $VanillaIndex
            $script:changed++
          }

          if (Test-Path $payloadDest) {
            Remove-Item -Recurse -Force $payloadDest
            $script:changed++
          }
        }
    }
}

Write-Host "Removed Babel from $changed desktop core item(s). Restart Discord."
