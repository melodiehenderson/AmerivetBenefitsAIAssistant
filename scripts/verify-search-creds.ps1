Param(
  [string]$EnvPath = "C:\Users\sonal\secrets\benefitsaichatbot-383\.env.production"
)
Write-Host "--- Verifying Azure Search credentials ---" -ForegroundColor Cyan
if (-not (Test-Path $EnvPath)) { Write-Error "Env file not found: $EnvPath"; exit 1 }
$lines = Get-Content $EnvPath
$endpoint = ($lines | Where-Object { $_ -match '^AZURE_SEARCH_ENDPOINT\s*=' } | Select-Object -First 1)
$serviceName = ($lines | Where-Object { $_ -match '^AZURE_SEARCH_SERVICE_NAME\s*=' } | Select-Object -First 1)
$apiKey = ($lines | Where-Object { $_ -match '^AZURE_SEARCH_API_KEY\s*=' } | Select-Object -First 1)
$result = [PSCustomObject]@{
  HasEndpoint    = [bool]$endpoint
  HasServiceName = [bool]$serviceName
  HasApiKey      = [bool]$apiKey
  EndpointValue  = if ($endpoint) { ($endpoint -split '=',2)[1].Trim() } else { $null }
  ServiceNameVal = if ($serviceName) { ($serviceName -split '=',2)[1].Trim() } else { $null }
  ApiKeyPrefix   = if ($apiKey) { ($apiKey -split '=',2)[1].Trim().Substring(0,6) + '...' } else { $null }
}
$result | Format-List
if (-not $result.HasApiKey) { Write-Error "Missing AZURE_SEARCH_API_KEY" }
if (-not ($result.HasEndpoint -or $result.HasServiceName)) { Write-Error "Need AZURE_SEARCH_ENDPOINT or AZURE_SEARCH_SERVICE_NAME" }
if (-not $result.HasApiKey -or -not ($result.HasEndpoint -or $result.HasServiceName)) { exit 1 }
Write-Host "Search credentials present." -ForegroundColor Green
