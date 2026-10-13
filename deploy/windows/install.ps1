# First install of Profit Intelligence on this Windows server.
# Run once, in an elevated PowerShell, from the folder it was unpacked in (for example D:\Proj\profit-intelligence\app):
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# It: checks Node and PostgreSQL, writes .env with freshly generated secrets (it asks for the Postgres password and the
# Shopify app key and secret, and never prints them), creates the database and its two roles, runs the migrations,
# starts the API and the worker as startup tasks that restart if they stop, and creates the IIS site with an https
# binding for the host name. Nothing is sent anywhere. Re-running it is safe: an existing .env is kept.
#requires -RunAsAdministrator
param(
  [string]$HostName = 'profit.archipelago.ae',
  [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin',
  [string]$SiteName = 'profit-intelligence',
  [int]$PgPort = 5432,
  # remove the host name from another IIS site that already holds it (for example an old placeholder site)
  [switch]$TakeOverBinding
)

$ErrorActionPreference = 'Stop'
$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Logs = Join-Path $AppRoot 'logs'
$Env_ = Join-Path $AppRoot '.env'
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Fail($t) { Write-Host "ERROR: $t" -ForegroundColor Red; exit 1 }
function Plain([System.Security.SecureString]$s) {
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
function Random-Hex([int]$bytes) {
  $b = New-Object byte[] $bytes
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
  -join ($b | ForEach-Object { $_.ToString('x2') })
}

Step 'Checking Node.js'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Fail 'Node.js is not installed or not on the PATH. Install Node 22 or newer.' }
$major = [int]((& $node --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) { Fail "Node $major found; Node 22 or newer is needed." }
Write-Host "Node $major at $node"

Step 'Checking PostgreSQL'
if (-not (Test-Path (Join-Path $PgBin 'psql.exe'))) { Fail "psql.exe not found in $PgBin. Pass -PgBin with the folder of your PostgreSQL bin." }

if (-not (Test-Path $Env_)) {
  Step 'Writing .env (secrets are generated here and never shown)'
  $pgPass = Plain (Read-Host 'PostgreSQL superuser (postgres) password' -AsSecureString)
  $shopKey = Read-Host 'Shopify app Client ID (SHOPIFY_API_KEY)'
  $shopSecret = Plain (Read-Host 'Shopify app Client secret (SHOPIFY_API_SECRET)' -AsSecureString)
  $appPass = Random-Hex 24
  $tokenKey = [Convert]::ToBase64String((1..32 | ForEach-Object { [byte](Get-Random -Maximum 256) }))
  $enc = { param($v) [uri]::EscapeDataString($v) }
  $lines = @(
    'NODE_ENV=production',
    'LOG_LEVEL=info',
    "DATABASE_ADMIN_URL=postgresql://postgres:$(& $enc $pgPass)@localhost:$PgPort/profit_intelligence",
    "DATABASE_URL=postgresql://app_user:$appPass@localhost:$PgPort/profit_intelligence",
    "APP_DB_PASSWORD=$appPass",
    # the database is on this same machine, so the connection does not use TLS
    'ALLOW_INSECURE_DB=true',
    'WEB_PORT=3000', 'API_PORT=3001', 'WORKER_HEALTH_PORT=3002',
    "APP_URL=https://$HostName",
    "SHOPIFY_API_KEY=$shopKey",
    "SHOPIFY_API_SECRET=$shopSecret",
    'SHOPIFY_SCOPES=read_orders,read_products,read_inventory,read_shopify_payments_accounts,read_shopify_payments_payouts',
    'SHOPIFY_API_VERSION=2026-10',
    "TOKEN_ENCRYPTION_KEY=$tokenKey",
    'TOKEN_ENCRYPTION_KEY_ID=k1',
    'BILLING_MODE=off',
    'BILLING_OFF_PLAN=pro',
    'BILLING_TEST_MODE=true'
  )
  Set-Content -Path $Env_ -Value $lines -Encoding ascii
  # only administrators and the system may read it
  icacls $Env_ /inheritance:r /grant:r 'Administrators:F' 'SYSTEM:F' | Out-Null
  Remove-Variable pgPass, shopSecret, appPass, tokenKey
  Write-Host '.env written. Keep a copy of TOKEN_ENCRYPTION_KEY somewhere safe: without it stored Shopify tokens cannot be read.'
} else {
  Write-Host '.env already exists and is kept.'
}

Step 'Creating the database, its roles and the tables'
Push-Location (Join-Path $AppRoot 'apps\api')
try {
  & $node --env-file=..\..\.env node_modules\@pi\db\dist\cli.js setup
  if ($LASTEXITCODE -ne 0) { Fail 'The database setup failed (see the message above).' }
} finally { Pop-Location }

Step 'Starting the API and the worker (startup tasks that restart if they stop)'
function Register-Service($name, $dir, $entry, $log) {
  $cmd = "/c `"`"$node`" --env-file=..\..\.env $entry >> `"$Logs\$log`" 2>&1`""
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmd -WorkingDirectory (Join-Path $AppRoot "apps\$dir")
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
  Start-ScheduledTask -TaskName $name
  Write-Host "$name started"
}
Register-Service 'ProfitIntelligence-Api' 'api' 'dist\main.js' 'api.log'
Register-Service 'ProfitIntelligence-Worker' 'worker' 'dist\main.js' 'worker.log'

Step 'Checking that the API answers'
$ok = $false
foreach ($i in 1..20) {
  try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3001/health' -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch { Start-Sleep -Seconds 2 }
}
if ($ok) { Write-Host 'API is up' } else { Write-Host "The API did not answer in 40 seconds. Read $Logs\api.log" -ForegroundColor Yellow }

Step "Creating the IIS site $SiteName for $HostName"
Import-Module WebAdministration
$webDir = Join-Path $AppRoot 'apps\web'
$cfg = Join-Path $webDir 'web.config'
(Get-Content $cfg -Raw).Replace('__NODE__', $node).Replace('__LOGS__', $Logs) | Set-Content $cfg -Encoding utf8
if (-not (Test-Path "IIS:\AppPools\$SiteName")) {
  New-WebAppPool -Name $SiteName | Out-Null
  Set-ItemProperty "IIS:\AppPools\$SiteName" managedRuntimeVersion ''
  Set-ItemProperty "IIS:\AppPools\$SiteName" startMode 'AlwaysRunning'
  Set-ItemProperty "IIS:\AppPools\$SiteName" processModel.idleTimeout '00:00:00'
}
icacls $Logs /grant "IIS AppPool\${SiteName}:(OI)(CI)M" | Out-Null
icacls $webDir /grant "IIS AppPool\${SiteName}:(OI)(CI)RX" | Out-Null
icacls $Env_ /grant "IIS AppPool\${SiteName}:R" | Out-Null
# another IIS site holding this host name would stop ours from starting (IIS answers 'file already exists')
foreach ($b in @(Get-WebBinding | Where-Object { $_.bindingInformation -like "*:$HostName" })) {
  $other = if ($b.ItemXPath -match "@name='([^']+)'") { $Matches[1] } else { '' }
  if ($other -and $other -ne $SiteName) {
    $port = ($b.bindingInformation -split ':')[1]
    if ($TakeOverBinding) {
      Remove-WebBinding -Name $other -Protocol $b.protocol -Port $port -HostHeader $HostName
      Write-Host "Removed $($b.protocol) $HostName from the IIS site '$other'"
    } else {
      Write-Host "The IIS site '$other' already has the binding $($b.protocol) $HostName. Run this script again with -TakeOverBinding to move it to $SiteName, or remove it in IIS Manager." -ForegroundColor Yellow
    }
  }
}
if (-not (Get-Website -Name $SiteName -ErrorAction SilentlyContinue)) {
  New-Website -Name $SiteName -PhysicalPath $webDir -ApplicationPool $SiteName -Port 80 -HostHeader $HostName | Out-Null
}
$cert = Get-ChildItem Cert:\LocalMachine\My | Where-Object { $_.Subject -like '*archipelago.ae*' -or $_.DnsNameList.Unicode -contains '*.archipelago.ae' } |
  Sort-Object NotAfter -Descending | Select-Object -First 1
if (-not $cert) {
  Write-Host 'No *.archipelago.ae certificate found in LocalMachine\My. Add the https binding by hand in IIS Manager.' -ForegroundColor Yellow
} else {
  if (-not (Get-WebBinding -Name $SiteName -Protocol https -HostHeader $HostName)) {
    New-WebBinding -Name $SiteName -Protocol https -Port 443 -HostHeader $HostName -SslFlags 1
  }
  (Get-WebBinding -Name $SiteName -Protocol https -HostHeader $HostName).AddSslCertificate($cert.Thumbprint, 'My')
  Write-Host "https binding added with the certificate valid until $($cert.NotAfter.ToString('yyyy-MM-dd'))"
}
Start-Website -Name $SiteName -ErrorAction SilentlyContinue

Write-Host "`nDone. Next:" -ForegroundColor Green
Write-Host "  1. DNS: point $HostName at this server's public address, and open port 443 to it."
Write-Host "  2. Open https://$HostName/api/health on this machine, then from outside."
Write-Host "  3. In shopify.app.toml (on your development PC) set application_url to https://$HostName and the redirect_urls to match, then run shopify app deploy yourself when you are ready."
Write-Host "  4. To see which ad platforms are ready: node --env-file=.env ads-check.mjs  (from this folder). Logs are in $Logs."
