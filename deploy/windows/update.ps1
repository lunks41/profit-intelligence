# Updates an installed Profit Intelligence to a new release.
# On the server: unzip the new release OVER the app folder (the zip has no .env and no logs, so those are kept), then run
#   powershell -ExecutionPolicy Bypass -File .\update.ps1
# It stops the API and worker, applies new database migrations, and starts them again. Take a database backup first
# (docs\operations\backup-restore.md).
#requires -RunAsAdministrator
param([string]$SiteName = 'profit-intelligence')

$ErrorActionPreference = 'Stop'
$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node).Source

Write-Host 'Stopping the API and the worker'
foreach ($t in 'ProfitIntelligence-Api', 'ProfitIntelligence-Worker') {
  Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like "*$AppRoot*" -and $_.CommandLine -notlike '*next*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Write-Host 'Applying database migrations'
Push-Location (Join-Path $AppRoot 'apps\api')
try {
  & $node --env-file=..\..\.env node_modules\@pi\db\dist\cli.js migrate
  if ($LASTEXITCODE -ne 0) { throw 'The migrations failed. The old version is stopped; fix the problem or restore the backup.' }
} finally { Pop-Location }

Write-Host 'Starting the API and the worker'
foreach ($t in 'ProfitIntelligence-Api', 'ProfitIntelligence-Worker') { Start-ScheduledTask -TaskName $t }

Write-Host 'Restarting the web site'
Import-Module WebAdministration
Restart-WebAppPool -Name $SiteName
Write-Host 'Done.' -ForegroundColor Green
