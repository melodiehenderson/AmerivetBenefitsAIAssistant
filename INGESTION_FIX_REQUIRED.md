# Ingestion Fix Required: doc_id Collapse Issue

## Problem Diagnosis

The retrieval logs show **≤2 unique doc_ids**, meaning all chunks in the index share the same or very few parent document identifiers. This is an **ingestion metadata issue**, not a retrieval or reranker problem.

### Root Cause
The chunking/ingestion process assigned the same `doc_id` to all chunks instead of using stable identifiers for each source document.

---

## Fix: Correct Ingestion Pipeline

### 1. Fix Chunker to Assign Distinct doc_ids

**Location**: Find your chunking script (likely `ingest_real_documents.py` or `ingest_real_documents_sdk.py`)

**Required Change**:
```python
# WRONG (current behavior - all chunks get same doc_id)
doc_id = "amerivet-benefits-doc"  # Static value reused for all

# CORRECT (each source file gets unique doc_id)
import hashlib
from pathlib import Path

def generate_doc_id(file_path: str) -> str:
    """Generate stable doc_id from source file"""
    file_name = Path(file_path).stem  # Get filename without extension
    # Use hash of filename for stability
    return f"doc-{hashlib.md5(file_name.encode()).hexdigest()[:12]}"

# Example usage:
for file_path in source_documents:
    doc_id = generate_doc_id(file_path)  # Unique per source file
    chunks = chunk_document(file_path)
    
    for i, chunk in enumerate(chunks):
        chunk_doc = {
            "id": f"{doc_id}-chunk-{i}",      # Unique chunk ID
            "doc_id": doc_id,                  # Same for all chunks from this file
            "chunk_id": f"chunk-{i}",
            "content": chunk.content,
            "company_id": "amerivet",
            "title": file_name,
            # ... other fields
        }
```

### 2. Verify Index Schema

**Azure Search Index Requirements**:

```json
{
  "fields": [
    {
      "name": "id",
      "type": "Edm.String",
      "key": true,
      "searchable": false,
      "filterable": false,
      "sortable": false,
      "facetable": false
    },
    {
      "name": "doc_id",
      "type": "Edm.String",
      "key": false,
      "searchable": false,
      "filterable": true,
      "sortable": false,
      "facetable": true
    },
    {
      "name": "chunk_id",
      "type": "Edm.String",
      "searchable": false,
      "filterable": true
    },
    {
      "name": "content",
      "type": "Edm.String",
      "searchable": true
    }
  ]
}
```

**Check current schema**:
```powershell
# In PowerShell
$endpoint = $env:AZURE_SEARCH_ENDPOINT
$key = $env:AZURE_SEARCH_ADMIN_KEY
$index = "chunks_prod_v1"

Invoke-RestMethod -Uri "$endpoint/indexes/$index?api-version=2024-07-01" `
    -Headers @{"api-key"=$key} | ConvertTo-Json -Depth 10
```

### 3. Rebuild Index Process

**CRITICAL**: Partial updates won't fix metadata. Must rebuild entirely.

```powershell
# Step 1: Delete old index (BACKUP FIRST if needed)
# DELETE /indexes/{indexName}

# Step 2: Create new index with correct schema
# POST /indexes with proper field definitions

# Step 3: Run corrected ingestion script
python ingest_real_documents_sdk.py

# Step 4: Verify doc_id diversity
# Check retrieval logs show ≥8 unique doc_ids
```

### 4. Ingestion Script Checklist

Before re-running ingestion:

- [ ] Each source file generates a **unique, stable** `doc_id`
- [ ] All chunks from the same file share the **same** `doc_id`
- [ ] Chunks from different files have **different** `doc_ids`
- [ ] `doc_id` field is **filterable** and **facetable** in schema
- [ ] Test with 3-5 sample files first before full ingestion

### 5. Post-Fix Verification

After rebuilding the index, run:

```powershell
# Test retrieval diversity
.\test-retrieval-diversity.ps1
```

**Expected output**:
```
Unique Document IDs: 8-15 (or more)
[OK] Retrieval diversity is acceptable
```

**If still shows ≤2 unique docs**:
- Check ingestion script actually assigns different doc_ids
- Verify field mapping in index definition
- Confirm chunks were uploaded with new metadata

---

## DO NOT Proceed Until Fixed

**⚠️ STOP all reranker/retrieval tuning until doc_id diversity is confirmed ≥8**

The reranker cannot create diversity that doesn't exist upstream. If retrieval returns chunks all from 1-2 documents, no amount of reranker tuning will improve grounding scores.

---

## Current Status

- ❌ Retrieval returns ≤2 unique doc_ids (confirmed in logs)
- ❌ Reranker tuning blocked (cannot fix upstream issue)
- ⏸️  Server/code changes paused
- ✅ Next action: Fix ingestion, rebuild index

---

## Quick Diagnostic Commands

```powershell
# Check if server is logging RETRIEVAL_DOC_IDS
# Make a test query and look for this log line:
# RETRIEVAL_DOC_IDS <count> [ 'doc-abc...', 'doc-abc...', 'doc-abc...', ... ]

# If all doc_ids are identical → ingestion fix required
# If ≥8 different doc_ids → resume reranker tuning
```
