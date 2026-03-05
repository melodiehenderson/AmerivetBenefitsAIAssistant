import { test, expect } from '@playwright/test';

// ─── The "Final Boss" prompt ─────────────────────────────────────────────────
// Combines FIVE simultaneous constraints the Principal Architect must handle:
//  1. State resolution:  Delaware → DE, non-Kaiser state
//  2. IRS Pub 969:       spouse general FSA → HSA ineligible
//  3. STD math:          $5,000/month ÷ 4.33 × 0.60 = $692.84/week (Week 6 = STD active)
//  4. Carrier lock:      UNUM for STD, Allstate for Whole Life (Kaiser must NOT appear)
//  5. Compound query:    IRS conflict AND maternity pay — both must be answered
const FINAL_BOSS_PROMPT =
  "I'm 45 in Delaware. I earn $5,000/month. My spouse has a general FSA. I want the Standard HSA. How much will I be paid in my 6th week of maternity leave?";

test.describe('Final Boss: Principal Architect Reasoning Pipeline', () => {
  test(
    'resolves DE state, enforces IRS Pub 969 HSA block, calculates STD week-6 pay, excludes Kaiser',
    async ({ page, context }) => {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

      await context.addCookies([
        {
          name: 'amerivet_session',
          value: 'employee',
          url: baseUrl,
        },
      ]);

      await page.goto('/subdomain/chat');

      const chatInput = page.getByPlaceholder('Ask about your benefits...');
      await expect(chatInput).toBeVisible({ timeout: 60_000 });

      await chatInput.fill(FINAL_BOSS_PROMPT);
      await page.locator('form button[type="submit"]').click();

      const thinkingIndicator = page.getByText('Thinking...');
      await thinkingIndicator.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
      await expect(thinkingIndicator).toBeHidden({ timeout: 90_000 });

      const assistantMessages = page.locator('.justify-start p.text-sm.whitespace-pre-wrap');
      await expect(assistantMessages.last()).toBeVisible({ timeout: 30_000 });
      const answer = (await assistantMessages.last().innerText()).trim();

      // ── Assertion 1: State resolution — "Delaware" or "DE" must appear ────
      const stateResolved = /\bdelaware\b|\bde\b/i.test(answer);

      // ── Assertion 2: IRS Pub 969 — HSA blocked by spouse's general FSA ───
      const irsConflict =
        /(general\s*(?:purpose\s*)?fsa|spouse.*fsa|fsa.*spouse)/i.test(answer) &&
        /(hsa)/i.test(answer) &&
        /(ineligible|not\s+eligible|disqualif|cannot\s+contribute|can'?t\s+contribute|not\s+allowed|pub(?:lication)?\s*969|irs\s+rule)/i.test(answer);

      // ── Assertion 3: STD week-6 math ($692 or "6th week" + pay context) ──
      // $5,000/month ÷ 4.33 = $1,154.73/week × 60% = $692.84/week
      const stdMathOrWeek6 =
        /692|6th\s*week|sixth\s*week|week\s*6|std\s*active|unum.*pay|pay.*unum/i.test(answer);

      // ── Assertion 4: Kaiser must NOT appear (DE is not CA/WA/OR) ─────────
      const kaiserAbsent = !/\bkaiser\b/i.test(answer);

      // ── Assertion 5: [REASONING] block must NOT appear in the user-facing
      //    response — the extractReasonedResponse() function strips it ────────
      const reasoningStripped = !/\[REASONING\]/i.test(answer);

      expect.soft(stateResolved,     `[FAIL] State not resolved to Delaware. Answer:\n${answer}`).toBe(true);
      expect.soft(irsConflict,       `[FAIL] IRS Pub 969 HSA block missing. Answer:\n${answer}`).toBe(true);
      expect.soft(stdMathOrWeek6,    `[FAIL] STD week-6 pay math missing. Answer:\n${answer}`).toBe(true);
      expect.soft(kaiserAbsent,      `[FAIL] Kaiser mentioned for non-Kaiser state. Answer:\n${answer}`).toBe(true);
      expect.soft(reasoningStripped, `[FAIL] [REASONING] tag leaked into user response. Answer:\n${answer}`).toBe(true);

      expect(
        stateResolved && irsConflict && stdMathOrWeek6 && kaiserAbsent && reasoningStripped,
        `One or more Final Boss assertions failed.\n\nFull answer:\n${answer}`
      ).toBe(true);
    }
  );

  // ─── Regression: earlier prompt (Chicago / family-of-5 / no-pricing) ─────
  test(
    'regression — Chicago state mapping, IRS conflict, family tier, no dollar signs',
    async ({ page, context }) => {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      await context.addCookies([{ name: 'amerivet_session', value: 'employee', url: baseUrl }]);
      await page.goto('/subdomain/chat');

      const chatInput = page.getByPlaceholder('Ask about your benefits...');
      await expect(chatInput).toBeVisible({ timeout: 60_000 });

      const regressionPrompt =
        "I'm 40 in Chicago. My spouse has a general FSA. Tell me the difference between the HSA and PPO plans for my family of 5, but do not show any dollar signs.";
      await chatInput.fill(regressionPrompt);
      await page.locator('form button[type="submit"]').click();

      const thinkingIndicator = page.getByText('Thinking...');
      await thinkingIndicator.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
      await expect(thinkingIndicator).toBeHidden({ timeout: 90_000 });

      const assistantMessages = page.locator('.justify-start p.text-sm.whitespace-pre-wrap');
      await expect(assistantMessages.last()).toBeVisible({ timeout: 30_000 });
      const answer = (await assistantMessages.last().innerText()).trim();

      expect.soft(/\billinois\b|\bil\b/i.test(answer), `State resolution failed`).toBe(true);
      expect.soft(
        /(general\s*fsa|spouse.*fsa)/i.test(answer) && /hsa/i.test(answer) &&
        /(ineligible|not\s+eligible|disqualif|cannot\s+contribute|can'?t\s+contribute)/i.test(answer),
        `IRS compliance signal failed`
      ).toBe(true);
      expect.soft(
        /(family\s*of\s*5|family\s*tier|employee\s*\+\s*family|family\s*coverage|dependents?)/i.test(answer),
        `Family-tier logic failed`
      ).toBe(true);
      expect.soft(!/\$/g.test(answer), `No-pricing constraint failed`).toBe(true);
    }
  );
});
