// Copies non-TypeScript runtime assets into dist/ (schema + admin UI folder). Wipes stale UI files first.
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'dist/db'), { recursive: true });
fs.copyFileSync(path.join(root, 'src/db/schema.sql'), path.join(root, 'dist/db/schema.sql'));
fs.rmSync(path.join(root, 'dist/admin-ui'), { recursive: true, force: true });
fs.cpSync(path.join(root, 'src/admin-ui'), path.join(root, 'dist/admin-ui'), { recursive: true });
console.log('Assets copied.');
