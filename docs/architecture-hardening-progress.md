# Architecture Hardening Progress

## 2026-04-10

### Manual audit findings from live production testing
- Branding/logo rendering is broken in the production header.
- Dark mode is only partially applied outside the chat surface.
- Calculator still shows Kaiser as unavailable in Georgia, creating chat/calculator parity drift.
- The main production weakness is multi-turn conversational reliability:
  - onboarding transitions like "Let's look at medical" fell into the generic fallback
  - normal follow-ups like "what coverage tiers are available?" fell into the generic fallback
  - yes/no continuation prompts were not being honored reliably
  - state correction messages like "I'm in WA" did not repair the active topic correctly
  - suggested scenarios sometimes failed immediately or on the first follow-up

### Repair pass implemented
- Re-enabled deterministic QA-route conversation intercepts for production flow instead of letting normal follow-ups fall through to the generic fallback path.
- Broadened follow-up detection to recognize:
  - punctuation-normalized affirmations like `yes.`
  - state corrections like `I'm in WA`
  - usage-level follow-ups like `my usage is moderate`
  - coverage-tier follow-ups
- Added deterministic handling for:
  - family-coverage scenario prompts
  - coverage-tier responses
  - side-by-side comparison continuations
  - usage-level cost-model continuations
  - state-correction continuations without requiring `dataConfirmed`

### Local verification
- Focused tests:
  - `33 passed`
- Production-style build:
  - `npm run build:vercel` passed

### Still intentionally out of scope for this repair pass
- Broken production logo rendering
- Calculator Kaiser/Georgia eligibility mismatch
- Broader visual polish issues like incomplete dark mode consistency
