#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Final setup verification and next steps for production deployment
.DESCRIPTION
    Confirms all configuration is correct and provides clear next steps
#>

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "PRODUCTION SETUP - FINAL VERIFICATION" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Verify environment variables
Write-Host "[STEP 1] Environment Variables" -ForegroundColor Yellow
Write-Host ""

$searchEndpoint = (Get-Content .env.local | Select-String "^AZURE_SEARCH_ENDPOINT=").ToString().Split("=", 2)[1].Trim()
$searchKey = (Get-Content .env.local | Select-String "^AZURE_SEARCH_ADMIN_KEY=").ToString().Split("=", 2)[1].Trim()
$indexName = (Get-Content .env.local | Select-String "^AZURE_SEARCH_INDEX_NAME=").ToString().Split("=", 2)[1].Trim()

Write-Host "  [OK] AZURE_SEARCH_ENDPOINT" -ForegroundColor Green
Write-Host "       $searchEndpoint" -ForegroundColor Gray
Write-Host "  [OK] AZURE_SEARCH_ADMIN_KEY" -ForegroundColor Green
Write-Host "       $($searchKey.Substring(0, 20))..." -ForegroundColor Gray
Write-Host "  [OK] AZURE_SEARCH_INDEX_NAME" -ForegroundColor Green
Write-Host "       $indexName" -ForegroundColor Gray

Write-Host ""

# Step 2: Verify index has documents
Write-Host "[STEP 2] Index Status" -ForegroundColor Yellow
Write-Host ""

$headers = @{ "api-key" = $searchKey }

try {
    $stats = Invoke-RestMethod -Uri "https://amerivetsearch.search.windows.net/indexes/$indexName/stats?api-version=2023-11-01" -Headers $headers
    
    Write-Host "  Index: $indexName" -ForegroundColor White
    Write-Host "  Document Count: $($stats.documentCount)" -ForegroundColor White
    
    if ($stats.documentCount -gt 0) {
        Write-Host "  [OK] Index has $($stats.documentCount) chunks" -ForegroundColor Green
        
        # Check unique documents
        $result = Invoke-RestMethod -Uri "https://amerivetsearch.search.windows.net/indexes/$indexName/docs/search?api-version=2023-11-01" `
            -Headers $headers -Method Post `
            -Body '{"search":"*","select":"document_id,company_id","top":500}' `
            -ContentType "application/json"
        
        $uniqueDocs = ($result.value.document_id | Select-Object -Unique).Count
        $uniqueCompanies = ($result.value.company_id | Select-Object -Unique)
        
        Write-Host "  Unique Documents: $uniqueDocs" -ForegroundColor Gray
        Write-Host "  Company IDs: $($uniqueCompanies -join ', ')" -ForegroundColor Gray
    } else {
        Write-Host "  [WARNING] Index is EMPTY!" -ForegroundColor Yellow
        Write-Host "  Action needed: Run document ingestion" -ForegroundColor Red
    }
} catch {
    Write-Host "  [FAIL] Could not query index: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Step 3: Check semantic configuration
Write-Host "[STEP 3] Semantic Search Configuration" -ForegroundColor Yellow
Write-Host ""

try {
    $index = Invoke-RestMethod -Uri "https://amerivetsearch.search.windows.net/indexes/$indexName?api-version=2023-11-01" -Headers $headers
    
    if ($index.semantic -and $index.semantic.configurations) {
        $semanticConfig = $index.semantic.configurations[0]
        Write-Host "  [OK] Semantic Config: $($semanticConfig.name)" -ForegroundColor Green
        
        if ($semanticConfig.prioritizedFields.prioritizedContentFields) {
            $fields = $semanticConfig.prioritizedFields.prioritizedContentFields.fieldName -join ', '
            Write-Host "  Content Fields: $fields" -ForegroundColor Gray
        }
    } else {
        Write-Host "  [FAIL] No semantic configuration found" -ForegroundColor Red
        Write-Host "  Action needed: Run add-semantic-config-v2.ps1" -ForegroundColor Red
    }
} catch {
    Write-Host "  [FAIL] Could not check semantic config: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Step 4: Check if server is running
Write-Host "[STEP 4] Development Server" -ForegroundColor Yellow
Write-Host ""

try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/api/health" -TimeoutSec 3
    Write-Host "  [OK] Server is running on port 3000" -ForegroundColor Green
    Write-Host "  Status: $($health.status)" -ForegroundColor Gray
    Write-Host "  Index: $($health.services.azureSearch.index)" -ForegroundColor Gray
} catch {
    Write-Host "  [FAIL] Server is NOT running" -ForegroundColor Red
    Write-Host "  Action needed: Run 'npm run dev' in a separate terminal" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "NEXT STEPS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($stats.documentCount -eq 0) {
    Write-Host "[FAIL] INDEX IS EMPTY - Must populate first:" -ForegroundColor Red
    Write-Host ""
    Write-Host "Run document ingestion:" -ForegroundColor Yellow
    Write-Host "  python ingest_real_documents_sdk.py" -ForegroundColor White
    Write-Host ""
    Write-Host "OR manually upload via Azure Portal" -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host "[OK] Configuration Complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "To test the QA system:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "1. Restart dev server (if needed):" -ForegroundColor Yellow
    Write-Host "   npm run dev" -ForegroundColor White
    Write-Host ""
    Write-Host "2. Run production readiness check:" -ForegroundColor Yellow
    Write-Host "   .\check-production-readiness.ps1" -ForegroundColor White
    Write-Host ""
    Write-Host "3. Test QA endpoint:" -ForegroundColor Yellow
    Write-Host "   .\test-qa-endpoint.ps1" -ForegroundColor White
    Write-Host ""
    Write-Host "4. If grounding scores are low, check:" -ForegroundColor Yellow
    Write-Host "   - Server logs for retrieval errors" -ForegroundColor Gray
    Write-Host "   - Company ID filtering (must be 'amerivet')" -ForegroundColor Gray
    Write-Host "   - Verify semantic search is being used" -ForegroundColor Gray
    Write-Host ""
    Write-Host "5. Deploy to production:" -ForegroundColor Yellow
    Write-Host "   vercel --prod" -ForegroundColor White
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
