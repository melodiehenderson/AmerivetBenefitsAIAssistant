#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Adds semantic configuration to Azure AI Search index (Safe version)
.DESCRIPTION
    Uses Azure REST API with correct schema for 2023-11-01
    Only updates the semantic section without overwriting the entire index
#>

param(
    [string]$IndexName = "chunks_prod_v1",
    [string]$ResourceGroup = "benefits-chatbot-project",
    [string]$SearchService = "amerivetsearch"
)

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Azure AI Search Semantic Configuration" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Get search admin key
Write-Host "Fetching search admin key..." -ForegroundColor Yellow
$adminKey = az search admin-key show --service-name $SearchService --resource-group $ResourceGroup --query "primaryKey" -o tsv

if (-not $adminKey) {
    Write-Host "ERROR: Could not retrieve search admin key" -ForegroundColor Red
    exit 1
}

$headers = @{
    "api-key" = $adminKey.Trim()
    "Content-Type" = "application/json"
}

# Get current index definition
Write-Host "Fetching current index schema..." -ForegroundColor Yellow
$indexUrl = "https://$SearchService.search.windows.net/indexes/$IndexName`?api-version=2023-11-01"
$currentIndex = Invoke-RestMethod -Uri $indexUrl -Headers $headers -Method Get

Write-Host "Current index: $($currentIndex.name)" -ForegroundColor Green
Write-Host "  Fields: $($currentIndex.fields.Count)" -ForegroundColor White

# Display field details
Write-Host "`nAvailable searchable fields:" -ForegroundColor Yellow
$searchableFields = $currentIndex.fields | Where-Object { $_.searchable -eq $true }
$searchableFields | ForEach-Object {
    Write-Host "  - $($_.name) (type: $($_.type))" -ForegroundColor Gray
}

# Check if semantic config already exists
if ($currentIndex.semantic) {
    Write-Host "`nWARNING: Semantic configuration already exists!" -ForegroundColor Yellow
    Write-Host "Existing config: $($currentIndex.semantic.defaultConfiguration)" -ForegroundColor Gray
    $response = Read-Host "Overwrite existing configuration? (y/N)"
    if ($response -ne "y") {
        Write-Host "Aborted by user" -ForegroundColor Yellow
        exit 0
    }
}

# Build semantic configuration with correct schema
Write-Host "`nBuilding semantic configuration..." -ForegroundColor Yellow

# IMPORTANT: Use "default" as the name - the RAG pipeline expects this!
# See lib/rag/hybrid-retrieval.ts line 165: semanticConfiguration: "default"
# REST API 2023-11-01 uses: prioritizedContentFields (not contentFields)
$semanticConfiguration = @{
    name = "default"
    prioritizedFields = @{
        prioritizedContentFields = @(
            @{ fieldName = "content" }
        )
    }
}

Write-Host "  Content field: content" -ForegroundColor Green

# Add the semantic section
$currentIndex.semantic = @{
    configurations = @($semanticConfiguration)
}

# Show what we're sending
Write-Host "`nSemantic configuration to be applied:" -ForegroundColor Cyan
Write-Host ($currentIndex.semantic | ConvertTo-Json -Depth 5) -ForegroundColor Gray

# Confirm before applying
Write-Host ""
$confirm = Read-Host "Apply this configuration? (y/N)"
if ($confirm -ne "y") {
    Write-Host "Aborted by user" -ForegroundColor Yellow
    exit 0
}

# Update the index
Write-Host "`nUpdating index with semantic configuration..." -ForegroundColor Yellow
try {
    $body = $currentIndex | ConvertTo-Json -Depth 10 -Compress
    $updateResponse = Invoke-RestMethod -Uri $indexUrl -Headers $headers -Method Put -Body $body -ContentType "application/json"
    
    Write-Host "SUCCESS: Semantic configuration added!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Semantic Config Details:" -ForegroundColor Cyan
    if ($updateResponse.semantic -and $updateResponse.semantic.configurations) {
        $config = $updateResponse.semantic.configurations[0]
        Write-Host "  Configuration name: $($config.name)" -ForegroundColor White
        Write-Host "  Content fields: $($config.prioritizedFields.contentFields.fieldName -join ', ')" -ForegroundColor White
        if ($config.prioritizedFields.titleField) {
            Write-Host "  Title field: $($config.prioritizedFields.titleField.fieldName)" -ForegroundColor White
        }
    }
    
} catch {
    Write-Host "ERROR: Failed to update index" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "`nAPI Error Details:" -ForegroundColor Red
        $errorObj = $_.ErrorDetails.Message | ConvertFrom-Json
        Write-Host ($errorObj | ConvertTo-Json -Depth 5) -ForegroundColor Gray
    }
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Configuration Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Verify semantic config:" -ForegroundColor White
Write-Host "   curl -H 'api-key: YOUR_KEY' https://amerivetsearch.search.windows.net/indexes/chunks_prod_v1?api-version=2023-11-01" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Test semantic search:" -ForegroundColor White
Write-Host "   The index is ready - no re-indexing needed!" -ForegroundColor Gray
Write-Host "   Semantic configuration works with existing data." -ForegroundColor Gray
Write-Host ""
Write-Host "3. Restart dev server and test QA endpoint:" -ForegroundColor White
Write-Host "   npm run dev" -ForegroundColor Gray
Write-Host ""
