# Pre-Launch Checklist — BCG Handoff

Run through this the day before (or morning of) handing access to BCG.

---

## 1. Run the smoke test

```bash
./scripts/smoke-test.sh https://your-app.vercel.app
```

All 8 checks must say PASS. If any fail, see the fix column below.

| Check | What it means if it fails |
|---|---|
| OpenAI configured | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, or `AZURE_OPENAI_DEPLOYMENT_NAME` is missing from Vercel env vars. Bot will escalate every question to the phone number. |
| Redis available | Redis connection string is wrong or Redis is down. Sessions won't persist — every message is a fresh conversation. |
| Redis round-trip | Redis is reachable but write/read failing. Same symptom as above. |
| amerivet docs in index | AI Search has no documents for company_id = 'amerivet'. RAG retrieval returns nothing; bot answers from catalog only (degraded but not broken). Re-run `upload-amerivet-docs.ps1`. |

---

## 2. Verify env vars in Vercel

Settings → Environment Variables → confirm these are set for **Production**:

**Must-haves (bot breaks without these):**
- [ ] `AZURE_OPENAI_ENDPOINT`
- [ ] `AZURE_OPENAI_API_KEY`
- [ ] `AZURE_OPENAI_DEPLOYMENT_NAME`
- [ ] `AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT`
- [ ] `AZURE_SEARCH_ENDPOINT`
- [ ] `AZURE_SEARCH_API_KEY` (or `AZURE_SEARCH_ADMIN_KEY`)
- [ ] `AZURE_SEARCH_INDEX` (should be `chunks_prod_v1`)
- [ ] `REDIS_URL`
- [ ] `NEXTAUTH_SECRET`
- [ ] `NEXTAUTH_URL` (must match your production domain)

**Should-haves (features degrade without these):**
- [ ] `ENROLLMENT_PORTAL_URL` (defaults to Workday URL — verify it's the right one for AmeriVet)
- [ ] `HR_PHONE_NUMBER` (defaults to 888-217-4728 — confirm with AmeriVet)

---

## 3. Do a manual chat walkthrough

Log in as an employee and run through this sequence:

- [ ] Bot greets you and asks your name
- [ ] Provide name + state + age → bot acknowledges all three
- [ ] Ask about medical plans → bot shows plans with correct tier pricing (not Employee Only if you gave household info)
- [ ] Say "yes" / "sure" after a topic nudge → bot goes directly to that topic (not a generic response)
- [ ] Ask "what will my total monthly cost be?" → bot leads with the number, then explains
- [ ] Ask about Kaiser → bot says not available in your state (if TX/FL/NY)
- [ ] Ask "can I use my HSA for my dog?" → bot says no with the IRS reason

---

## 4. Confirm budget caps are active

In Azure OpenAI → your deployment → check the TPM (tokens per minute) limit is set.
Separately, confirm your Vercel spend limit is on if you're on a paid plan.

Current approved budget: **$40/day, $0.30/session, $900/month ceiling**.

---

## 5. Set up BCG access

- [ ] Create BCG user account(s) in the admin panel with company_id = `bcg` (or whatever is configured)
- [ ] Confirm BCG users can log in but cannot see AmeriVet data (tenant isolation)
- [ ] Send BCG their login URL and temp credentials

---

## After handoff

Monitor for the first 48 hours:
- Vercel → Functions logs for any unhandled errors
- Azure OpenAI → Cost Management for unexpected spend spikes
- `/api/health` endpoint — bookmark it for quick checks
