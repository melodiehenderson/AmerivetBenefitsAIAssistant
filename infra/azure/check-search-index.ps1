# Check Azure Search Index Status
# This script verifies the index exists and has documents

param(
    [Parameter(Mandatory=$false)]
    [string]$SearchServiceName = $env:AZURE_SEARCH_SERVICE_NAME,
    
    [Parameter(Mandatory=$false)]
    [string]$SearchApiKey = $env:AZURE_SEARCH_API_KEY,
    
    [Parameter(Mandatory=$false)]
    [string]$IndexName = "chunks_prod_v1"
)

Write-Host "=== Azure Search Index Diagnostics ===" -ForegroundColor Cyan
Write-Host ""

# Validate parameters
if ([string]::IsNullOrWhiteSpace($SearchServiceName)) {
    Write-Host "ERROR: AZURE_SEARCH_SERVICE_NAME not set" -ForegroundColor Red
    Write-Host "Set it with: `$env:AZURE_SEARCH_SERVICE_NAME = 'your-service-name'" -ForegroundColor Yellow
    exit 1
}

if ([string]::IsNullOrWhiteSpace($SearchApiKey)) {
    Write-Host "ERROR: AZURE_SEARCH_API_KEY not set" -ForegroundColor Red
    exit 1
}

$SearchEndpoint = "https://$SearchServiceName.search.windows.net"
$ApiVersion = "2023-11-01"
$Headers = @{
    "api-key" = $SearchApiKey
    "Content-Type" = "application/json"
}

Write-Host "Service: $SearchEndpoint" -ForegroundColor Gray
Write-Host "Index: $IndexName" -ForegroundColor Gray
Write-Host ""

# 1. Check if index exists
Write-Host "1. Checking if index exists..." -ForegroundColor Yellow
try {
    $IndexUrl = "$SearchEndpoint/indexes/$IndexName?api-version=$ApiVersion"
    $Index = Invoke-RestMethod -Uri $IndexUrl -Method Get -Headers $Headers -ErrorAction Stop
    Write-Host "   ✓ Index exists" -ForegroundColor Green
} catch {
    if ($_.Exception.Response.StatusCode -eq 404) {
        Write-Host "   ✗ Index NOT FOUND" -ForegroundColor Red
        Write-Host "   Run: .\update-search-index.ps1 to create it" -ForegroundColor Yellow
        exit 1
    } else {
        Write-Host "   ✗ Error checking index: $_" -ForegroundColor Red
        exit 1
    }
}
Write-Host ""

# 2. Check semantic configuration
Write-Host "2. Checking semantic configuration..." -ForegroundColor Yellow
if ($Index.semantic -and $Index.semantic.configurations) {
    Write-Host "   ✓ Semantic configurations found:" -ForegroundColor Green
    foreach ($config in $Index.semantic.configurations) {
        $isDefault = if ($config.name -eq $Index.semantic.defaultConfiguration) { " (DEFAULT)" } else { "" }
        Write-Host "     - $($config.name)$isDefault" -ForegroundColor Gray
    }
} else {
    Write-Host "   ✗ NO semantic configuration" -ForegroundColor Red
    Write-Host "   Run: .\update-search-index.ps1 to add it" -ForegroundColor Yellow
}
Write-Host ""

# 3. Get document count
Write-Host "3. Checking document count..." -ForegroundColor Yellow
try {
    $StatsUrl = "$SearchEndpoint/indexes/$IndexName/stats?api-version=$ApiVersion"
    $Stats = Invoke-RestMethod -Uri $StatsUrl -Method Get -Headers $Headers -ErrorAction Stop
    $DocCount = $Stats.documentCount
    
    if ($DocCount -eq 0) {
        Write-Host "   ✗ Index is EMPTY (0 documents)" -ForegroundColor Red
        Write-Host "   Run ingestion script: python ingest_real_documents_sdk.py" -ForegroundColor Yellow
    } elseif ($DocCount -lt 10) {
        Write-Host "   ⚠ Only $DocCount documents (expected 100+)" -ForegroundColor Yellow
    } else {
        Write-Host "   ✓ $DocCount documents indexed" -ForegroundColor Green
    }
    
    Write-Host "   Storage size: $([math]::Round($Stats.storageSize / 1024 / 1024, 2)) MB" -ForegroundColor Gray
} catch {
    Write-Host "   ✗ Error getting stats: $_" -ForegroundColor Red
}
Write-Host ""

# 4. Test a simple search query
Write-Host "4. Testing search query..." -ForegroundColor Yellow
try {
    $SearchUrl = "$SearchEndpoint/indexes/$IndexName/docs/search?api-version=$ApiVersion"
    $SearchBody = @{
        search = "HSA"
        top = 5
        select = "chunk_id,content,company_id"
    } | ConvertTo-Json
    
    $SearchResults = Invoke-RestMethod -Uri $SearchUrl -Method Post -Headers $Headers -Body $SearchBody -ErrorAction Stop
    
    if ($SearchResults.value.Count -eq 0) {
        Write-Host "   ✗ No results for 'HSA' query" -ForegroundColor Red
        Write-Host "   Index may be empty or improperly configured" -ForegroundColor Yellow
    } else {
        Write-Host "   ✓ Found $($SearchResults.value.Count) results for 'HSA'" -ForegroundColor Green
        Write-Host "   Company IDs found: $($SearchResults.value.company_id | Select-Object -Unique | Join-String -Separator ', ')" -ForegroundColor Gray
    }
} catch {
    Write-Host "   ✗ Search query failed: $_" -ForegroundColor Red
}
Write-Host ""

# 5. Check vector search configuration
Write-Host "5. Checking vector search configuration..." -ForegroundColor Yellow
if ($Index.vectorSearch -and $Index.vectorSearch.profiles) {
    Write-Host "   ✓ Vector profiles found:" -ForegroundColor Green
    foreach ($profile in $Index.vectorSearch.profiles) {
        Write-Host "     - $($profile.name) (algorithm: $($profile.algorithm))" -ForegroundColor Gray
    }
} else {
    Write-Host "   ✗ NO vector search configuration" -ForegroundColor Red
}
Write-Host ""

# Summary
Write-Host "=== Summary ===" -ForegroundColor Cyan
$issues = @()

if (-not $Index.semantic) { $issues += "Missing semantic configuration" }
if ($DocCount -eq 0) { $issues += "Empty index (no documents)" }
if ($DocCount -lt 10 -and $DocCount -gt 0) { $issues += "Low document count ($DocCount)" }
if (-not $Index.vectorSearch) { $issues += "Missing vector search config" }

if ($issues.Count -eq 0) {
    Write-Host "✓ Index appears healthy!" -ForegroundColor Green
} else {
    Write-Host "⚠ Issues found:" -ForegroundColor Yellow
    foreach ($issue in $issues) {
        Write-Host "  - $issue" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "To fix:" -ForegroundColor Yellow
    Write-Host "1. Run: .\update-search-index.ps1    (adds semantic config)" -ForegroundColor Gray
    Write-Host "2. Run: python ingest_real_documents_sdk.py    (populates documents)" -ForegroundColor Gray
}

Write-Host ""
