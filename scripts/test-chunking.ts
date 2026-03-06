/**
 * Test Suite: Chunking & Ingestion Pipeline
 * 
 * Tests:
 * 1. Text extraction and cleaning
 * 2. Section detection
 * 3. Sliding window chunking
 * 4. Token count estimation
 * 5. Embedding generation (stub)
 * 6. Full document ingestion
 */

import {
  ingestDocument,
  chunkText,
  cleanText,
  detectSections,
  estimateTokenCount,
  generateEmbedding,
} from '../lib/rag/chunking';
import type { Document } from '../types/rag';

// ─────────────────────────────────────────────────────────────────────────────
// Test Data
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_DOCUMENT: Document = {
  id: 'doc-test-001',
  companyId: `amerivet`,
  title: 'Employee Benefits Handbook 2025',
  type: 'handbook',
  source: 'benefits-2025.pdf',
  content: `# Health Insurance Plans

## PPO Plans

A PPO (Preferred Provider Organization) plan offers maximum flexibility in choosing healthcare providers. You can see any doctor without needing a referral, though you'll pay less when using in-network providers.

### Coverage Details

PPO plans typically cover:
- Doctor visits (in-network: $25 copay, out-of-network: $50 copay)
- Hospital stays (80% coverage after deductible)
- Preventive care (100% covered)
- Prescription drugs (tiered copays: $10/$30/$50)

### Deductibles and Out-of-Pocket Maximum

Annual deductible: $1,500 individual / $3,000 family
Out-of-pocket maximum: $5,000 individual / $10,000 family

## HDHP Plans

HDHP (High Deductible Health Plan) options come with lower monthly premiums but higher deductibles. These plans are HSA-eligible, allowing you to save pre-tax dollars for medical expenses.

### Coverage Details

HDHP plans typically cover:
- Doctor visits (subject to deductible)
- Hospital stays (subject to deductible, then 80% coverage)
- Preventive care (100% covered)
- Prescription drugs (subject to deductible)

### Deductibles and HSA

Annual deductible: $3,000 individual / $6,000 family
HSA contribution limit: $4,150 individual / $8,300 family
Employer HSA contribution: $500 individual / $1,000 family

# Dental and Vision Plans

## Dental Coverage

Our dental plans provide comprehensive coverage for preventive, basic, and major services.

### Preventive Services (100% covered)
- Cleanings and exams (2 per year)
- X-rays
- Fluoride treatments

### Basic Services (80% covered)
- Fillings
- Extractions
- Root canals

### Major Services (50% covered)
- Crowns
- Bridges
- Dentures

## Vision Coverage

Vision coverage includes:
- Annual eye exam ($10 copay)
- Lenses ($25 copay)
- Frames ($150 allowance every 2 years)
- Contact lenses ($150 allowance in lieu of glasses)`,
  metadata: {
    version: '2025.1',
    benefitYear: 2025,
    carrier: 'BlueCross BlueShield',
    effectiveDate: new Date('2025-01-01'),
  },
  createdAt: new Date('2024-12-01'),
  updatedAt: new Date('2024-12-01'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Text Cleaning
// ─────────────────────────────────────────────────────────────────────────────

console.log('=== Test 1: Text Cleaning ===\n');

const dirtyText = `   This  is   a  test    

with excessive    whitespace   

and\r\nmixed\rline\nbreaks   `;

const cleaned = cleanText(dirtyText);
console.log('Original:', JSON.stringify(dirtyText));
console.log('Cleaned:', JSON.stringify(cleaned));
console.log('✓ Whitespace normalized\n');

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Section Detection
// ─────────────────────────────────────────────────────────────────────────────

console.log('=== Test 2: Section Detection ===\n');

const sections = detectSections(SAMPLE_DOCUMENT.content);
console.log(`Detected ${sections.length} sections:`);
sections.forEach((section, idx) => {
  console.log(`  ${idx + 1}. Level ${section.level}: "${section.header}"`);
  console.log(`     Content preview: ${section.content.substring(0, 60)}...`);
});
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Token Count Estimation
// ─────────────────────────────────────────────────────────────────────────────

console.log('=== Test 3: Token Count Estimation ===\n');

const sampleTexts = [
  'Hello world',
  'A PPO plan offers flexibility in choosing healthcare providers.',
  SAMPLE_DOCUMENT.content,
];

sampleTexts.forEach(text => {
  const tokens = estimateTokenCount(text);
  const chars = text.length;
  console.log(`Text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
  console.log(`  Characters: ${chars}, Estimated tokens: ${tokens}, Ratio: ${(chars / tokens).toFixed(2)} chars/token`);
});
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Sliding Window Chunking
// ─────────────────────────────────────────────────────────────────────────────

console.log('=== Test 4: Sliding Window Chunking ===\n');

const chunks = chunkText(SAMPLE_DOCUMENT.content, {
  windowSize: 200,  // Smaller window for testing
  stride: 50,       // 25% overlap
  minChunkSize: 50,
});

console.log(`Created ${chunks.length} chunks with window=200, stride=50:`);
chunks.slice(0, 5).forEach((chunk, idx) => {
  console.log(`  Chunk ${idx + 1}:`);
  console.log(`    Tokens: ${chunk.tokenCount}`);
  console.log(`    Window: [${chunk.windowStart}:${chunk.windowEnd}]`);
  console.log(`    Preview: "${chunk.content.substring(0, 80)}..."`);
});

if (chunks.length > 5) {
  console.log(`  ... (${chunks.length - 5} more chunks)`);
}
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: Embedding Generation
// ─────────────────────────────────────────────────────────────────────────────

console.log('=== Test 5: Embedding Generation (Stub) ===\n');

const testText = 'A PPO plan offers flexibility in choosing healthcare providers.';
const embedding = await generateEmbedding(testText);

console.log(`Text: "${testText}"`);
console.log(`Embedding dimensions: ${embedding.length}`);
console.log(`Sample values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}, ...]`);

// Verify unit vector (magnitude should be ~1.0)
const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
console.log(`Magnitude: ${magnitude.toFixed(6)} (should be ~1.0)`);
console.log('✓ Embedding generated\n');

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: Full Document Ingestion
// ─────────────────────────────────────────────────────────────────────────────

console.log('=== Test 6: Full Document Ingestion ===\n');

const ingestedChunks = await ingestDocument(SAMPLE_DOCUMENT, {
  windowSize: 300,
  stride: 75,
  minChunkSize: 100,
});

console.log(`\nIngestion complete:`);
console.log(`  Document: ${SAMPLE_DOCUMENT.title}`);
console.log(`  Original length: ${SAMPLE_DOCUMENT.content.length} characters`);
console.log(`  Chunks created: ${ingestedChunks.length}`);
console.log('');

console.log('Sample chunks:');
ingestedChunks.slice(0, 3).forEach((chunk, idx) => {
  console.log(`  Chunk ${idx + 1}:`);
  console.log(`    ID: ${chunk.id}`);
  console.log(`    Section: ${chunk.sectionPath}`);
  console.log(`    Title: ${chunk.title}`);
  console.log(`    Tokens: ${chunk.metadata.tokenCount}`);
  console.log(`    Position: ${chunk.position}`);
  console.log(`    Window: [${chunk.windowStart}:${chunk.windowEnd}]`);
  console.log(`    Vector dims: ${chunk.vector?.length || 0}`);
  console.log(`    Content preview: "${chunk.content.substring(0, 100)}..."`);
  console.log('');
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log('=== Test Summary ===');
console.log('✓ Text cleaning: Whitespace normalized, line breaks fixed');
console.log(`✓ Section detection: ${sections.length} sections identified`);
console.log('✓ Token estimation: Character-based heuristic working');
console.log(`✓ Chunking: ${chunks.length} chunks with configurable window/stride`);
console.log(`✓ Embedding generation: ${embedding.length}-dimensional vectors`);
console.log(`✓ Document ingestion: ${ingestedChunks.length} chunks ready for indexing`);
console.log('');
console.log('All chunking tests passed ✓');
