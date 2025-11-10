#!/usr/bin/env pwsh
# Quick probe to check reranker picked-chunk count and grounding

Write-Host "`n=== QA Reranker Probe ===" -ForegroundColor Cyan

$body = @{
    query = "What are the wellness program benefits?"
    companyId = "amerivet"
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/qa" `
        -Method Post `
        -Body $body `
        -ContentType "application/json" `
        -TimeoutSec 45
    
    Write-Host "`n✓ Response received" -ForegroundColor Green
    Write-Host "`nKEY METRICS:" -ForegroundColor Yellow
    Write-Host "  Picked Chunks: $($response.metadata.rerankedCount)" -ForegroundColor $(if($response.metadata.rerankedCount -ge 4){'Green'}else{'Red'})
    Write-Host "  Grounding Score: $([math]::Round($response.metadata.groundingScore, 4))" -ForegroundColor $(if($response.metadata.groundingScore -ge 0.50){'Green'}elseif($response.metadata.groundingScore -ge 0.35){'Yellow'}else{'Red'})
    Write-Host "  Citations: $($response.citations.Count)" -ForegroundColor Cyan
    Write-Host "  Distinct Docs: $($response.metadata.distinctDocIds)" -ForegroundColor Cyan
    Write-Host "  Token Budget Used: $($response.metadata.rerankTokens)/3000" -ForegroundColor Gray
    Write-Host "  Tier: $($response.tier)" -ForegroundColor Gray
    Write-Host "  Response Time: $([math]::Round($response.metadata.latencyBreakdown.total / 1000, 2))s" -ForegroundColor Gray
    
    # Check if we need to increase retrieval breadth
    if ($response.metadata.rerankedCount -lt 4) {
        Write-Host "`n[WARNING] Picked chunks less than 4" -ForegroundColor Red
        Write-Host "   Action needed: Increase retrieval breadth (BM25=60, vector=96)" -ForegroundColor Yellow
    } elseif ($response.metadata.groundingScore -lt 0.50) {
        Write-Host "`n[WARNING] Grounding score below 50 percent" -ForegroundColor Yellow
        Write-Host "   Current: $([math]::Round($response.metadata.groundingScore * 100, 1))%" -ForegroundColor Yellow
    } else {
        Write-Host "`n[SUCCESS] Metrics meet targets!" -ForegroundColor Green
        Write-Host "   Picked: $($response.metadata.rerankedCount) (target: 4+)" -ForegroundColor Green
        Write-Host "   Grounding: $([math]::Round($response.metadata.groundingScore * 100, 1))% (target: 50%+)" -ForegroundColor Green
    }
    
} catch {
    Write-Host "`n✗ ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "   Is the dev server running?" -ForegroundColor Yellow
}

Write-Host "`n=========================`n" -ForegroundColor Cyan
