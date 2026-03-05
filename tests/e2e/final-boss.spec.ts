import { test, expect } from '@playwright/test';

const FINAL_BOSS_PROMPT =
  "I'm 40 in Chicago. My spouse has a general FSA. Tell me the difference between the HSA and PPO plans for my family of 5, but do not show any dollar signs.";

test.describe('Final Boss integration', () => {
  test('enforces state mapping, IRS conflict, family-tier, and no-pricing constraints', async ({ page, context }) => {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

    await context.addCookies([
      {
        name: 'amerivet_session',
        value: 'employee',
        url: baseUrl,
        path: '/',
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

    const stateResolved = /\billinois\b|\bil\b/i.test(answer);
    const irsCompliance =
      /(general\s*fsa|spouse.*fsa)/i.test(answer) &&
      /(hsa)/i.test(answer) &&
      /(ineligible|not\s+eligible|disqualif|cannot\s+contribute|can\'?t\s+contribute|not\s+allowed)/i.test(answer);
    const tierLogic =
      /(family\s*of\s*5|family\s*tier|employee\s*\+\s*family|family\s*coverage|spouse\s*and\s*(children|kids)|dependents?)/i.test(answer);
    const noDollarSigns = !/\$/g.test(answer);

    expect.soft(stateResolved, `State resolution failed. Answer:\n${answer}`).toBe(true);
    expect.soft(irsCompliance, `IRS compliance signal failed. Answer:\n${answer}`).toBe(true);
    expect.soft(tierLogic, `Family-tier logic failed. Answer:\n${answer}`).toBe(true);
    expect.soft(noDollarSigns, `No-pricing constraint failed. Answer:\n${answer}`).toBe(true);

    expect(stateResolved && irsCompliance && tierLogic && noDollarSigns).toBe(true);
  });
});
