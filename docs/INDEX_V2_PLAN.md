# chunks_prod_v2 Rebuild Plan (Off-Path)

Goal: Create a corrected v2 index off the main path, ingest a complete corpus (≥400 docs), validate, then canary.

## 1) Create index

Use `infra/azure/indexes/chunks_prod_v2.json` as a template. Apply via REST:

```powershell
$endpoint = $env:AZURE_SEARCH_ENDPOINT
$key = $env:AZURE_SEARCH_API_KEY
$body = Get-Content ./infra/azure/indexes/chunks_prod_v2.json -Raw
Invoke-RestMethod -Method Put -Uri "$endpoint/indexes/chunks_prod_v2?api-version=2023-11-01" -Headers @{ 'api-key'=$key; 'Content-Type'='application/json' } -Body $body
```

Notes:
- Vector dims: 3072 (requires embedding deployment that outputs 3072 dims, e.g., text-embedding-3-large)
- Keep `company_id` filterable for multi-tenant retrieval

## 2) Ingest content

Prepare chunk JSON lines with fields: `id`, `document_id`, `company_id`, `chunk_index`, `content`, `metadata`, `content_vector`.

Bulk upload via REST:

```powershell
$docs = @{ value = @(
  @{ '@search.action'='upload'; id='doc1:0'; document_id='doc1'; company_id='amerivet'; chunk_index=0; content='...'; metadata='{}'; content_vector=@(0.0, 0.1, ...) }
) } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Method Post -Uri "$endpoint/indexes/chunks_prod_v2/docs/index?api-version=2023-11-01" -Headers @{ 'api-key'=$key; 'Content-Type'='application/json' } -Body $docs
```

Tip: batch up to ~1000 actions per request.

## 3) Validate

- Count per tenant:
  ```powershell
  $body = @{ search='*'; count=$true; top=0; filter="company_id eq 'amerivet'" } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri "$endpoint/indexes/chunks_prod_v2/docs/search?api-version=2023-11-01" -Headers @{ 'api-key'=$key; 'Content-Type'='application/json' } -Body $body
  ```
- Spot-check vector search with a known query using `vectorQueries` (via SDK) or test BM25 + filters via REST.

## 4) Canary

- Temporarily set `AZURE_SEARCH_INDEX=chunks_prod_v2` on a preview environment.
- Run `scripts/smoke-test-prod.ps1` against that environment (update Domain).
- Ensure: retrieval ≥ 8, grounding ≥ 0.6, latency ≤ 6s for 4/4 queries.

## 5) Switch-over

- When validated, update production `AZURE_SEARCH_INDEX` to `chunks_prod_v2` and redeploy.
- Keep `chunks_prod_v1` for rollback for at least 48 hours.