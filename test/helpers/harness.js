'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..');
const ADMIN_KEY = 'test-admin-key-0123456789abcdef';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Boot the compiled app (dist/index.js) as a child process with the fake WhatsApp transport. */
async function startServer({ env = {}, dataDir, port = 3111, ctlPort = 3999 } = {}) {
  dataDir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'whatsy-test-'));
  const isWin = process.platform === 'win32';
  const child = spawn(process.execPath, ['--no-warnings', '-r', path.join(__dirname, 'preload.js'), 'dist/index.js'], {
    cwd: ROOT, detached: !isWin, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), WA_CTL_PORT: String(ctlPort), ADMIN_KEY, DATA_DIR: dataDir, NODE_ENV: 'production',
      MESSAGE_DELAY_MIN_MS: '100', MESSAGE_DELAY_MAX_MS: '150', LOG_LEVEL: 'warn', ...env },
  });
  const s = { child, dataDir, port, ctlPort, log: '', base: `http://127.0.0.1:${port}` };
  child.stdout.on('data', (d) => (s.log += d)); child.stderr.on('data', (d) => (s.log += d));
  s.exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
  let dead = false; s.exited.then(() => { dead = true; });
  for (let i = 0; i < 60 && !dead; i++) { try { const r = await fetch(s.base + '/api/v1/status'); if ((await r.json()).whatsapp === 'connected') break; } catch (_) {} await sleep(150); }
  s.alive = async () => { if (dead) return false; try { return (await fetch(s.base + '/health', { signal: AbortSignal.timeout(1500) })).status < 500; } catch (_) { return false; } };
  s.kill = async () => {
    try {
      if (isWin) {
        child.kill();
        try { require('child_process').execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' }); } catch (_) {}
      } else {
        process.kill(-child.pid, 'SIGKILL');
      }
    } catch (_) {}
    await sleep(150);
  };
  s.ctl = async (p) => (await fetch(`http://127.0.0.1:${ctlPort}${p}`)).json();
  s.req = async (method, p, { headers = {}, body, raw } = {}) => {
    const h = { ...headers }; let b = raw;
    if (body !== undefined) { h['Content-Type'] = h['Content-Type'] || 'application/json'; b = JSON.stringify(body); }
    const r = await fetch(s.base + p, { method, headers: h, body: b }); const text = await r.text(); let json; try { json = JSON.parse(text); } catch (_) {}
    return { status: r.status, json, text, headers: r.headers };
  };
  s.admin = (m, p, body) => s.req(m, p, { headers: { 'X-Admin-Key': ADMIN_KEY }, body });
  s.project = async (name, extra = {}) => (await s.admin('POST', '/admin/projects', { name, ...extra })).json;
  s.sentTexts = async () => (await s.ctl('/sent')).sent;
  return s;
}
module.exports = { startServer, sleep, ADMIN_KEY, ROOT };
