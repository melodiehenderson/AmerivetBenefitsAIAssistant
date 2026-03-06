# Update Azure Search Index with Semantic Configuration
# This script adds/updates the semantic configuration for chunks_prod_v1 index
# Run this script to enable semantic search capabilities

param(
    [Parameter(Mandatory=$false)]
    [string]$SearchServiceName = $env:AZURE_SEARCH_SERVICE_NAME,
    
    [Parameter(Mandatory=$false)]
    [string]$SearchApiKey = $env:AZURE_SEARCH_API_KEY,
    
    [Parameter(Mandatory=$false)]
    [string]$IndexName = "chunks_prod_v1"
)

Write-Host "=== Azure Search Index Update ===" -ForegroundColor Cyan
Write-Host ""

# Validate parameters
if ([string]::IsNullOrWhiteSpace($SearchServiceName)) {
    Write-Host "ERROR: AZURE_SEARCH_SERVICE_NAME not set" -ForegroundColor Red
    Write-Host "Usage: .\update-search-index.ps1 -SearchServiceName <name> -SearchApiKey <key>" -ForegroundColor Yellow
    exit 1
}

if ([string]::IsNullOrWhiteSpace($SearchApiKey)) {
    Write-Host "ERROR: AZURE_SEARCH_API_KEY not set" -ForegroundColor Red
    exit 1
}

$SearchEndpoint = "https://$SearchServiceName.search.windows.net"
$ApiVersion = "2023-11-01"

Write-Host "Search Service: $SearchServiceName" -ForegroundColor Gray
Write-Host "Index Name: $IndexName" -ForegroundColor Gray
Write-Host ""

# Load the schema from JSON file
$SchemaPath = Join-Path $PSScriptRoot "search-index-schema.json"
if (-not (Test-Path $SchemaPath)) {
    Write-Host "ERROR: Schema file not found at $SchemaPath" -ForegroundColor Red
    exit 1
}

Write-Host "1. Loading schema from $SchemaPath..." -ForegroundColor Yellow
$Schema = Get-Content $SchemaPath -Raw | ConvertFrom-Json
Write-Host "   ✓ Schema loaded" -ForegroundColor Green
Write-Host ""

# Check if index exists
Write-Host "2. Checking if index exists..." -ForegroundColor Yellow
try {
    $GetIndexUrl = "$SearchEndpoint/indexes/$IndexName?api-version=$ApiVersion"
    $Headers = @{
        "api-key" = $SearchApiKey
        "Content-Type" = "application/json"
    }
    
    $ExistingIndex = Invoke-RestMethod -Uri $GetIndexUrl -Method Get -Headers $Headers -ErrorAction Stop
    Write-Host "   ✓ Index exists" -ForegroundColor Green
    $IndexExists = $true
} catch {
    if ($_.Exception.Response.StatusCode -eq 404) {
        Write-Host "   ! Index does not exist - will create new" -ForegroundColor Yellow
        $IndexExists = $false
    } else {
        Write-Host "   ERROR: Failed to check index" -ForegroundColor Red
        Write-Host "   $_" -ForegroundColor Red
        exit 1
    }
}
Write-Host ""

# Create or update index
if ($IndexExists) {
    Write-Host "3. Updating index with semantic configuration..." -ForegroundColor Yellow
    $Method = "Put"
    $Action = "updated"
} else {
    Write-Host "3. Creating index with semantic configuration..." -ForegroundColor Yellow
    $Method = "Put"
    $Action = "created"
}

try {
    $UpdateIndexUrl = "$SearchEndpoint/indexes/$IndexName?api-version=$ApiVersion&allowIndexDowntime=true"
    $SchemaJson = $Schema | ConvertTo-Json -Depth 20
    
    $Response = Invoke-RestMethod -Uri $UpdateIndexUrl `
        -Method $Method `
        -Headers $Headers `
        -Body $SchemaJson `
        -ErrorAction Stop
    
    Write-Host "   ✓ Index $Action successfully" -ForegroundColor Green
    Write-Host ""
    
    # Verify semantic configuration
    Write-Host "4. Verifying semantic configuration..." -ForegroundColor Yellow
    if ($Response.semantic -and $Response.semantic.configurations) {
        Write-Host "   ✓ Semantic configurations:" -ForegroundColor Green
        foreach ($config in $Response.semantic.configurations) {
            Write-Host "     - $($config.name)" -ForegroundColor Gray
            if ($config.name -eq $Response.semantic.defaultConfiguration) {
                Write-Host "       (default)" -ForegroundColor DarkGray
            }
        }
        Write-Host ""
        Write-Host "   Default configuration: $($Response.semantic.defaultConfiguration)" -ForegroundColor Green
    } else {
        Write-Host "   ! No semantic configuration found" -ForegroundColor Yellow
    }
    
} catch {
    Write-Host "   ERROR: Failed to $Action index" -ForegroundColor Red
    Write-Host "   $_" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $errorBody = $reader.ReadToEnd()
        Write-Host "   Response: $errorBody" -ForegroundColor Red
    }
    exit 1
}

Write-Host ""
Write-Host "=== Update Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Re-index your documents using the ingestion scripts" -ForegroundColor Gray
Write-Host "2. Verify the config with: .\test-qa-local.ps1" -ForegroundColor Gray
Write-Host "3. Test QA queries to confirm semantic search is working" -ForegroundColor Gray
