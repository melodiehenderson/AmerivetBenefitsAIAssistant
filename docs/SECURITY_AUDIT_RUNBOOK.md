# Monthly Security Audit Runbook

**Frequency:** Monthly (1st of each month)  
**Owner:** DevOps/Security Team  
**Duration:** ~30 minutes  
## Pre-Audit Checklist

- [ ] Ensure you have Azure CLI installed and authenticated
- [ ] Verify access to Azure Key Vault (if using)
- [ ] Have access to GitHub repository settings
- [ ] Local `gitleaks` installed: `brew install gitleaks` (macOS) or download from https://github.com/gitleaks/gitleaks/releases

---

## 1. Secret Scanning (10 min)

### a) Run Gitleaks on Full Repository

```bash
cd /path/to/benefitsaichatbot-383

# Full history scan
gitleaks detect --verbose --redact

# Filesystem scan (no git history)
gitleaks detect --no-git --verbose --redact

# Expected output: "No leaks found"
```

**If leaks found:**
1. Identify the file(s) containing secrets
2. Move secrets to environment variables
3. Add patterns to `.gitleaks.toml` allowlist if false positive
4. Re-run scan to verify clean

### b) Scan for Common Patterns

```bash
# Search for hardcoded secrets
rg -n --hidden --ignore-file .gitignore \
  -e "AccountKey=" \
  -e "SharedAccessSignature=" \
  -e "DefaultEndpointsProtocol=" \
  -e "rediss?://[^@]+:[^@]+@" \
  --glob "!*.md" --glob "!*.example"

# Expected output: No matches (or only in docs/examples)
```

---

## 2. Dependency Audit (5 min)

```bash
# Check for vulnerable dependencies
npm audit

# Fix automatically fixable vulnerabilities
npm audit fix

# Review high/critical vulnerabilities manually
npm audit --audit-level=high
```

**Action items:**
- Update dependencies with breaking changes in a separate PR
- Document any vulnerabilities that can't be auto-fixed

---

## 3. Azure Key Rotation (Quarterly: Jan, Apr, Jul, Oct) (10 min)

### Check Last Rotation Date

```bash
# View secret metadata in Key Vault (if using)
az keyvault secret show \
  --vault-name <your-keyvault> \
  --name cosmos-primary-key \
  --query "attributes.updated"
```

### Regenerate Keys (if >90 days old)

```bash
# 1) Cosmos DB
az cosmosdb keys regenerate \
  --resource-group <your-rg> \
  --name <your-cosmos> \
  --key-kind primary

# 2) Redis
az redis regenerate-keys \
  --resource-group <your-rg> \
  --name <your-redis> \
  --key-type Primary

# 3) Storage Account
az storage account keys renew \
  --resource-group <your-rg> \
  --account-name <your-storage> \
  --key key1
```

### Update Secrets

```bash
# Retrieve new keys
COSMOS_KEY=$(az cosmosdb keys list --resource-group <rg> --name <cosmos> --query primaryMasterKey -o tsv)
REDIS_KEY=$(az redis list-keys --resource-group <rg> --name <redis> --query primaryKey -o tsv)
STORAGE_CONN=$(az storage account show-connection-string --resource-group <rg> --name <storage> --query connectionString -o tsv)

# Update local secrets file
echo "AZURE_COSMOS_KEY=$COSMOS_KEY" >> ~/secrets/benefitsaichatbot-383/.env.production
echo "REDIS_URL=rediss://:<password>@<hostname>:6380" >> ~/secrets/benefitsaichatbot-383/.env.production
echo "AZURE_STORAGE_CONNECTION_STRING=$STORAGE_CONN" >> ~/secrets/benefitsaichatbot-383/.env.production

# Update GitHub Secrets
gh secret set AZURE_COSMOS_KEY --body "$COSMOS_KEY"
gh secret set REDIS_URL --body "$REDIS_URL"
gh secret set AZURE_STORAGE_CONNECTION_STRING --body "$STORAGE_CONN"
```

### Smoke Test

```bash
# Deploy to preview environment
vercel --env AZURE_COSMOS_KEY="$COSMOS_KEY"

# Test endpoints
curl https://your-preview-url.vercel.app/api/health
curl https://your-preview-url.vercel.app/api/ready

# Expected: Both return 200 OK
```

---

## 4. Pre-Push Hook Verification (2 min)

```bash
# Verify hook exists and is executable
ls -la .git/hooks/pre-push
cat .git/hooks/pre-push

# Test hook blocks secrets
echo "AccountKey=test123" > test-secret.txt
git add test-secret.txt
git commit -m "test"
git push origin main  # Should FAIL with "Secrets detected"

# Cleanup
git reset HEAD~1
rm test-secret.txt
```

---

## 5. GitHub Actions Health Check (3 min)

Visit: https://github.com/sonalmogra28/benefitsaiAssisstantchatbot/actions

**Verify:**
- [ ] Latest `CI Quality Gates` workflow passed
- [ ] Latest `Secret Scan` workflow passed
- [ ] No failed workflow runs in last 7 days
- [ ] All required checks are enabled in branch protection

---

## 6. Documentation Review (2 min)

- [ ] `.gitleaks.toml` allowlist is minimal (only legitimate exceptions)
- [ ] `docs/BRANCH_PROTECTION.md` matches current GitHub settings
- [ ] This runbook is up-to-date

---

## Audit Report Template

**Date:** YYYY-MM-DD  
**Auditor:** [Your Name]  

### Results

- **Gitleaks Scan:** ✅ PASS / ❌ FAIL (leaks found: X)
- **npm Audit:** ✅ PASS / ⚠️ WARNING (X vulnerabilities)
- **Key Rotation:** ✅ DONE / ⏭️ SKIPPED (not quarterly)
- **Pre-Push Hook:** ✅ WORKING / ❌ BROKEN
- **GitHub Actions:** ✅ HEALTHY / ⚠️ DEGRADED

### Action Items

1. [Item 1 if any issues found]
2. [Item 2]

### Next Audit Due

**Date:** [First day of next month]

---

## Emergency Contacts

- **Azure Support:** https://portal.azure.com/#blade/Microsoft_Azure_Support/HelpAndSupportBlade
- **GitHub Security:** security@github.com
- **Vercel Support:** https://vercel.com/help

---

## Automation

This runbook is partially automated via `.github/workflows/monthly-audit.yml`.  
GitHub Actions will:
- Run gitleaks monthly
- Create tracking issue for key rotation quarterly
- Send Slack/email notifications (configure in workflow)

**Manual steps still required:** Key rotation and smoke testing.
