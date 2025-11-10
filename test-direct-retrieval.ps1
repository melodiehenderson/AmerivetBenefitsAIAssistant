#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Test direct retrieval to diagnose why QA returns empty responses
#>

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Testing Direct Azure Search Retrieval" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$queries = @(
    "dental benefits",
    "health insurance coverage",
    "retirement plan"
)

foreach ($query in $queries) {
    Write-Host "Query: $query" -ForegroundColor Yellow
    
    try {
        $body = @{
            query = $query
            companyId = "amerivet"
            conversationId = "test-conv-$(Get-Random)"
            userId = "test-user"
        } | ConvertTo-Json
        
        Write-Host "Calling /api/qa with timeout of 60 seconds..." -ForegroundColor Gray
        $response = Invoke-RestMethod -Uri "http://localhost:3000/api/qa" `
            -Method POST `
            -Body $body `
            -ContentType "application/json" `
            -TimeoutSec 60
        
        Write-Host "Response:" -ForegroundColor Green
        Write-Host "  Answer: $($response.answer.substring(0, [Math]::Min(100, $response.answer.Length)))..." -ForegroundColor White
        Write-Host "  Tier: $($response.metadata.tier)" -ForegroundColor White
        Write-Host "  Chunks: $($response.metadata.chunksRetrieved)" -ForegroundColor White
        Write-Host "  Grounding: $($response.metadata.groundingScore)" -ForegroundColor White
        Write-Host "  Citations: $($response.citations.Count)" -ForegroundColor White
        
        if ($response.metadata.retrievalError) {
            Write-Host "  ⚠️  Retrieval Error: $($response.metadata.retrievalError)" -ForegroundColor Red
        }
        
    } catch {
        Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.ErrorDetails.Message) {
            Write-Host "Details: $($_.ErrorDetails.Message)" -ForegroundColor Gray
        }
    }
    
    Write-Host ""
    Write-Host "---" -ForegroundColor Gray
    Write-Host ""
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
