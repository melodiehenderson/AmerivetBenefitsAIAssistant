import OpenAI from 'openai';

const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
const key = process.env.AZURE_OPENAI_API_KEY;
const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview';

if (!endpoint || !key) {
  console.log('Missing AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_API_KEY');
  process.exit(1);
}

const names = [
  'gpt-4.1-mini',
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4.1',
  'gpt-35-turbo',
  'gpt-4',
];

const client = new OpenAI({
  apiKey: key,
  baseURL: endpoint.replace(/\/$/, '') + '/openai/deployments',
  defaultQuery: { 'api-version': apiVersion },
  defaultHeaders: { 'api-key': key },
});

for (const name of names) {
  try {
    await client.chat.completions.create({
      model: name,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
      temperature: 0,
    });
    console.log(`${name}: OK`);
  } catch (e) {
    const status = e?.status ?? e?.error?.code ?? 'ERR';
    const msg = (e?.error?.message ?? e?.message ?? 'error').toString();
    console.log(`${name}: ${status} - ${msg.slice(0, 140)}`);
  }
}
