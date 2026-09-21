# Creates/updates a desktop shortcut pointing at THIS project's launcher .bat,
# rebuilt every run so it always points at the .bat's current location
# (same mechanism as file_search's share-gateway\make-shortcut.ps1, minus the
# custom icon conversion - this project has no source image for one yet).
param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [Parameter(Mandatory = $true)][string]$BatPath
)

$ErrorActionPreference = 'Stop'

$desktop = [Environment]::GetFolderPath('Desktop')
$lnkPath = Join-Path $desktop 'Ollama 聊天室.lnk'

$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut($lnkPath)
$lnk.TargetPath = $BatPath
$lnk.WorkingDirectory = $ProjectRoot
$lnk.Description = 'Ollama 聊天室 - 本機/區網/公網（ngrok）聊天視窗'
# always interactive (asks LAN/public + password) - keep the console window visible.
$lnk.WindowStyle = 1
$lnk.Save()

Write-Host "[shortcut] desktop shortcut ready: $lnkPath"
