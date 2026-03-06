# CI/CD Gates and Operational Checks

This project includes scripts and a GitHub Actions workflow to prevent regressions like zero-result search or logging API drift.

## Pre-deploy Azure Search Probe

Script: `scripts/predeploy-acs-probe.ps1`

- Validates that the configured Azure Cognitive Search index contains at least N documents for the given `company_id`.
- Usage:
  - PowerShell:
    ```powershell
    ./scripts/predeploy-acs-probe.ps1 -Endpoint $env:AZURE_SEARCH_ENDPOINT -ApiKey $env:AZURE_SEARCH_API_KEY -Index $env:AZURE_SEARCH_INDEX -CompanyId amerivet -MinDocs 10
    ```

## Health + Smoke

- Health endpoint: `GET /api/health` returns:
  - Active index, Redis availability, commit SHA, timestamp
- Smoke script: `scripts/smoke-test-prod.ps1`
  - Calls `/api/health` then runs 4–5 QA queries
  - Asserts retrieval ≥ 8 and grounding ≥ 0.60

## Acceptance Gate

Script: `scripts/acceptance-gate.ps1`

- Wraps the smoke test and fails the pipeline if all tests do not pass.
- Usage:
  ```powershell
  ./scripts/acceptance-gate.ps1 -Domain https://<your-prod-domain> -CompanyId amerivet
  ```

## GitHub Actions Workflow

File: `.github/workflows/ci.yml`

- build: runs `npm ci`, typecheck, and lint
- predeploy-probe: runs the Azure Search probe using repository `secrets` and `vars`
  - Required repo settings:
    - Secrets: `AZURE_SEARCH_ENDPOINT`, `AZURE_SEARCH_API_KEY`
    - Variables: `AZURE_SEARCH_INDEX`, `COMPANY_ID`
- smoke: optional manual job to run the production smoke test
  - Variables: `PROD_DOMAIN`, `COMPANY_ID`

## Notes

- The probe and smoke tests are designed to fail-fast safely—no secrets are logged, and all network calls have timeouts.
- You can extend these gates to include additional tenants by invoking the scripts per tenant.