#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Debug QA endpoint with detailed logging
.DESCRIPTION
    Tests a single question and shows full request/response details
#>

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "QA Endpoint Debug Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$question = "What dental benefits are available?"
Write-Host "Question: $question" -ForegroundColor Yellow
Write-Host ""

$body = @{
    query = $question
    companyId = "amerivet"
} | ConvertTo-Json

Write-Host "Request Body:" -ForegroundColor Cyan
Write-Host $body -ForegroundColor Gray
Write-Host ""

try {
    Write-Host "Sending request to http://localhost:3000/api/qa..." -ForegroundColor Yellow
    
    $response = Invoke-WebRequest -Uri "http://localhost:3000/api/qa" `
        -Method Post `
        -Body $body `
        -ContentType "application/json" `
        -TimeoutSec 30
    
    Write-Host "Status Code: $($response.StatusCode)" -ForegroundColor Green
    Write-Host ""
    
    $jsonResponse = $response.Content | ConvertFrom-Json
    
    Write-Host "Response Content:" -ForegroundColor Cyan
    if ($jsonResponse.content) {
        Write-Host $jsonResponse.content -ForegroundColor White
    } else {
        Write-Host "(Empty - fallback triggered)" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "Full Response Object:" -ForegroundColor Cyan
    Write-Host ($jsonResponse | ConvertTo-Json -Depth 5) -ForegroundColor Gray
    
} catch {
    Write-Host "ERROR:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host ""
        Write-Host "Error Response Body:" -ForegroundColor Yellow
        Write-Host $responseBody -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Check server terminal for detailed logs" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
