Param(
  [string]$Query = "What dental benefits are available?",
  [string]$CompanyId = "amerivet",
  [string]$Url = "http://localhost:3000/api/qa",
  [int]$TimeoutSec = 30
)

# Wait for port 3000 to be ready (best-effort)
$maxRetries = 20; $i = 0
while ($i -lt $maxRetries) {
  $conn = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
  if ($conn) { break }
  Start-Sleep -Seconds 1
  $i++
}

$body = @{ query = $Query; companyId = $CompanyId } | ConvertTo-Json
try {
  $resp = Invoke-RestMethod -Uri $Url -Method Post -Body $body -ContentType "application/json" -TimeoutSec $TimeoutSec
  [PSCustomObject]@{
    UniqueDocIds   = $resp.metadata.distinctDocIds
    RerankedCount  = $resp.metadata.rerankedCount
    GroundingScore = $resp.metadata.groundingScore
  } | Format-List
}
catch {
  Write-Error $_
  exit 1
}
