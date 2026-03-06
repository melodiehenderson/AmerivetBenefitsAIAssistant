Param(
    [string]$ServiceName = $env:AZURE_SEARCH_SERVICE_NAME,
    [string]$ApiKey = $env:AZURE_SEARCH_API_KEY,
    [string]$IndexName = "chunks_prod_v1",
    [string]$SchemaPath = "infra/azure/search/chunks_prod_v1.index.json",
    [string]$SearchEndpoint = $env:AZURE_SEARCH_ENDPOINT
)

Write-Host "--- Azure Search Index Recreate ---" -ForegroundColor Cyan
if (-not $ServiceName) {
    if ($SearchEndpoint) {
        try {
            $uri = [Uri]$SearchEndpoint
            $host = $uri.Host  # e.g., amerivetsearch.search.windows.net
            $ServiceName = $host.Split('.')[0]
            Write-Host "Derived ServiceName from endpoint: $ServiceName" -ForegroundColor DarkGray
        } catch {
            Write-Error "Failed to derive ServiceName from AZURE_SEARCH_ENDPOINT. Provide AZURE_SEARCH_SERVICE_NAME."; exit 1
        }
    } else {
        # Fallback: Try reading from .env.production
        $envFile = "C:\Users\sonal\secrets\benefitsaichatbot-383\.env.production"
        if (Test-Path $envFile) {
            $lines = Get-Content $envFile
            $endpointLine = $lines | Where-Object { $_ -match "^AZURE_SEARCH_ENDPOINT\s*=\s*" } | Select-Object -First 1
            if ($endpointLine) {
                $endpoint = ($endpointLine -split "=",2)[1].Trim()
                try {
                    $uri = [Uri]$endpoint
                    $host = $uri.Host
                    $ServiceName = $host.Split('.')[0]
                    Write-Host "Derived ServiceName from .env.production endpoint: $ServiceName" -ForegroundColor DarkGray
                    if (-not $SearchEndpoint) { $SearchEndpoint = $endpoint }
                } catch {
                    Write-Error "Failed to parse AZURE_SEARCH_ENDPOINT in .env.production"; exit 1
                }
            } else {
                Write-Error "ServiceName not provided and AZURE_SEARCH_ENDPOINT not found in .env.production"; exit 1
            }
        } else {
            Write-Error "ServiceName not provided (env AZURE_SEARCH_SERVICE_NAME) and no .env.production fallback found."; exit 1
        }
    }
}
if (-not $ApiKey) {
    # Fallback: Try reading from .env.production
    $envFile = "C:\Users\sonal\secrets\benefitsaichatbot-383\.env.production"
    if (Test-Path $envFile) {
        $lines = Get-Content $envFile
        $keyLine = $lines | Where-Object { $_ -match "^AZURE_SEARCH_API_KEY\s*=\s*" } | Select-Object -First 1
        if ($keyLine) {
            $ApiKey = ($keyLine -split "=",2)[1].Trim()
            Write-Host "Loaded AZURE_SEARCH_API_KEY from .env.production" -ForegroundColor DarkGray
        } else {
            Write-Error "ApiKey not provided and AZURE_SEARCH_API_KEY not found in .env.production"; exit 1
        }
    } else {
        Write-Error "ApiKey not provided (env AZURE_SEARCH_API_KEY) and no .env.production fallback found."; exit 1
    }
}
if (-not (Test-Path $SchemaPath)) { Write-Error "Schema file not found: $SchemaPath"; exit 1 }

# Use Data Plane REST API with api-key (no Azure login required)
if ($SearchEndpoint) {
    try {
        $uri = [Uri]$SearchEndpoint
        $baseUrl = "https://$($uri.Host)"
    } catch {
        Write-Error "SearchEndpoint '$SearchEndpoint' is not a valid URI"; exit 1
    }
} else {
    $baseUrl = "https://$ServiceName.search.windows.net"
}
$apiVersion = "2024-09-01-preview"

Write-Host "Deleting index '$IndexName' (if exists)..." -ForegroundColor Yellow
try {
    $deleteUrl = "$baseUrl/indexes/$IndexName?api-version=$apiVersion"
    Invoke-RestMethod -Method Delete -Uri $deleteUrl -Headers @{ "api-key" = $ApiKey } -ErrorAction Stop | Out-Null
    Write-Host "Deleted existing index." -ForegroundColor DarkGray
} catch {
    Write-Host "Index did not exist or delete skipped." -ForegroundColor DarkGray
}

Write-Host "Creating index '$IndexName'..." -ForegroundColor Yellow
$schema = Get-Content -Raw $SchemaPath | ConvertFrom-Json
$createUrl = "$baseUrl/indexes?api-version=$apiVersion"
Invoke-RestMethod -Method Post -Uri $createUrl -Headers @{ "Content-Type" = "application/json"; "api-key" = $ApiKey } -Body ($schema | ConvertTo-Json -Depth 10)

Write-Host "Index recreation complete." -ForegroundColor Green
