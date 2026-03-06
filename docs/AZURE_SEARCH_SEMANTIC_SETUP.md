# Azure Search Semantic Configuration Setup Guide

## Problem
The QA endpoint was returning fallback messages because:
1. Environment variables contained CRLF (`\r\n`) characters
2. Azure Search index `chunks_prod_v1` was missing semantic configuration
3. The SDK call `semanticConfiguration: "default"` failed without a defined semantic config

## Solution

### 1. Clean Environment Variables ✅

**Already Fixed**: Added `.trim()` to all Azure config values in `lib/azure/config.ts`

Verify in production:
```powershell
# Check .vercel/.env.production.local
Get-Content .vercel\.env.production.local | Select-String "AZURE_SEARCH_INDEX"
```

Ensure the value is exactly:
```
AZURE_SEARCH_INDEX=chunks_prod_v1
```
No spaces, no `\r\n`, no quotes.

### 2. Update Azure Search Index with Semantic Configuration

#### Option A: Using PowerShell Script (Recommended)

```powershell
# Set environment variables
$env:AZURE_SEARCH_SERVICE_NAME = "amerivetasschatbotsearch"  # Your search service name
$env:AZURE_SEARCH_API_KEY = "your-admin-key-here"

# Run the update script
cd infra\azure
.\update-search-index.ps1
```

#### Option B: Using Azure CLI

```bash
# Login to Azure
az login

# Update the index (requires Azure CLI with search extension)
az search index update \
  --service-name amerivetasschatbotsearch \
  --name chunks_prod_v1 \
  --schema @search-index-schema.json
```

#### Option C: Using Azure Portal

1. Navigate to **Azure Portal** → **Azure AI Search** → Your search service
2. Click **Indexes** → **chunks_prod_v1**
3. Click **JSON View** (top right)
4. Add the following `semantic` section to the index JSON:

```json
{
  "semantic": {
    "defaultConfiguration": "default",
    "configurations": [
      {
        "name": "default",
        "prioritizedFields": {
          "titleField": {
            "fieldName": "source"
          },
          "prioritizedContentFields": [
            {
              "fieldName": "content"
            }
          ],
          "prioritizedKeywordsFields": [
            {
              "fieldName": "metadata"
            }
          ]
        }
      }
    ]
  }
}
```

5. Save the changes

### 3. Re-Index Documents

After updating the index schema, you must re-run ingestion to populate documents:

```powershell
# Using Python ingestion script
cd c:\Users\sonal\benefitsaichatbot-383
python ingest_real_documents_sdk.py
```

Or use the existing ingest scripts:
- `ingest_sample.py` - For sample data
- `ingest_real_documents.py` - For production documents
- `ingest_real_documents_sdk.py` - SDK-based ingestion

### 4. Verify Configuration

#### Check Config Endpoint
```powershell
# Local dev server
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/debug/config-check" | ConvertTo-Json -Depth 5

# Production
curl https://benefitsaichatbot-2jcvb7ll0-melodie-s-projects.vercel.app/api/debug/config-check
```

Look for:
- `searchIndexName`: Should be exactly `"chunks_prod_v1"` (length 15)
- `embeddingDeployment`: Should be `"text-embedding-3-large"` (length 22)

#### Test QA Endpoint
```powershell
.\test-qa-local.ps1
```

Expected result:
- Response with actual benefits answer (not fallback message)
- Metadata showing sources from Azure Search
- Grounding score > 0.7
- Tier routing (L1/L2/L3)

### 5. Update Vercel Production Environment

Ensure production env vars are clean:

```powershell
# Via Vercel CLI
vercel env rm AZURE_SEARCH_INDEX production
vercel env add AZURE_SEARCH_INDEX production
# Enter: chunks_prod_v1 (no extra characters)

# Redeploy
vercel --prod
```

Or update via **Vercel Dashboard**:
1. Go to project settings → Environment Variables
2. Find `AZURE_SEARCH_INDEX` or `AZURE_SEARCH_INDEX_NAME`
3. Delete and recreate with clean value: `chunks_prod_v1`
4. Redeploy

## Semantic Configuration Explained

The semantic configuration enables Azure AI Search to:

1. **Extract Captions**: Automatically generate relevant text snippets from search results
2. **Re-rank Results**: Use AI to improve relevance beyond keyword matching
3. **Semantic Similarity**: Better understand query intent and context

### Key Fields:
- **titleField** (`source`): Document source/filename for context
- **prioritizedContentFields** (`content`): Main searchable text chunks
- **prioritizedKeywordsFields** (`metadata`): Additional metadata for context

### Default Configuration:
The `defaultConfiguration: "default"` setting means:
- SDK calls using `semanticConfiguration: "default"` will work automatically
- No need to specify configuration name in every search query
- Fallback to keyword search if semantic fails

## Troubleshooting

### Issue: "Semantic configuration 'default' not found"
**Solution**: Run the update script again, verify via Azure Portal that semantic config exists

### Issue: Still getting fallback messages
**Checklist**:
1. ✅ Index updated with semantic config
2. ✅ Documents re-indexed (run ingestion script)
3. ✅ Env vars cleaned (no CRLF)
4. ✅ Server restarted to pick up new env vars
5. ✅ Check logs for Azure Search errors

### Issue: Empty search results
**Solution**: 
```powershell
# Verify documents exist in index
az search index show \
  --service-name amerivetasschatbotsearch \
  --name chunks_prod_v1 \
  --query "statistics"
```

Should show document count > 0

### Issue: 404 on embedding deployment
**Solution**: Already fixed with `.trim()`, verify:
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/debug/config-check"
# Check embeddingDeploymentHex - should not end with 0D0A (CRLF hex)
```

## Files Created/Modified

- ✅ `infra/azure/search-index-schema.json` - Complete index definition with semantic config
- ✅ `infra/azure/update-search-index.ps1` - PowerShell script to apply schema
- ✅ `lib/azure/config.ts` - Added `.trim()` to all Azure config values
- ✅ `app/api/debug/config-check/route.ts` - Diagnostic endpoint
- ✅ `test-qa-local.ps1` - Local QA testing script
- ✅ `.env.local` - Updated with clean search index name
- ✅ This guide - `AZURE_SEARCH_SEMANTIC_SETUP.md`

## Next Steps

1. **Run the update script** to add semantic configuration
2. **Re-index documents** using ingestion script
3. **Test locally** with `.\test-qa-local.ps1`
4. **Update Vercel env vars** with clean values
5. **Deploy to production** with `vercel --prod`
6. **Test production** QA endpoint

## References

- [Azure AI Search Semantic Search](https://learn.microsoft.com/en-us/azure/search/semantic-search-overview)
- [Semantic Configuration](https://learn.microsoft.com/en-us/azure/search/semantic-how-to-query-request)
- [Vector Search + Semantic Ranking](https://learn.microsoft.com/en-us/azure/search/vector-search-ranking)
