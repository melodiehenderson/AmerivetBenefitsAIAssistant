# AmeriVet Benefits AI Chatbot - Quick Reference Card

## 🔑 Key URLs

| Purpose | URL |
|---------|-----|
| **Production Site** | https://amerivet.bcgenrolls.com |
| **Enrollment Portal** | https://wd5.myworkday.com/amerivet/login.htmld |
| **Vercel Dashboard** | https://vercel.com/melodie-s-projects/benefitsaichatbot-sm |

---

## 🚀 Deployment Commands

```bash
# Deploy to production
cd c:\Users\sonal\benefitsaichatbot-383
vercel --prod

# Preview deployment (staging)
vercel
```

---

## 💰 Pricing Quick Reference

### Medical Plans (Monthly)
| Plan | EE Only | +Spouse | +Kids | +Family |
|------|---------|---------|-------|---------|
| HSA High Deductible | $250 | $450 | $375 | $625 |
| PPO Standard | $380 | $684 | $570 | $950 |
| PPO Premium | $520 | $936 | $780 | $1,300 |
| Kaiser HMO* | $300 | $540 | $450 | $750 |

*Kaiser: WA, CA, OR, CO, GA, HI, MD, VA, DC only

### Dental Plans (Monthly)
| Plan | EE Only | +Spouse | +Kids | +Family |
|------|---------|---------|-------|---------|
| DHMO | $15 | $28 | $25 | $38 |
| DPPO | $29 | $57 | $72 | $114 |

### Vision Plan (Monthly)
| Plan | EE Only | +Spouse | +Kids | +Family |
|------|---------|---------|-------|---------|
| VSP Vision Plus | $12 | $23 | $20 | $32 |

---

## 🏥 Life Insurance Carriers (CRITICAL)

| Product | Carrier | Notes |
|---------|---------|-------|
| Basic Life ($25k) | **UNUM** | Free, auto-enrolled |
| Voluntary Life (term) | **UNUM** | Up to $500k |
| Whole Life (permanent) | **ALLSTATE** | Cash value grows |

⚠️ **IMPORTANT:** 
- UNUM = Term Life ONLY
- Allstate = Whole Life ONLY
- Recommended split: 20% Whole + 80% Voluntary

---

## 🔧 Common Fixes

### Update Pricing
Edit `app/api/qa/route.ts` → Search for `=== MEDICAL PLAN PRICING ===`

### Add Kaiser State
Edit line ~20: `const KAISER_STATES = new Set([...])`

### Fix Wrong Carrier Info
Add hardcoded intercept in `app/api/qa/route.ts` (~lines 1500-1660)

---

## 🆘 Troubleshooting

| Problem | Quick Fix |
|---------|-----------|
| Asterisks showing | Frontend markdown issue |
| Wrong carrier | Add intercept handler |
| Session lost | Automatic recovery via client |
| Build fails | Run `npm run typecheck` |

---

## 📁 Key Files

| File | Purpose |
|------|---------|
| `app/api/qa/route.ts` | Main chat logic (2000+ lines) |
| `lib/rag/session-store.ts` | Session management |
| `app/icon.png` | Favicon (AmeriVet logo) |
| `.env.local` | Local environment vars |

---

## 🔐 Environment Variables

Required in Vercel Dashboard:
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_SEARCH_ENDPOINT`
- `AZURE_SEARCH_API_KEY`
- `AZURE_COSMOS_ENDPOINT`
- `AZURE_COSMOS_KEY`
- `REDIS_URL`
- `NEXTAUTH_SECRET`

---

*Quick Reference v1.0 | January 2026*
