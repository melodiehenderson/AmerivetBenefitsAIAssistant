#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Export Azure Search credentials to environment and restart server
.DESCRIPTION
    Sets AZURE_SEARCH_API_KEY from .env.local and restarts dev server
#>

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Azure Search Environment Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Read from .env.local
$adminKey = (Get-Content .env.local | Select-String "^AZURE_SEARCH_ADMIN_KEY=").ToString().Split("=", 2)[1].Trim()
$endpoint = (Get-Content .env.local | Select-String "^AZURE_SEARCH_ENDPOINT=").ToString().Split("=", 2)[1].Trim()
$indexName = (Get-Content .env.local | Select-String "^AZURE_SEARCH_INDEX_NAME=").ToString().Split("=", 2)[1].Trim()

if (-not $adminKey) {
    Write-Host "[FAIL] AZURE_SEARCH_ADMIN_KEY not found in .env.local" -ForegroundColor Red
    exit 1
}

Write-Host "Found credentials in .env.local:" -ForegroundColor Yellow
Write-Host "  Endpoint: $endpoint" -ForegroundColor Gray
Write-Host "  Admin Key: $($adminKey.Substring(0, 20))..." -ForegroundColor Gray
Write-Host "  Index: $indexName" -ForegroundColor Gray
Write-Host ""

# Set environment variables for current session
Write-Host "Setting environment variables for current session..." -ForegroundColor Yellow
$env:AZURE_SEARCH_ENDPOINT = $endpoint
$env:AZURE_SEARCH_API_KEY = $adminKey
$env:AZURE_SEARCH_ADMIN_KEY = $adminKey
$env:AZURE_SEARCH_INDEX_NAME = $indexName

Write-Host "  [OK] AZURE_SEARCH_ENDPOINT" -ForegroundColor Green
Write-Host "  [OK] AZURE_SEARCH_API_KEY" -ForegroundColor Green
Write-Host "  [OK] AZURE_SEARCH_ADMIN_KEY" -ForegroundColor Green
Write-Host "  [OK] AZURE_SEARCH_INDEX_NAME" -ForegroundColor Green
Write-Host ""

# Kill any existing Node processes
Write-Host "Stopping any running Node.js processes..." -ForegroundColor Yellow
Get-Process node -ErrorAction SilentlyContinue | ForEach-Object { 
    Stop-Process -Id $_.Id -Force 
}
Start-Sleep -Seconds 2
Write-Host "  [OK] All Node processes terminated" -ForegroundColor Green
Write-Host ""

# Instructions for starting server
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Environment Ready!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Now start the dev server:" -ForegroundColor Yellow
Write-Host "  npm run dev" -ForegroundColor White
Write-Host ""
Write-Host "Then test:" -ForegroundColor Yellow
Write-Host "  .\check-production-readiness.ps1" -ForegroundColor White
Write-Host "  .\test-qa-endpoint.ps1" -ForegroundColor White
Write-Host ""
Write-Host "NOTE: These environment variables are only set for this PowerShell session." -ForegroundColor DarkGray
Write-Host "      Make sure to run 'npm run dev' in THIS terminal window." -ForegroundColor DarkGray
Write-Host ""
