# Azure Infrastructure Tier Rationale

Why each resource was provisioned at its current tier, the risk of changing it, and when to revisit.

---

## Azure AI Search — S1 Standard with 2 replicas (~$250/mo)

**Why the developer chose it:** S1 is the first tier that supports vector search (HNSW) with production SLAs. When this was originally set up, that was a real constraint — the Free and Basic tiers didn't support vector search at all. Two replicas gives you 99.9% uptime SLA and read scalability.

**Was it overkill?** Yes, right now. Basic tier added vector search support in 2024. With one tester, there's no need for replicas or S1's 25GB-per-partition storage. The entire AmeriVet document corpus is probably under 50MB.

**Risk of downgrading to Basic (~$75/mo):** Low, with one caveat — Basic has no replica support (single node, no HA SLA). Fine for dev and early production, but before BCG goes live with real employees, revisit. Migration back to Standard is the same process (new service, re-index) — budget a few hours.

**The user-count math:** S1 with 2 replicas is built for thousands of concurrent queries per second. You'd need 500–1,000 daily active users before Basic would show any strain.

**Downgrade savings:** ~$175/mo

---

## Azure Redis — C2 Standard (~$53/mo)

**Why the developer chose it:** C2 Standard gives 6GB memory, two replicas (primary + secondary for automatic failover), and a 99.9% SLA. For a chat app where sessions are the source of truth, losing Redis means losing every active conversation — the developer was being conservative about data durability.

**Was it overkill?** Yes for now. The Standard tier's failover replicas are valuable in production, but C2 (6GB) vs C0 (250MB) is purely about memory. Session data is ~5KB per user. Even at 1,000 simultaneous users, that's 5MB total. You'd need tens of thousands of concurrent users to fill C0.

**Risk of downgrading to C0 (~$16/mo):** C0 is Basic tier — it drops the automatic failover replica. If the Redis node crashes, there's a brief outage (minutes, not hours) while Azure restarts it. Sessions in Redis would be lost during that window, meaning users mid-conversation would have to start over. Acceptable for a single tester. **Before BCG goes live, upgrade back to at least C1 Standard (~$40/mo)** for failover protection.

**Downgrade savings:** ~$37/mo (to C0) or ~$13/mo (to C1 Standard, still production-safe)

---

## App Service — B1 + Public IP + Load Balancer (~$20/mo)

**Why the developer chose it:** Likely set up as an alternative deployment target before Vercel was settled on. Azure App Service is a natural choice for a Node.js app when you're already all-in on Azure — keeps everything in one cloud and simplifies private VNet networking to Cosmos DB and Redis. At some point the project pivoted to Vercel, and the App Service never got cleaned up.

**Was it overkill?** It wasn't overkill — it was reasonable architecture for a fully Azure-hosted app. It's just abandoned now that Vercel is the platform.

**Risk of deleting:** Near zero. GitHub Actions CI only deploys to Vercel. The only scenario where you'd regret it: moving off Vercel back to Azure-hosted (for VNet-private connectivity to Cosmos DB/Redis). That's a real consideration for enterprise clients requiring data residency, but you can always create a new App Service then.

**Savings:** ~$20/mo

---

## Key Vault (~$5/mo)

**Why the developer chose it:** Key Vault is Azure best practice — secrets should never live in app config or environment variables in production. The code to use it (`SecretClient`) was written but never wired into the actual runtime — likely a "we'll do this properly later" placeholder.

**Was it overkill?** No, the intent was correct. The execution was just never finished. Vercel's encrypted environment variables are a reasonable substitute for a single-tenant app at this stage, but Key Vault is the right long-term answer if BCG ever requires SOC 2 or similar compliance.

**Risk of deleting:** Low right now since nothing reads from it. The risk: if BCG or a future enterprise client requires "secrets are managed in a vault, not in app env vars" for a compliance audit, you'd recreate it and wire it up properly.

**Savings:** ~$5/mo

---

## Overall Verdict

The developer wasn't being reckless — they were building for production scale from day one, which is a good instinct. The problem is pre-production infrastructure at production scale burns real money for months before launch. The right approach would have been dev-tier resources during development, upgrading only when traffic justifies it.

**Total potential savings if all downgraded:** ~$237/mo (from ~$465 to ~$228)

### When to actually pull the trigger on downgrades

| Signal | Action |
|---|---|
| Launch is still 4+ weeks away | Downgrade everything now, re-upgrade before BCG go-live |
| Launch is 1–2 weeks away | Skip the downgrades — not worth the migration risk for 1–2 months of savings |
| BCG is live and a second tenant is coming | Upgrade AI Search back to S1 Standard |
| 500+ daily active users | Upgrade Redis to C2 Standard for failover reliability |

---

## Full Optimization Playbook (~$250/mo savings)

### Part 1 — Portal-only (no downtime, do these first)

Open [portal.azure.com](https://portal.azure.com) → your resource group.

**Step 1: Delete App Service stack**
Find and delete all four of these resources (select each → Delete):
- App Service (the web app itself)
- App Service Plan (the B1 plan)
- Public IP address
- Load Balancer

**Step 2: Delete Key Vault**
Find the Key Vault resource → Delete. Confirm. Done.

**Step 3: Downgrade Redis C2 → C0**
Find your Redis Cache (`amerivetcacheredis`) → **Scale** (left sidebar) → select **C0 Basic (250 MB)** → Save. Takes ~5 minutes, Redis stays live during the resize.

---

### Part 2 — AI Search migration (zero-downtime, old service stays live until the end)

**Step 4: Create the new Basic-tier Search service in the portal**
- New resource → Azure AI Search
- Name: `amerivetsearch-basic` (or similar)
- Tier: **Basic** ($75/mo)
- Same region as your existing service
- Once deployed, copy the new **endpoint URL** and **Admin API key** from Keys tab

**Step 5: Create the index on the new service**

Run from your project directory (PowerShell):
```powershell
$env:AZURE_SEARCH_ENDPOINT = "https://amerivetsearch-basic.search.windows.net"
$env:AZURE_SEARCH_API_KEY  = "<your-new-admin-key>"
.\scripts\azure-search-recreate-index.ps1
```

**Step 6: Re-index your documents**
```powershell
.\scripts\upload-amerivet-docs.ps1
```
(This will take a few minutes — it re-embeds and uploads all docs to the new index.)

**Step 7: Update Vercel env vars**

Go to Vercel → your project → Settings → Environment Variables. Update:
- `AZURE_SEARCH_ENDPOINT` → `https://amerivetsearch-basic.search.windows.net`
- `AZURE_SEARCH_ADMIN_KEY` → your new key

Then redeploy (or just trigger a redeploy from the Vercel dashboard — Vercel picks up env var changes on next deploy).

**Step 8: Verify**

Hit your production URL at `/api/health/search` — should return healthy. Also do a quick chat test to confirm RAG retrieval is working.

**Step 9: Delete the old S1 service**

Back in the portal, find `amerivetsearch` (the S1) → Delete. This is the $250/mo line item.

### What to expect

| Action | Savings |
|---|---|
| Delete App Service stack | ~$20/mo |
| Delete Key Vault | ~$5/mo |
| Redis C2 → C0 | ~$37/mo |
| AI Search S1 → Basic | ~$175/mo |
| **Total** | **~$237/mo** |

You'll go from ~$465 to ~$228/mo.

---

### Re-upgrade checklist before BCG go-live
- [ ] Redis: C0/C1 Basic → C1 Standard (adds automatic failover replica)
- [ ] AI Search: if still on Basic → Standard S1 if corpus > 2GB or DAU > 500
- [ ] App Service: recreate only if enterprise client requires Azure-only VNet hosting
- [ ] Key Vault: wire up properly if SOC 2 or compliance audit is required
