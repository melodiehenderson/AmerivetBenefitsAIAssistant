#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Complete production readiness check for RAG system
.DESCRIPTION
    Verifies all components are configured correctly before testing
#>

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Production Readiness Check" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$allGood = $true

# 1. Check environment variables
Write-Host "1. Environment Configuration" -ForegroundColor Yellow
$envVars = @(
    "AZURE_OPENAI_ENDPOINT",
    "AZURE_OPENAI_DEPLOYMENT_NAME",
    "AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT",
    "AZURE_SEARCH_ENDPOINT",
    "AZURE_SEARCH_INDEX_NAME"
)

foreach ($var in $envVars) {
    $value = Get-Content .env.local | Select-String "^$var="
    if ($value) {
        $displayValue = ($value -split "=", 2)[1]
        if ($displayValue.Length -gt 50) {
            $displayValue = $displayValue.Substring(0, 47) + "..."
        }
        Write-Host "  [OK] $var = $displayValue" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] $var NOT FOUND" -ForegroundColor Red
        $allGood = $false
    }
}
Write-Host ""

# 2. Check Azure Search Index
Write-Host "2. Azure Search Index Status" -ForegroundColor Yellow
try {
    $searchKey = (Get-Content .env.local | Select-String "^AZURE_SEARCH_ADMIN_KEY=").ToString().Split("=", 2)[1]
    $headers = @{ "api-key" = $searchKey.Trim() }
    
    # Get index details
    $index = Invoke-RestMethod -Uri "https://amerivetsearch.search.windows.net/indexes/chunks_prod_v1?api-version=2023-11-01" -Headers $headers
    
    # Get document count
    $stats = Invoke-RestMethod -Uri "https://amerivetsearch.search.windows.net/indexes/chunks_prod_v1/stats?api-version=2023-11-01" -Headers $headers
    
    Write-Host "  Index Name: $($index.name)" -ForegroundColor White
    Write-Host "  Document Count: $($stats.documentCount)" -ForegroundColor White
    
    if ($stats.documentCount -eq 0) {
        Write-Host "  [WARNING] Index is EMPTY! Need to run ingestion." -ForegroundColor Yellow
        $allGood = $false
    } else {
        Write-Host "  [OK] Documents indexed" -ForegroundColor Green
    }
    
    # Check semantic configuration
    if ($index.semantic -and $index.semantic.configurations) {
        $semanticConfig = $index.semantic.configurations[0]
        Write-Host "  [OK] Semantic Config: $($semanticConfig.name)" -ForegroundColor Green
        
        # Guard against null/missing prioritizedContentFields
        if ($semanticConfig.prioritizedFields -and $semanticConfig.prioritizedFields.prioritizedContentFields) {
            $contentFields = $semanticConfig.prioritizedFields.prioritizedContentFields.fieldName -join ', '
            Write-Host "    - Content Fields: $contentFields" -ForegroundColor Gray
        } else {
            Write-Host "    - Content Fields: (none configured)" -ForegroundColor DarkGray
        }
        
        if ($index.semantic.defaultConfiguration) {
            Write-Host "    - Default: $($index.semantic.defaultConfiguration)" -ForegroundColor Gray
        }
    } else {
        Write-Host "  [FAIL] Semantic configuration NOT found" -ForegroundColor Red
        $allGood = $false
    }
    
    # Check vector search
    if ($index.vectorSearch -and $index.vectorSearch.profiles) {
        Write-Host "  [OK] Vector Search: $($index.vectorSearch.profiles.Count) profile(s)" -ForegroundColor Green
    } else {
        Write-Host "  [FAIL] Vector search NOT configured" -ForegroundColor Red
        $allGood = $false
    }
    
} catch {
    Write-Host "  [FAIL] Failed to check index: $($_.Exception.Message)" -ForegroundColor Red
    $allGood = $false
}
Write-Host ""

# 3. Check server is running
Write-Host "3. Development Server" -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/api/health" -TimeoutSec 5
    Write-Host "  [OK] Server is running" -ForegroundColor Green
    Write-Host "    - Status: $($health.status)" -ForegroundColor Gray
    Write-Host "    - Index: $($health.services.azureSearch.index)" -ForegroundColor Gray
    Write-Host "    - Redis: $($health.services.redis.available)" -ForegroundColor Gray
} catch {
    Write-Host "  [FAIL] Server NOT running on port 3000" -ForegroundColor Red
    Write-Host "    Run: npm run dev" -ForegroundColor Yellow
    $allGood = $false
}
Write-Host ""

# 4. Check OpenAI configuration
Write-Host "4. Azure OpenAI Configuration" -ForegroundColor Yellow
$deployment = (Get-Content .env.local | Select-String "^AZURE_OPENAI_DEPLOYMENT_NAME=").ToString().Split("=", 2)[1]
$embeddingDeployment = (Get-Content .env.local | Select-String "^AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT=").ToString().Split("=", 2)[1]

Write-Host "  Chat Model: $deployment" -ForegroundColor White
Write-Host "  Embedding Model: $embeddingDeployment" -ForegroundColor White

if ($embeddingDeployment -eq "text-embedding-3-large") {
    Write-Host "  [OK] Using text-embedding-3-large (3072 dims)" -ForegroundColor Green
} else {
    Write-Host "  [WARNING] Expected text-embedding-3-large, got: $embeddingDeployment" -ForegroundColor Yellow
}
Write-Host ""

# Summary
Write-Host "========================================" -ForegroundColor Cyan
if ($allGood) {
    Write-Host "[OK] ALL CHECKS PASSED!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Ready to test! Run:" -ForegroundColor Cyan
    Write-Host "  .\test-qa-endpoint.ps1" -ForegroundColor White
} else {
    Write-Host "[WARNING] ISSUES FOUND" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Next Steps:" -ForegroundColor Cyan
    
    if ($stats.documentCount -eq 0) {
        Write-Host "1. Run document ingestion:" -ForegroundColor White
        Write-Host "   python ingest_real_documents_sdk.py" -ForegroundColor Gray
        Write-Host ""
    }
    
    Write-Host "2. Start dev server (if not running):" -ForegroundColor White
    Write-Host "   npm run dev" -ForegroundColor Gray
    Write-Host ""
    
    Write-Host "3. Verify configuration:" -ForegroundColor White
    Write-Host "   curl http://localhost:3000/api/debug/config-check" -ForegroundColor Gray
}
Write-Host "========================================" -ForegroundColor Cyan
