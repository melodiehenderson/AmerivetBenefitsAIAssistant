here are 2 fixes I’ve noted that need to be made - preferably BEFORE he tests it again. Are you available to do these today?


1) Please give the bot this link for the enrollment platform - (currently it’s giving https:// amerivetaibot.bcgenrolls. com/subdomain/login instead):

https://wd5.myworkday.com/amerivet/login.htmld



2) Let’s NOT have the bot say “Good news! Kaiser is available in (state)!" in response to the very first question. It makes it sound like the bot is pushing Kaiser above the other options. (See below)

Screenshot 2026-01-30 at 8.52.23 AM.png# AmeriVet Benefits AI Chatbot - Features Changelog

## Version 1.0 (January 2026) - Production Release

### Core Conversation Features

#### ✅ Smart Onboarding Flow
- Collects user name first
- Asks for age + state for accurate pricing
- Shows personalized benefits menu
- Remembers user across session

#### ✅ Decision Tracker
- Tracks user selections (✅ selected)
- Tracks opt-outs (❌ declined) 
- Detects phrases like "no vision needed", "skip dental"
- Summary command shows all decisions

#### ✅ Life Insurance (Hardcoded Accuracy)
- All 3 types displayed: Basic, Voluntary, Whole Life
- Carrier accuracy enforced: UNUM vs ALLSTATE
- 20/80 split recommendation included
- Intercepts prevent LLM hallucination on carrier questions

#### ✅ Medical Plan Intelligence
- Kaiser HMO state detection (9 states)
- High utilization detection (surgery, pregnancy)
- Recommends comprehensive plans for heavy users
- All pricing displayed correctly

#### ✅ Anti-Hallucination System
- Hardcoded intercepts for critical facts
- Validation pipeline with grounding checks
- System prompt with explicit rules
- Non-US country rejection (Canada, Mexico, etc.)

#### ✅ Session Persistence
- Redis primary → Memory fallback → FS backup
- Client-side session context backup
- Survives serverless cold starts

### UI/Branding

#### ✅ AmeriVet Branding
- Custom favicon (AmeriVet logo)
- Branded welcome message
- Enrollment portal links

#### ✅ Clean Response Formatting
- No asterisks in life insurance responses
- Proper bullet points
- Emoji indicators for decisions

### Bug Fixes (Final Sprint)

| Issue | Fix |
|-------|-----|
| Wrong carrier for Whole Life | Hardcoded ALLSTATE intercept |
| Asterisks showing in responses | Removed markdown formatting |
| Medical pricing shown unprompted | Fixed intent detection |
| Canada accepted as location | Added non-US country rejection |
| State correction not working | Allowed state updates |

---

## Configuration Locations

### Pricing Tables
`app/api/qa/route.ts` lines 780-870

### Kaiser States
`app/api/qa/route.ts` line 20

### Life Insurance Intercepts
`app/api/qa/route.ts` lines 1500-1660

### Non-US Countries
`app/api/qa/route.ts` lines 250-280

---

## Test Scenarios

### Life Insurance Flow
1. "Let's do life insurance first" → Shows all 3 types
2. "Who is this with?" → Shows carrier breakdown
3. "I thought it was Allstate" → Corrects misconception
4. "How much should I buy?" → 20/80 recommendation

### Location Handling
1. "45 in Canada" → Rejects, asks for US state
2. "45 in Colorado" → Shows benefits menu (Kaiser available)
3. "45 in Texas" → Shows benefits menu (no Kaiser)

### Opt-Out Detection
1. "No vision needed" → Marks Vision as declined
2. "Skip dental" → Marks Dental as declined
3. "summary" → Shows decisions with ✅/❌ indicators

---

*Changelog v1.0 | January 16, 2026*
