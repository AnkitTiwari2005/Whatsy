// Fails (exit 1) if the committed dist/ differs from a fresh build of src/. Run in CI / pre-commit:  npm run verify:dist
const { execSync } = require('child_process'); const fs = require('fs'); const path = require('path'); const os = require('os');
const root = path.join(__dirname, '..'); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsy-dist-'));
execSync(`npx tsc --outDir "${tmp}"`, { cwd: root, stdio: 'inherit' });
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const bad = [];
for (const f of walk(tmp).filter((f) => f.endsWith('.js'))) { const rel = path.relative(tmp, f); const cur = path.join(root, 'dist', rel); if (!fs.existsSync(cur) || fs.readFileSync(cur, 'utf8') !== fs.readFileSync(f, 'utf8')) bad.push(rel); }
for (const [a, b] of [['src/db/schema.sql', 'dist/db/schema.sql']]) if (!fs.existsSync(path.join(root, b)) || fs.readFileSync(path.join(root, a), 'utf8') !== fs.readFileSync(path.join(root, b), 'utf8')) bad.push(b);
for (const f of walk(path.join(root, 'src/admin-ui'))) { const rel = path.relative(path.join(root, 'src'), f); const cur = path.join(root, 'dist', rel); if (!fs.existsSync(cur) || !fs.readFileSync(cur).equals(fs.readFileSync(f))) bad.push('dist/' + rel); }
fs.rmSync(tmp, { recursive: true, force: true });
if (bad.length) { console.error('dist/ is STALE. Run `npm run build:local` and commit dist/. Differing files:\n  ' + bad.join('\n  ')); process.exit(1); }
console.log('dist/ is up to date.');
