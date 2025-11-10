Param(
  [string]$ApiKey = $env:AZURE_SEARCH_API_KEY,
  [string]$SearchEndpoint = $env:AZURE_SEARCH_ENDPOINT,
  [string]$ServiceName = $env:AZURE_SEARCH_SERVICE_NAME,
  [string]$EnvPath = "C:\Users\sonal\secrets\benefitsaichatbot-383\.env.production",
  [string]$Query = "What dental benefits are available?",
  [string]$CompanyId = "amerivet",
  [switch]$StartDevServer = $true
)

Write-Host "=== Full Rebuild + Ingest + Probe ===" -ForegroundColor Cyan

# 1) Recreate index
$recreateArgs = @()
if ($ApiKey) { $recreateArgs += @('-ApiKey', $ApiKey) }
if ($SearchEndpoint) { $recreateArgs += @('-SearchEndpoint', $SearchEndpoint) }
if ($ServiceName) { $recreateArgs += @('-ServiceName', $ServiceName) }

Write-Host "[1/4] Recreating index..." -ForegroundColor Yellow
powershell -ExecutionPolicy Bypass -File scripts\azure-search-recreate-index.ps1 @recreateArgs
if ($LASTEXITCODE -ne 0) { Write-Error "Index recreation failed."; exit 1 }

# 2) Run ingestion
Write-Host "[2/4] Running ingestion..." -ForegroundColor Yellow
python .\ingest_real_documents_sdk.py
if ($LASTEXITCODE -ne 0) { Write-Error "Ingestion script failed."; exit 1 }

# 3) Ensure dev server is running
$serverReady = $false
Write-Host "[3/4] Checking dev server on port 3000..." -ForegroundColor Yellow
try {
  $conn = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
  if (-not $conn -and $StartDevServer) {
    Write-Host "Starting dev server (npm run dev) in a new window..." -ForegroundColor DarkGray
    Start-Process -FilePath "npm" -ArgumentList "run","dev" -WindowStyle Minimized
  }
} catch {}

# Wait up to 45s for port 3000
$retries = 45
while ($retries -gt 0) {
  $conn = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
  if ($conn) { $serverReady = $true; break }
  Start-Sleep -Seconds 1
  $retries--
}
if (-not $serverReady) { Write-Error "Dev server not reachable on port 3000"; exit 1 }

# 4) Probe docId diversity
Write-Host "[4/4] Probing /api/qa for docIdCount..." -ForegroundColor Yellow
powershell -ExecutionPolicy Bypass -File scripts\probe-docid-diversity.ps1 -Query $Query -CompanyId $CompanyId
if ($LASTEXITCODE -ne 0) { Write-Error "Probe failed."; exit 1 }

Write-Host "Done. Review UniqueDocIds in output (target >= 8)." -ForegroundColor Green
