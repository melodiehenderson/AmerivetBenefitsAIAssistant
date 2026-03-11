// fetch-doc-answer.ts
// Utility to fetch expected answers from documentation URLs for unit tests
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

export async function fetchDocAnswer(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch: ${url}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  // Extract all visible text from the page
  const mainText = $('body').text().replace(/\s+/g, ' ').trim();
  return mainText;
}

if (require.main === module) {
  const url = process.argv[2];
  fetchDocAnswer(url).then(text => {
    console.log(text.slice(0, 2000)); // Print first 2000 chars for review
  }).catch(console.error);
}
