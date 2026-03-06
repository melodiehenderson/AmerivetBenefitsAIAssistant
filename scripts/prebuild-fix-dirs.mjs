import fs from 'node:fs';
import path from 'node:path';

console.log('[prebuild] Preparing Next.js build directories...');

try {
  // Ensure .next/server/pages directory exists to prevent 500.html move error
  const serverPagesDir = path.resolve(process.cwd(), '.next/server/pages');
  if (!fs.existsSync(serverPagesDir)) {
    fs.mkdirSync(serverPagesDir, { recursive: true });
    console.log('[prebuild] Created .next/server/pages directory');
  }

  // Create dummy export directory with 500.html to prevent move error
  const exportDir = path.resolve(process.cwd(), '.next/export');
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }
  
  const export500Path = path.join(exportDir, '500.html');
  if (!fs.existsSync(export500Path)) {
    fs.writeFileSync(export500Path, '<!DOCTYPE html><html><body>500 Error</body></html>', 'utf8');
    console.log('[prebuild] Created dummy .next/export/500.html');
  }

  console.log('[prebuild] Build directories ready');
} catch (e) {
  console.warn('[prebuild] Warning:', e.message);
  // Don't fail the build on prebuild errors
}
