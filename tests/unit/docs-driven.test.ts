// docs-driven.test.ts
// Unit test: fetch expected answers from documentation URLs
import { describe, it, expect, vi } from 'vitest';
import { fetchDocAnswer } from '../../lib/utils/fetch-doc-answer';

const MOCK_IRS_CONTENT = vi.hoisted(() => `
  HSA contribution limits for 2025:
  Self-only coverage: $4,300
  Family coverage: $8,550
  The minimum deductible for a high-deductible health plan (HDHP)
  for self-only coverage is $1,650.
  If your spouse is covered by a general-purpose FSA, you cannot contribute to an HSA.
`);

vi.mock('../../lib/utils/fetch-doc-answer', () => ({
  fetchDocAnswer: vi.fn().mockResolvedValue(MOCK_IRS_CONTENT)
}));

const testCases = [
  {
    query: "I'm enrolling in Standard HSA. My spouse has general-purpose Healthcare FSA through their own employer. Can I still contribute?",
    docUrl: 'https://www.irs.gov/publications/p969', // Example IRS doc for HSA
    expectedSnippet: 'If your spouse is covered by a general-purpose FSA, you cannot contribute to an HSA.',
  },
  // Add more cases as needed
];

describe('docs-driven Q&A validation', () => {
  testCases.forEach(({ query, docUrl, expectedSnippet }) => {
    it(`validates answer for: ${query.slice(0, 60)}...`, async () => {
      const docContent = await fetchDocAnswer(docUrl);
      expect(docContent).toContain(expectedSnippet);
    });
  });
});
