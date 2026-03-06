#!/usr/bin/env node
// Simple RAG validation runner: executes a few scripted checks and summarizes results.
import { spawn } from 'node:child_process';

const tasks = [
  { name: 'test-retrieval', cmd: ['node', 'test-retrieval.mjs'] },
  { name: 'test-embeddings', cmd: ['node', 'test-embeddings.mjs'] },
  // Optional: direct Azure Search probe (enable via env VALIDATE_LIVE=1)
  ...(process.env.VALIDATE_LIVE ? [{ name: 'test-azure-search-direct', cmd: ['node', 'test-azure-search-direct.mjs'] }] : []),
];

function runTask({ name, cmd }) {
  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', shell: false });
    child.on('exit', (code) => resolve({ name, code: code ?? 1 }));
    child.on('error', () => resolve({ name, code: 1 }));
  });
}

async function main() {
  console.log('RAG validation: starting...');
  const results = [];
  for (const task of tasks) {
    console.log(`\n— Running ${task.name} —`);
    results.push(await runTask(task));
  }
  const failed = results.filter(r => r.code !== 0);
  console.log('\nSummary:');
  for (const r of results) {
    console.log(`  ${r.code === 0 ? 'PASS' : 'FAIL'} ${r.name}`);
  }
  if (failed.length) {
    console.error(`\nRAG validation failed: ${failed.length}/${results.length} tasks.`);
    process.exit(1);
  } else {
    console.log(`\nRAG validation passed: ${results.length}/${results.length} tasks.`);
  }
}

main().catch((err) => {
  console.error('RAG validation crashed:', err);
  process.exit(1);
});
