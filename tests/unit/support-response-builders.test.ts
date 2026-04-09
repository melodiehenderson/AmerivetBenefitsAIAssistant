import { describe, expect, it } from 'vitest';

import {
  buildClarifyThenPortalFallback,
  buildLiveSupportFallback,
} from '../../lib/qa/support-response-builders';

describe('support-response-builders', () => {
  it('buildClarifyThenPortalFallback keeps clarify-first wording and portal link', () => {
    const response = buildClarifyThenPortalFallback(
      'https://wd5.myworkday.com/amerivet/login.html',
      '888-217-4728',
    );

    expect(response).toContain("I couldn't verify that in the official AmeriVet benefits documents");
    expect(response).toContain("reply with the specific benefit, plan name, or state");
    expect(response).toContain('[benefits enrollment portal](https://wd5.myworkday.com/amerivet/login.html)');
    expect(response).toContain('AmeriVet HR/Benefits at 888-217-4728');
  });

  it('buildLiveSupportFallback keeps the shared support handoff wording', () => {
    const response = buildLiveSupportFallback(
      'https://wd5.myworkday.com/amerivet/login.html',
      '888-217-4728',
    );

    expect(response).toContain('For live support or additional assistance');
    expect(response).toContain('AmeriVet HR/Benefits at 888-217-4728');
    expect(response).toContain('enrollment portal at https://wd5.myworkday.com/amerivet/login.html');
    expect(response).toContain('Is there anything else I can help you with?');
  });
});
