#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Test the QA endpoint with semantic search enabled
.DESCRIPTION
    Sends a test question to verify document retrieval is working
#>

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Testing QA Endpoint with Semantic Search" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Test questions
$testQuestions = @(
    "What dental benefits are available?",
    "Tell me about the health insurance coverage",
    "What is the retirement plan?"
)

foreach ($question in $testQuestions) {
    Write-Host "Question: $question" -ForegroundColor Yellow
    
    try {
        $body = @{
            query = $question
            companyId = "amerivet"  # Use actual company ID from indexed documents
        } | ConvertTo-Json -Depth 5
        
        $response = Invoke-RestMethod -Uri "http://localhost:3000/api/qa" `
            -Method Post `
            -Body $body `
            -ContentType "application/json" `
            -TimeoutSec 30
        
        Write-Host "Response:" -ForegroundColor Green
        if ($response.answer) {
            # Truncate long answers for readability
            $answer = $response.answer
            if ($answer.Length > 300) {
                $answer = $answer.Substring(0, 300) + "..."
            }
            Write-Host $answer -ForegroundColor White
        } elseif ($response.content) {
            Write-Host $response.content -ForegroundColor White
        } else {
            Write-Host "(Empty response - check if documents are indexed)" -ForegroundColor Yellow
        }
        
        # Display metadata and metrics
        Write-Host "`nMetadata:" -ForegroundColor Cyan
        Write-Host "  Tier: $($response.tier)" -ForegroundColor Gray
        Write-Host "  Chunks Retrieved: $($response.metadata.retrievalCount)" -ForegroundColor Gray
        Write-Host "  Grounding Score: $([math]::Round($response.metadata.groundingScore, 4))" -ForegroundColor $(if($response.metadata.groundingScore -gt 0.5){'Green'}elseif($response.metadata.groundingScore -gt 0.3){'Yellow'}else{'Red'})
        
        if ($response.citations -and $response.citations.Count -gt 0) {
            Write-Host "  âœ" Citations: $($response.citations.Count)" -ForegroundColor Green
            foreach ($citation in $response.citations | Select-Object -First 3) {
                Write-Host "    - $($citation.title)" -ForegroundColor DarkGray
            }
        } else {
            Write-Host "  â Ï¸ No citations (fallback response)" -ForegroundColor Yellow
        }
        
        if ($response.usage -and $response.usage.latencyMs) {
            Write-Host "  Response Time: $([math]::Round($response.usage.latencyMs / 1000, 2))s" -ForegroundColor Gray
        } elseif ($response.metadata.latencyBreakdown) {
            Write-Host "  Total Time: $([math]::Round($response.metadata.latencyBreakdown.total / 1000, 2))s" -ForegroundColor Gray
            Write-Host "    - Retrieval: $([math]::Round($response.metadata.latencyBreakdown.retrieval / 1000, 2))s" -ForegroundColor DarkGray
            Write-Host "    - Generation: $([math]::Round($response.metadata.latencyBreakdown.generation / 1000, 2))s" -ForegroundColor DarkGray
        }
        
        Write-Host "`n---" -ForegroundColor DarkGray
        Write-Host ""
        
    } catch {
        Write-Host "ERROR: Failed to call QA endpoint" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        Write-Host ""
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
