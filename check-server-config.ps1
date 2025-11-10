#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Check what configuration the server is seeing
#>

Write-Host "Checking server configuration..." -ForegroundColor Cyan
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/api/debug/config-check" -TimeoutSec 10
    
    Write-Host "Server Configuration:" -ForegroundColor Yellow
    Write-Host ($response | ConvertTo-Json -Depth 5) -ForegroundColor White
    
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "Details: $($_.ErrorDetails.Message)" -ForegroundColor Gray
    }
}
