#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Adds semantic configuration to Azure AI Search index for better retrieval
.DESCRIPTION
    Updates chunks_prod_v1 index with semantic search configuration
    This enables hybrid retrieval: vector + keyword + semantic
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
    "api-key" = $adminKey
    "Content-Type" = "application/json"
}

# Get current index definition
Write-Host "Fetching current index schema..." -ForegroundColor Yellow
$indexUrl = "https://$SearchService.search.windows.net/indexes/$IndexName`?api-version=2023-11-01"
$currentIndex = Invoke-RestMethod -Uri $indexUrl -Headers $headers -Method Get

Write-Host "Current index: $($currentIndex.name)" -ForegroundColor Green
Write-Host "  Fields: $($currentIndex.fields.Count)" -ForegroundColor White
if ($currentIndex.vectorSearch -and $currentIndex.vectorSearch.profiles) {
    Write-Host "  Vector profiles: $($currentIndex.vectorSearch.profiles.Count)" -ForegroundColor White
} else {
    Write-Host "  Vector profiles: Not configured" -ForegroundColor Yellow
}

# Check available fields for semantic config
Write-Host "`nChecking available fields..." -ForegroundColor Yellow
Write-Host "Available fields in index:" -ForegroundColor Cyan
$currentIndex.fields | ForEach-Object {
    Write-Host "  - $($_.name) (type: $($_.type), searchable: $($_.searchable))" -ForegroundColor Gray
}

$hasMetadata = $currentIndex.fields | Where-Object { $_.name -eq "metadata" -and $_.searchable }
$hasSectionPath = $currentIndex.fields | Where-Object { $_.name -eq "section_path" -and $_.searchable }
$hasDocumentId = $currentIndex.fields | Where-Object { $_.name -eq "document_id" -and $_.searchable }

if ($hasMetadata) {
    Write-Host "  Using 'metadata' for keywords field" -ForegroundColor Green
    $keywordsField = "metadata"
} elseif ($hasSectionPath) {
    Write-Host "  Using 'section_path' for keywords field (metadata not found)" -ForegroundColor Yellow
    $keywordsField = "section_path"
} elseif ($hasDocumentId) {
    Write-Host "  Using 'document_id' for keywords field" -ForegroundColor Yellow
    $keywordsField = "document_id"
} else {
    Write-Host "  Warning: No suitable keywords field found, skipping keywordsFields" -ForegroundColor Yellow
    $keywordsField = $null
}

Write-Host "`nAdding semantic configuration..." -ForegroundColor Yellow

$prioritizedFields = @{
    prioritizedContentFields = @(
        @{ fieldName = "content" }
    )
}

if ($keywordsField) {
    $prioritizedFields.prioritizedKeywordsFields = @(
        @{ fieldName = $keywordsField }
    )
}

$semanticConfig = @{
    name = "default-semantic-config"
    prioritizedFields = $prioritizedFields
}

$currentIndex.semantic = @{
    defaultConfiguration = "default-semantic-config"
    configurations = @($semanticConfig)
}

# Update the index
Write-Host "Updating index with semantic configuration..." -ForegroundColor Yellow
try {
    $updateResponse = Invoke-RestMethod -Uri $indexUrl -Headers $headers -Method Put -Body ($currentIndex | ConvertTo-Json -Depth 10) -ContentType "application/json"
    Write-Host "SUCCESS: Semantic configuration added!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Semantic Config Details:" -ForegroundColor Cyan
    Write-Host "  Default: $($updateResponse.semantic.defaultConfiguration)" -ForegroundColor White
    $prioritizedFields = $updateResponse.semantic.configurations[0].prioritizedFields
    if ($prioritizedFields.contentField) {
        Write-Host "  Content Field: $($prioritizedFields.contentField.fieldName)" -ForegroundColor White
    }
    if ($prioritizedFields.titleField) {
        Write-Host "  Title Field: $($prioritizedFields.titleField.fieldName)" -ForegroundColor White
    }
    if ($prioritizedFields.keywordFields) {
        Write-Host "  Keywords Fields: $($prioritizedFields.keywordFields | ForEach-Object { $_.fieldName } | Join-String -Separator ', ')" -ForegroundColor White
    }
    
} catch {
    Write-Host "ERROR: Failed to update index" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "Details: $($_.ErrorDetails.Message)" -ForegroundColor Red
    }
    Write-Host "`nDebug: Semantic config being sent:" -ForegroundColor Yellow
    Write-Host ($currentIndex.semantic | ConvertTo-Json -Depth 5) -ForegroundColor Gray
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Semantic Configuration Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Test search with semantic ranking" -ForegroundColor White
Write-Host "2. Restart your dev server (npm run dev)" -ForegroundColor White
Write-Host "3. Test QA endpoint with challenge questions" -ForegroundColor White
Write-Host ""
