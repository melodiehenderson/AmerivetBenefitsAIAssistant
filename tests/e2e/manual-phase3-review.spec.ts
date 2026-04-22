import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const OUTPUT_DIR = '/tmp/amerivet-phase3-review';

type TranscriptTurn = {
  step: string;
  user: string;
  assistant: string;
  screenshot?: string;
};

async function scrollChatToBottom(page: Parameters<typeof test>[0]['page']) {
  await page.locator('.overflow-y-scroll').evaluateAll((nodes) => {
    for (const node of nodes) {
      if (node instanceof HTMLElement) {
        node.scrollTop = node.scrollHeight;
      }
    }
  }).catch(() => undefined);
  await page.waitForTimeout(250);
}

async function latestAssistantText(page: Parameters<typeof test>[0]['page']) {
  const assistantMessages = page.getByTestId('message-assistant');
  const count = await assistantMessages.count();
  if (!count) return '';
  return (await assistantMessages.nth(count - 1).getByTestId('message-content').innerText()).trim();
}

async function sendAndCapture(
  page: Parameters<typeof test>[0]['page'],
  message: string,
  transcript: TranscriptTurn[],
  step: string,
  screenshotName?: string,
) {
  const assistantMessages = page.getByTestId('message-assistant');
  const beforeCount = await assistantMessages.count();
  const beforeText = beforeCount ? await latestAssistantText(page) : '';

  const input = page.getByPlaceholder('Ask about your benefits...');
  await expect(input).toBeVisible({ timeout: 30_000 });
  await input.fill(message);
  await page.locator('form button[type="submit"]').click();

  const loading = page.getByTestId('message-assistant-loading');
  await loading.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);

  await expect
    .poll(
      async () => {
        const count = await assistantMessages.count();
        const text = count ? await latestAssistantText(page) : '';
        return JSON.stringify({ count, text });
      },
      { timeout: 90_000 },
    )
    .not.toBe(JSON.stringify({ count: beforeCount, text: beforeText }));

  await loading.waitFor({ state: 'hidden', timeout: 90_000 }).catch(() => undefined);
  await scrollChatToBottom(page);

  const assistant = await latestAssistantText(page);
  const screenshot = screenshotName ? path.join(OUTPUT_DIR, screenshotName) : undefined;

  if (screenshot) {
    await page.screenshot({ path: screenshot, fullPage: false });
  }

  transcript.push({ step, user: message, assistant, screenshot });
}

test.use({ userAgent: 'BenefitsAI-ManualReview/1.0' });
test.setTimeout(240_000);

test('captures a screenshot-backed regression review transcript', async ({ page, context }) => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const transcript: TranscriptTurn[] = [];

  await context.addCookies([
    {
      name: 'amerivet_session',
      value: 'employee',
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);

  await page.goto('/subdomain/chat');
  await expect(page.getByPlaceholder('Ask about your benefits...')).toBeVisible({ timeout: 60_000 });

  await sendAndCapture(page, 'Misha', transcript, 'onboarding-name');
  await sendAndCapture(page, '42, OR', transcript, 'onboarding-age-state', '01-overview.png');
  await sendAndCapture(page, 'medical', transcript, 'medical-entry');
  await sendAndCapture(page, "what's a coverage tier?", transcript, 'coverage-tier');
  await sendAndCapture(page, "oh! okay, i'm looking for myself and my 5 kids.", transcript, 'household-correction', '02-household-correction.png');
  await sendAndCapture(page, 'estimate likely costs', transcript, 'estimate-costs');
  await sendAndCapture(page, 'can you tell me about the copays here?', transcript, 'copays', '03-copays.png');
  await sendAndCapture(page, 'what about maternity coverage?', transcript, 'maternity-coverage');
  await sendAndCapture(
    page,
    "so i want to spend as little out of pocket as possible, and i am pregnant. my daughter sees a therapist 1x per month, and i have 3 regular prescriptions. which plan would you recommend?",
    transcript,
    'integrated-recommendation',
    '04-integrated-recommendation.png',
  );
  await sendAndCapture(
    page,
    "ok. and how about for next year? next year i won't be pregnant, but my daughter will still see her therapist, and i'll still need my 3 prescriptions.",
    transcript,
    'next-year-override',
    '05-next-year-override.png',
  );
  await sendAndCapture(
    page,
    "no - like, what if i don't need maternity?",
    transcript,
    'no-maternity-override',
    '06-no-maternity-override.png',
  );
  await sendAndCapture(page, 'what are my other benefit options?', transcript, 'other-benefits', '07-other-benefits.png');
  await sendAndCapture(page, 'dental', transcript, 'dental-entry');
  await sendAndCapture(page, 'what does bcbstx stand for?', transcript, 'bcbstx-definition', '08-bcbstx-definition.png');

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'transcript.json'),
    JSON.stringify(transcript, null, 2),
    'utf8',
  );

  console.log(JSON.stringify({ outputDir: OUTPUT_DIR, transcript }, null, 2));
});
