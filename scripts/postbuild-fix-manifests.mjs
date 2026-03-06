import fs from 'node:fs';
import path from 'node:path';

const targets = [
  '.next/server/app/(chat)/page_client-reference-manifest.js',
];

try {
  // Fix 1: Create missing manifest stubs
  for (const t of targets) {
    try {
      const abs = path.resolve(process.cwd(), t);
      const dir = path.dirname(abs);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (!fs.existsSync(abs)) {
        fs.writeFileSync(abs, 'export default {};', 'utf8');
        console.log('[postbuild] created stub:', t);
      } else {
        console.log('[postbuild] exists:', t);
      }
    } catch (e) {
      console.warn('[postbuild] warning for', t, ':', e.message);
      // Continue - don't fail the build on postbuild errors
    }
  }

  // Fix 2: Handle 500.html export issue (standalone output doesn't need it)
  const exportDir = path.resolve(process.cwd(), '.next/export');
  const export500 = path.join(exportDir, '500.html');
  if (fs.existsSync(export500)) {
    try {
      fs.unlinkSync(export500);
      console.log('[postbuild] removed .next/export/500.html (not needed for standalone)');
    } catch (e) {
      console.warn('[postbuild] could not remove 500.html:', e.message);
    }
  }
  
  // Also remove the entire export directory if it exists (standalone doesn't use it)
  if (fs.existsSync(exportDir)) {
    try {
      fs.rmSync(exportDir, { recursive: true, force: true });
      console.log('[postbuild] removed .next/export directory (standalone output)');
    } catch (e) {
      console.warn('[postbuild] could not remove export dir:', e.message);
    }
  }
  
} catch (e) {
  console.error('[postbuild] fatal error:', e.message);
  process.exit(1);
}
