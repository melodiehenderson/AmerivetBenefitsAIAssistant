#!/usr/bin/env pwsh
# Debug script to inspect raw retrieval results before reranking

Write-Host "`n=== Retrieval Diversity Check ===" -ForegroundColor Cyan
Write-Host "Checking if retrieval returns diverse doc_ids...`n" -ForegroundColor Gray

$body = @{
    query = "what dental benefits are available"
    companyId = "amerivet"
} | ConvertTo-Json

try {
    $result = Invoke-RestMethod -Uri "http://localhost:3000/api/qa/debug/retrieval" `
        -Method POST `
        -Body $body `
        -ContentType "application/json" `
        -TimeoutSec 30
    
    Write-Host "Query: $($result.query)" -ForegroundColor Yellow
    Write-Host "Total Chunks Retrieved: $($result.totalChunks)" -ForegroundColor Cyan
    Write-Host "Unique Document IDs: $($result.uniqueDocIds)" -ForegroundColor $(if($result.uniqueDocIds -ge 4){'Green'}elseif($result.uniqueDocIds -ge 2){'Yellow'}else{'Red'})
    
    if ($result.uniqueDocIds -le 2) {
        Write-Host "`n[CRITICAL] Retrieval diversity TOO LOW!" -ForegroundColor Red
        Write-Host "Problem: Retrieval returns only $($result.uniqueDocIds) unique document(s)" -ForegroundColor Red
        Write-Host "Root cause: Ingestion metadata issue or index has limited documents" -ForegroundColor Yellow
        Write-Host "`nSolution options:" -ForegroundColor Yellow
        Write-Host "  1. Check index: Are there multiple documents with different doc_ids?" -ForegroundColor Gray
        Write-Host "  2. Verify ingestion: Each source document needs distinct doc_id" -ForegroundColor Gray
        Write-Host "  3. If index has <10 documents, ingest more source files" -ForegroundColor Gray
    } elseif ($result.uniqueDocIds -lt 4) {
        Write-Host "`n[WARNING] Retrieval diversity could be better" -ForegroundColor Yellow
        Write-Host "Current: $($result.uniqueDocIds) unique docs (target: 4+)" -ForegroundColor Yellow
    } else {
        Write-Host "`n[OK] Retrieval diversity is acceptable" -ForegroundColor Green
        Write-Host "Retrieved $($result.uniqueDocIds) unique documents" -ForegroundColor Green
    }
    
    Write-Host "`nDocument IDs found:" -ForegroundColor Cyan
    $result.docIdList | ForEach-Object { Write-Host "  - $_" -ForegroundColor Gray }
    
    Write-Host "`nTop 10 chunks (by combined score):" -ForegroundColor Cyan
    $result.retrievedChunks | Select-Object -First 10 | ForEach-Object {
        Write-Host "  [$($_.index)] doc_id: $($_.doc_id.Substring(0, [Math]::Min(40, $_.doc_id.Length)))..." -ForegroundColor Gray
        Write-Host "      title: $($_.title)" -ForegroundColor DarkGray
        Write-Host "      combined: $($_.combinedScore) (vector=$($_.vectorScore), rrf=$($_.rrfScore), relevance=$($_.relevanceScore))" -ForegroundColor DarkGray
    }
    
} catch {
    Write-Host "`n[ERROR] Failed to call debug endpoint" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "`nIs the dev server running? Try: npm run dev" -ForegroundColor Yellow
}

Write-Host "`n=============================`n" -ForegroundColor Cyan
