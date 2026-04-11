import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AzureOpenAI } from 'openai';

function loadJudgeCases() {
  const raw = readFileSync(resolve(process.cwd(), 'tests/eval/eval-dataset.jsonl'), 'utf-8');
  return raw
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line))
    .filter(c => c.category === 'llm_as_judge' && !!c.expectedAnswer)
    .slice(0, 5);
}

function extractJsonObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`No JSON object found in judge output: ${text.slice(0, 200)}`);
  }
  return text.slice(start, end + 1);
}

function createClient() {
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || '').trim();
  const apiKey = (process.env.AZURE_OPENAI_API_KEY || '').trim();
  const apiVersion = (process.env.AZURE_OPENAI_API_VERSION || '2024-02-01').trim();

  if (!endpoint || !apiKey) {
    throw new Error('Missing Azure OpenAI endpoint or API key in environment.');
  }

  return new AzureOpenAI({
    endpoint,
    apiKey,
    apiVersion,
  });
}

async function runJudgeOnce(client, testCase) {
  const rubric = (testCase.evaluation_prompts || [
    'Score factual accuracy, completeness, and absence of hallucination.',
  ]).join(' ');

  const messages = [
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

  const model = (process.env.AZURE_OPENAI_DEPLOYMENT_NAME || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4').trim();

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature: 0,
    max_tokens: 220,
  });

  const content = response.choices?.[0]?.message?.content || '';
  const parsed = JSON.parse(extractJsonObject(content));

  if (typeof parsed.score !== 'number' || !Number.isFinite(parsed.score)) {
    throw new Error(`Invalid score from judge: ${content.slice(0, 220)}`);
  }
  if (typeof parsed.rationale !== 'string') {
    throw new Error(`Invalid rationale from judge: ${content.slice(0, 220)}`);
  }
  return parsed;
}

async function main() {
  const judgeCases = loadJudgeCases();
  if (judgeCases.length < 3) {
    throw new Error(`Expected at least 3 llm_as_judge cases, found ${judgeCases.length}`);
  }

  const client = createClient();
  const caseSummaries = [];

  for (const testCase of judgeCases) {
    const scores = [];
    for (let i = 0; i < 3; i += 1) {
      const judged = await runJudgeOnce(client, testCase);
      scores.push(judged.score);
    }
    const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    caseSummaries.push({ id: testCase.id, scores, average: Number(average.toFixed(2)) });
  }

  const overallAverage = caseSummaries.reduce((sum, item) => sum + item.average, 0) / caseSummaries.length;
  const summary = {
    totalCases: caseSummaries.length,
    overallAverage: Number(overallAverage.toFixed(2)),
    passingThreshold: 4.0,
    pass: overallAverage >= 4.0 && caseSummaries.every(item => item.average >= 4.0),
    cases: caseSummaries,
  };

  console.log(`[LLM-JUDGE-SUMMARY] ${JSON.stringify(summary)}`);

  if (!summary.pass) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[LLM-JUDGE-ERROR] ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
