const fs = require('fs');
const path = require('path');

const sourceDir = path.join(__dirname, '../../supabase/migrations');
const destDir = path.join(__dirname, '../migrations');

// 1. Ensure destDir exists and clear it
if (fs.existsSync(destDir)) {
  fs.rmSync(destDir, { recursive: true, force: true });
}
fs.mkdirSync(destDir, { recursive: true });

// 2. Read all files from sourceDir
const allFiles = fs.readdirSync(sourceDir);
const sqlFiles = allFiles.filter(f => f.endsWith('.sql'));

// 3. Sort files alphabetically (ASCII sort, which Supabase uses)
sqlFiles.sort();

const migrations = sqlFiles.map((file, index) => {
  // 4. Copy each file
  fs.copyFileSync(path.join(sourceDir, file), path.join(destDir, file));
  
  return {
    order: index + 1,
    file: file,
    name: file.replace('.sql', '')
  };
});

// 5. Write migrations.json
const manifest = {
  version: new Date().toISOString().split('T')[0].replace(/-/g, '.'),
  generated: new Date().toISOString(),
  totalFiles: sqlFiles.length,
  migrations: migrations
};

fs.writeFileSync(
  path.join(destDir, 'migrations.json'),
  JSON.stringify(manifest, null, 2)
);

console.log(`Successfully synced ${sqlFiles.length} migrations to ${destDir}`);
console.log('Manifest written to migrations.json');
