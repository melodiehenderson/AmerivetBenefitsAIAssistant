import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

type JudgeCase = {
  id: string;
  category: string;
  question: string;
  expectedAnswer: string;
  evaluation_prompts?: string[];
};

type JudgeResult = {
  score: number;
  rationale: string;
};

function loadJudgeCases(): JudgeCase[] {
  const raw = readFileSync(resolve(__dirname, '../eval/eval-dataset.jsonl'), 'utf-8');
  return raw
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as JudgeCase)
    .filter(c => c.category === 'llm_as_judge' && !!c.expectedAnswer)
    .slice(0, 5);
}

function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`No JSON object found in judge output: ${text.slice(0, 200)}`);
  }
  return text.slice(start, end + 1);
}

async function runJudgeOnce(testCase: JudgeCase): Promise<JudgeResult> {
  const realOpenAIModule = await vi.importActual<typeof import('../../lib/azure/openai')>('../../lib/azure/openai');
  const rubric = (testCase.evaluation_prompts || [
    'Score factual accuracy, completeness, and absence of hallucination.'
  ]).join(' ');

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    {
      role: 'system',
      content: [
        'You are an impartial QA judge for benefits responses.',
        'Score only the candidate answer.',
        'Use this 1-5 scale:',
        '1=Incorrect/hallucinated, 2=Major gaps, 3=Partially correct, 4=Mostly correct and complete, 5=Fully correct and complete.',
        'Return strict JSON only: {"score": number, "rationale": string}.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Question: ${testCase.question}`,
        `Candidate answer: ${testCase.expectedAnswer}`,
        `Rubric: ${rubric}`,
        'Evaluate now.',
      ].join('\n\n'),
    },
  ];

  const result = await realOpenAIModule.azureOpenAIService.generateChatCompletion(messages, {
    temperature: 0.0,
    maxTokens: 220,
  });

  if (result.content.trim().toLowerCase() === 'ok') {
    throw new Error('LLM judge received mocked output "ok". Ensure Azure OpenAI mock is bypassed and real credentials are set.');
  }

  const parsed = JSON.parse(extractJsonObject(result.content)) as JudgeResult;
  if (typeof parsed.score !== 'number' || !Number.isFinite(parsed.score)) {
    throw new Error(`Invalid score from judge: ${result.content.slice(0, 220)}`);
  }
  if (typeof parsed.rationale !== 'string') {
    throw new Error(`Invalid rationale from judge: ${result.content.slice(0, 220)}`);
  }
  return parsed;
}

const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || '').trim();
const apiKey = (process.env.AZURE_OPENAI_API_KEY || '').trim();

const looksPlaceholderEndpoint = endpoint === '' || endpoint === '...' || endpoint.includes('test.openai.azure.com');
const looksPlaceholderKey = apiKey === '' || apiKey === '...' || apiKey.startsWith('test-');

const shouldRun =
  process.env.RUN_LLM_JUDGE_EVAL === '1' &&
  !looksPlaceholderEndpoint &&
  !looksPlaceholderKey;

describe.skipIf(!shouldRun)('LLM-as-Judge eval', () => {
  const judgeCases = loadJudgeCases();

  it('dataset includes at least 3 llm_as_judge cases', () => {
    expect(judgeCases.length).toBeGreaterThanOrEqual(3);
  });

  it('average score is >= 4.0 across three judge calls per case', async () => {
    const allAverages: number[] = [];

    for (const testCase of judgeCases) {
      const scores: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const judged = await runJudgeOnce(testCase);
        expect(judged.score).toBeGreaterThanOrEqual(1);
        expect(judged.score).toBeLessThanOrEqual(5);
        scores.push(judged.score);
      }
      const avg = scores.reduce((s, n) => s + n, 0) / scores.length;
      allAverages.push(avg);
      expect(avg, `${testCase.id} average judge score was ${avg.toFixed(2)}`).toBeGreaterThanOrEqual(4.0);
    }

    const overall = allAverages.reduce((s, n) => s + n, 0) / allAverages.length;
    expect(overall).toBeGreaterThanOrEqual(4.0);
  }, 120000);
});
