import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const endpoint = (process.env.AZURE_SEARCH_ENDPOINT || '').trim();
const apiKey = (process.env.AZURE_SEARCH_ADMIN_KEY || process.env.AZURE_SEARCH_API_KEY || '').trim();
const companyId = (process.env.RETRIEVAL_EVAL_COMPANY_ID || 'amerivet').trim();
const runFlag = (process.env.RUN_RETRIEVAL_EVAL || '1').trim();

const shouldRun = runFlag === '1' && endpoint !== '' && endpoint !== '...' && apiKey !== '' && apiKey !== '...';

function buildEvalSource() {
  return `
    import { hybridRetrieve } from './lib/rag/hybrid-retrieval';

    const cases = [
      {
        id: 'RET-LIVE-001',
        question: 'How many days do I have to add my spouse after marriage?',
        expectedChunkIds: ['doc-43edcead1e4b-chunk-82'],
      },
      {
        id: 'RET-LIVE-002',
        question: 'Where do I enroll in benefits?',
        expectedChunkIds: ['doc-43edcead1e4b-chunk-6'],
      },
    ];

    function computeRecallAtK(expectedChunkIds, retrievedChunks, k = 5) {
      const topK = retrievedChunks.slice(0, k).map((chunk) => chunk.id);
      if (expectedChunkIds.length === 0) return 1.0;
      const hits = expectedChunkIds.filter((id) => topK.includes(id)).length;
      return hits / expectedChunkIds.length;
    }

    function computeMRR(expectedChunkIds, retrievedChunks) {
      if (expectedChunkIds.length === 0) return 1.0;
      for (let i = 0; i < retrievedChunks.length; i += 1) {
        if (expectedChunkIds.includes(retrievedChunks[i].id)) {
          return 1 / (i + 1);
        }
      }
      return 0;
    }

    const summaries = [];

    for (const testCase of cases) {
      const first = await hybridRetrieve(
        testCase.question,
        { companyId: ${JSON.stringify(companyId)} },
        { finalTopK: 5, rerankedTopK: 5, enableReranking: false },
      );
      const second = await hybridRetrieve(
        testCase.question,
        { companyId: ${JSON.stringify(companyId)} },
        { finalTopK: 5, rerankedTopK: 5, enableReranking: false },
      );

      const firstTopChunkIds = first.chunks.map((chunk) => chunk.id);
      const secondTopChunkIds = second.chunks.map((chunk) => chunk.id);
      const recallAt5 = computeRecallAtK(testCase.expectedChunkIds, first.chunks, 5);
      const mrr = computeMRR(testCase.expectedChunkIds, first.chunks);
      const stableTopFive = JSON.stringify(firstTopChunkIds) === JSON.stringify(secondTopChunkIds);
      const gatePass = Boolean(first.gatePass && second.gatePass);

      summaries.push({
        id: testCase.id,
        question: testCase.question,
        recallAt5: Number(recallAt5.toFixed(4)),
        mrr: Number(mrr.toFixed(4)),
        gatePass,
        stableTopFive,
        topChunkIds: firstTopChunkIds,
        secondRunTopChunkIds: secondTopChunkIds,
      });
    }

    const avgRecallAt5 = summaries.reduce((sum, item) => sum + item.recallAt5, 0) / summaries.length;
    const avgMRR = summaries.reduce((sum, item) => sum + item.mrr, 0) / summaries.length;
    const pass = summaries.every((item) => item.gatePass && item.stableTopFive && item.recallAt5 >= 1.0 && item.mrr >= 1.0);

    console.log('[RETRIEVAL-LIVE-SUMMARY] ' + JSON.stringify({
      totalCases: summaries.length,
      avgRecallAt5: Number(avgRecallAt5.toFixed(4)),
      avgMRR: Number(avgMRR.toFixed(4)),
      pass,
      summaries,
    }));

    if (!pass) process.exit(1);
  `;
}

function resolveTsxInvocation() {
  const home = process.env.HOME || '';
  const cachedLoader = `${home}/.npm/_npx/fd45a72a545557e9/node_modules/tsx/dist/loader.mjs`;

  if (home && existsSync(cachedLoader)) {
    return {
      cmd: process.execPath,
      args: ['--import', cachedLoader, '--eval', buildEvalSource()],
    };
  }

  return {
    cmd: 'npx',
    args: ['tsx', '--eval', buildEvalSource()],
  };
}

async function main() {
  if (!shouldRun) {
    console.log('[RETRIEVAL-LIVE-SUMMARY] ' + JSON.stringify({
      skipped: true,
      reason: 'Missing retrieval credentials or RUN_RETRIEVAL_EVAL != 1',
    }));
    return;
  }

  const invocation = resolveTsxInvocation();
  const { stdout, stderr } = await execFileAsync(invocation.cmd, invocation.args, {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 1024 * 1024 * 8,
  });

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

main().catch((error) => {
  console.error(`[RETRIEVAL-LIVE-ERROR] ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
