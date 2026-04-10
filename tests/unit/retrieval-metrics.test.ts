import { describe, expect, it } from 'vitest';
import {
  chunkToSearchableText,
  computePhraseMRR,
  computePhraseRecallAtK,
  summarizeRepeatedRuns,
} from '@/tests/eval/retrieval-metrics';

const chunk = (id: string, text: string) =>
  ({
    id,
    docId: `doc-${id}`,
    companyId: 'amerivet',
    sectionPath: 'section/path',
    content: text,
    title: `Title ${id}`,
    position: 0,
    windowStart: 0,
    windowEnd: text.length,
    metadata: {},
    createdAt: new Date(),
  }) as any;

describe('retrieval-metrics', () => {
  it('normalizes chunk content into searchable text', () => {
    const text = chunkToSearchableText(chunk('1', 'General-purpose FSA can affect HSA eligibility.'));
    expect(text).toContain('general-purpose fsa');
    expect(text).toContain('title 1');
  });

  it('computes phrase recall@k across top-k chunks', () => {
    const chunks = [
      chunk('1', 'General-purpose FSA can affect HSA eligibility.'),
      chunk('2', 'IRS rules govern HSA contribution eligibility.'),
    ];

    expect(
      computePhraseRecallAtK(['general-purpose FSA', 'IRS', 'HSA'], chunks, 2)
    ).toBe(1);
  });

  it('computes phrase MRR based on first relevant chunk rank', () => {
    const chunks = [
      chunk('1', 'Dental annual maximum is 1500 dollars.'),
      chunk('2', 'Vision frames are available every 12 months.'),
    ];

    expect(computePhraseMRR(['frames', '12 months'], chunks)).toBe(0.5);
  });

  it('summarizes repeated runs and reports stability', () => {
    expect(summarizeRepeatedRuns([1, 1, 1])).toEqual({
      min: 1,
      max: 1,
      avg: 1,
      stable: true,
    });

    expect(summarizeRepeatedRuns([1, 0.5, 1])).toEqual({
      min: 0.5,
      max: 1,
      avg: 0.8333,
      stable: false,
    });
  });
});
