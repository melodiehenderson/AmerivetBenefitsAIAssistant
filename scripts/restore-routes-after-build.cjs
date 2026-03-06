const fs = require('fs');
const path = require('path');

console.log('🔧 Restoring admin routes after build...');

const routesToRestore = [
  'app/api/admin/benefit-plans/route.ts',
  'app/api/admin/benefit-plans/[id]/route.ts',
  'app/api/admin/analytics/chat/route.ts',
  'app/api/admin/analytics/llm-routing/route.ts',
  'app/api/admin/analytics/route.ts'
];

routesToRestore.forEach(route => {
  const fullPath = path.join(process.cwd(), route);
  const backupPath = `${fullPath}.buildbackup`;
  
  if (fs.existsSync(backupPath)) {
    // Restore original
    fs.copyFileSync(backupPath, fullPath);
    fs.unlinkSync(backupPath);
    console.log(`✅ Restored: ${route}`);
  }
});

console.log('✅ All routes restored');
