#!/usr/bin/env node
/*
  Replace symlinked function directories in .vercel/output/functions with real folders.
  This prevents ENOENT on Vercel prebuilt deploys when symlinks don’t round-trip.
*/

import fs from 'fs';
import path from 'path';

const functionsRoot = path.join('.vercel', 'output', 'functions');

function isSymlink(p) {
  try {
    const st = fs.lstatSync(p);
    return st.isSymbolicLink();
  } catch {
    return false;
  }
}

function fixDirSymlink(linkPath) {
  try {
    const target = fs.readlinkSync(linkPath);
    const targetPath = path.isAbsolute(target)
      ? target
      : path.resolve(path.dirname(linkPath), target);

    // Copy contents from target into a temp folder, remove the symlink, then replace
    const tempPath = linkPath + '.physical';
    fs.rmSync(tempPath, { recursive: true, force: true });
    fs.mkdirSync(tempPath, { recursive: true });
    // Node >=16 supports fs.cpSync
    fs.cpSync(targetPath, tempPath, { recursive: true, force: true });
    fs.rmSync(linkPath, { recursive: true, force: true });
    fs.renameSync(tempPath, linkPath);
    return true;
  } catch (e) {
    console.error(`[fix-vercel-symlinks] Failed to fix symlink: ${linkPath}`, e?.message || e);
    return false;
  }
}

function walkAndFix(root) {
  let fixed = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        // Normalize any *.func directory by recreating physically (dereference contents)
        if (ent.name.endsWith('.func')) {
          try {
            const tempPath = full + '.physical';
            fs.rmSync(tempPath, { recursive: true, force: true });
            fs.mkdirSync(path.dirname(tempPath), { recursive: true });
            fs.cpSync(full, tempPath, { recursive: true, force: true, dereference: true });
            fs.rmSync(full, { recursive: true, force: true });
            fs.renameSync(tempPath, full);
            fixed++;
          } catch {}
        } else {
          stack.push(full);
        }
      } else {
        // Attempt to inline file symlinks as normal files if readlink works
        try {
          const target = fs.readlinkSync(full);
          const targetPath = path.isAbsolute(target)
            ? target
            : path.resolve(path.dirname(full), target);
          const content = fs.readFileSync(targetPath);
          fs.rmSync(full, { force: true });
          fs.writeFileSync(full, content);
          fixed++;
        } catch {}
      }
    }
  }
  return fixed;
}

if (!fs.existsSync(functionsRoot)) {
  console.log('[fix-vercel-symlinks] No functions directory found; skipping');
  process.exit(0);
}

// Strategy A: rebuild a physical copy of the functions tree entry-by-entry with dereference
try {
  const physicalRoot = functionsRoot + '-physical';
  fs.rmSync(physicalRoot, { recursive: true, force: true });
  fs.mkdirSync(physicalRoot, { recursive: true });
  for (const ent of fs.readdirSync(functionsRoot, { withFileTypes: true })) {
    const src = path.join(functionsRoot, ent.name);
    const dst = path.join(physicalRoot, ent.name);
    fs.cpSync(src, dst, { recursive: true, force: true, dereference: true });
  }
  fs.rmSync(functionsRoot, { recursive: true, force: true });
  fs.renameSync(physicalRoot, functionsRoot);
  console.log('[fix-vercel-symlinks] Recreated functions directory (dereferenced).');
} catch (e) {
  console.warn('[fix-vercel-symlinks] Directory rebuild failed; falling back to in-place walk.', e?.message || e);
  const count = walkAndFix(functionsRoot);
  console.log(`[fix-vercel-symlinks] Replaced ${count} symlink(s) in ${functionsRoot}`);
}
