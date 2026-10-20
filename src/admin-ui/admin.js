/* Whatsy admin console. No inline handlers, no external requests (CSP: script-src 'self'). */
(function () {
'use strict';
var $ = function (s, r) { return (r || document).querySelector(s); };
var view = $('#view');

/* ───────── helpers ───────── */
var ICONS = {
  grid:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
  lock:'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  code:'<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  phone:'<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  folder:'<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  menu:'<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  eye:'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff:'<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>',
  check:'<polyline points="20 6 9 17 4 12"/>', x:'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  info:'<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  warn:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  refresh:'<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  copy:'<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  send:'<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>', key:'<path d="M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3"/>',
  inbox:'<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/>'
};
function ic(n, extra) { return '<svg class="i ' + (extra || '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (ICONS[n] || '') + '</svg>'; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function uuid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function parseTs(iso) { if (!iso) return NaN; var t = Date.parse(iso); return t; }
function rel(iso) {
  var t = parseTs(iso); if (isNaN(t)) return '—';
  var s = Math.round((Date.now() - t) / 1000);
  if (s < 5) return 'just now'; if (s < 60) return s + 's ago'; if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'; if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return new Date(t).toLocaleDateString();
}
function absTime(iso) { var t = parseTs(iso); return isNaN(t) ? '' : new Date(t).toLocaleString(); }
function timeTag(iso) { return iso ? '<time datetime="' + esc(iso) + '" title="' + esc(absTime(iso)) + '">' + esc(rel(iso)) + '</time>' : '—'; }
function dur(s) { s = Math.max(0, s | 0); var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m ? m + 'm' : s + 's'; }
function badge(status) { var c = { sent: 'ok', queued: 'warn', failed: 'bad', active: 'ok', inactive: '' }[status] || ''; return '<span class="badge ' + c + '">' + esc(status) + '</span>'; }
function setBusy(btn, on) { if (!btn) return; if (on) { btn.setAttribute('aria-busy', 'true'); btn.disabled = true; } else { btn.removeAttribute('aria-busy'); btn.disabled = false; } }

function copy(text, label) {
  function done(ok) { toast(ok ? (label || 'Copied to clipboard') : 'Copy failed — select the text and copy manually', ok ? 'ok' : 'bad'); }
  if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(); }); } else fallback();
  function fallback() { try { var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0'; document.body.appendChild(ta); ta.select(); var ok = document.execCommand('copy'); ta.remove(); done(ok); } catch (e) { done(false); } }
}

/* ───────── toasts ───────── */
function toast(msg, kind) {
  var el = document.createElement('div'); el.className = 'toast ' + (kind || '');
  el.innerHTML = ic(kind === 'ok' ? 'check' : kind === 'bad' ? 'x' : 'info') + '<span>' + esc(msg) + '</span>';
  var box = $('#toasts'); box.appendChild(el); while (box.children.length > 4) box.firstChild.remove();
  setTimeout(function () { el.remove(); }, kind === 'bad' ? 7000 : 4000);
}

/* ───────── modal (focus trap, Esc, focus restore, role=dialog) ───────── */
var modalOpen = null;
function dialog(o) {
  return new Promise(function (resolve) {
    var prev = document.activeElement, root = $('#modal-root'), id = 'dlg' + Date.now();
    var wrap = document.createElement('div'); wrap.className = 'modal';
    wrap.innerHTML = '<div class="dialog ' + (o.wide ? 'wide' : '') + '" role="' + (o.alert ? 'alertdialog' : 'dialog') + '" aria-modal="true" aria-labelledby="' + id + 't" aria-describedby="' + id + 'b">' +
      '<h2 id="' + id + 't">' + esc(o.title) + '</h2><div class="bd" id="' + id + 'b">' + (o.html || '') + '</div><div class="ft">' +
      (o.hideCancel ? '' : '<button class="btn gh" type="button" data-d="cancel">' + esc(o.cancelLabel || 'Cancel') + '</button>') +
      '<button class="btn ' + (o.danger ? 'd' : 'p') + '" type="button" data-d="ok">' + esc(o.okLabel || 'Confirm') + '</button></div></div>';
    root.appendChild(wrap); document.body.style.overflow = 'hidden';
    var box = wrap.firstChild;
    function close(val) { document.removeEventListener('keydown', onKey, true); wrap.remove(); modalOpen = null; if (!root.children.length) document.body.style.overflow = ''; if (prev && prev.focus) try { prev.focus(); } catch (e) {} resolve(val); }
    function collect() { var out = {}; wrap.querySelectorAll('[data-field]').forEach(function (f) { out[f.getAttribute('data-field')] = f.type === 'checkbox' ? f.checked : f.value; }); return out; }
    function ok() { if (o.validate) { var err = o.validate(collect()); if (err) { var h = wrap.querySelector('[data-err]'); if (h) { h.textContent = err; h.hidden = false; } return; } } close(o.fields ? collect() : true); }
    function onKey(e) {
      if (e.key === 'Escape' && !o.persistent) { e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); ok(); }
      else if (e.key === 'Tab') { var f = box.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'); if (!f.length) return; var a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
    }
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('mousedown', function (e) { if (e.target === wrap && !o.persistent) close(null); });
    wrap.addEventListener('click', function (e) { var b = e.target.closest('[data-d]'); if (!b) return; if (b.getAttribute('data-d') === 'ok') ok(); else close(null); var c = e.target.closest('[data-copy]'); });
    wrap.addEventListener('click', function (e) { var c = e.target.closest('[data-copy]'); if (c) copy(c.getAttribute('data-copy'), 'Copied'); });
    modalOpen = { close: close };
    var first = box.querySelector('[data-field]') || box.querySelector('[data-d=ok]'); if (first) first.focus();
    if (o.onOpen) o.onOpen(box);
  });
}

/* ───────── api ───────── */
var KEY = sessionStorage.getItem('whatsy_admin') || '';
function ApiError(status, code, message, extra) { this.status = status; this.code = code; this.message = message; this.extra = extra || {}; }
ApiError.prototype = Object.create(Error.prototype);
function api(method, path, body, opt) {
  opt = opt || {};
  var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, opt.timeout || 15000);
  var headers = { Accept: 'application/json' };
  if (opt.apiKey) headers['X-Api-Key'] = opt.apiKey; else headers['X-Admin-Key'] = KEY;
  if (opt.headers) Object.keys(opt.headers).forEach(function (k) { headers[k] = opt.headers[k]; });
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(path, { method: method, headers: headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctl.signal, cache: 'no-store' })
    .then(function (r) {
      clearTimeout(timer);
      return r.text().then(function (t) {
        var d = null; try { d = t ? JSON.parse(t) : {}; } catch (e) { }
        if (d === null) throw new ApiError(r.status, 'bad_response', 'The server sent an unexpected response (HTTP ' + r.status + '). A proxy or the server may be restarting — try again in a moment.');
        if (!r.ok) {
          if (r.status === 401 && !opt.apiKey && !opt.noAuthRedirect) { signOut('Your session is no longer valid. Please sign in again.'); }
          var msg = d.error || 'Request failed (HTTP ' + r.status + ')';
          if (r.status === 429) { var w = d.retry_after_seconds || Number(r.headers.get('Retry-After')) || 0; if (w) msg += w >= 90 ? ' Try again in ' + Math.ceil(w / 60) + ' min.' : ' Try again in ' + w + 's.'; }
          if (r.status >= 500 && d.request_id) msg += ' (ref ' + String(d.request_id).slice(0, 8) + ')';
          throw new ApiError(r.status, d.code || 'error', msg, d);
        }
        return d;
      });
    }, function (e) {
      clearTimeout(timer);
      throw new ApiError(0, e.name === 'AbortError' ? 'timeout' : 'network', e.name === 'AbortError' ? 'The server took too long to respond.' : 'Cannot reach the server. Check your connection.');
    });
}
function errBox(e, retryAct) { return '<div class="alert bad" role="alert">' + ic('warn') + '<span>' + esc(e.message || e) + '</span>' + (retryAct ? '<button class="btn sm gh" type="button" data-act="' + retryAct + '" style="margin-left:auto">Retry</button>' : '') + '</div>'; }

/* ───────── auth ───────── */
var loginEl = $('#login'), appEl = $('#app');
function showApp() { loginEl.hidden = true; appEl.hidden = false; startPolling(); route(); }
function signOut(msg) {
  KEY = ''; sessionStorage.removeItem('whatsy_admin'); stopPolling(); clearPage();
  if (modalOpen) modalOpen.close(null);
  appEl.hidden = true; loginEl.hidden = false; $('#lk').value = ''; $('#lk-err').textContent = msg || ''; $('#lk').focus();
}
function setEye(on) { var b = $('#lk-eye'), i = $('#lk'); i.type = on ? 'text' : 'password'; b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? 'Hide admin key' : 'Show admin key'); b.innerHTML = ic(on ? 'eyeoff' : 'eye'); }
function doLogin() {
  var k = $('#lk').value.trim(), btn = $('#lk-go'), err = $('#lk-err');
  if (!k) { err.textContent = 'Enter your admin key.'; $('#lk').setAttribute('aria-invalid', 'true'); return; }
  $('#lk').removeAttribute('aria-invalid'); err.textContent = ''; setBusy(btn, true);
  var prev = KEY; KEY = k;
  api('GET', '/admin/pair/status', undefined, { noAuthRedirect: true }).then(function (d) {
    sessionStorage.setItem('whatsy_admin', k); S = norm(d); showApp();
  }).catch(function (e) {
    KEY = prev;
    err.textContent = e.status === 401 ? 'That admin key is not valid.' : e.message;
    $('#lk').setAttribute('aria-invalid', 'true');
  }).then(function () { setBusy(btn, false); });
}

/* ───────── status polling (pauses when tab hidden, backs off when offline) ───────── */
var S = { status: 'connecting', offline: false, registered: true, queue_length: 0, uptime_seconds: 0 }, pollTimer = null, pollFails = 0, lastOk = 0;
function norm(d) { d.offline = false; return d; }
function startPolling() { stopPolling(); pollNow(); }
function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }
function pollNow() {
  clearTimeout(pollTimer);
  if (!KEY) return;
  if (document.hidden) { pollTimer = setTimeout(pollNow, 3000); return; }
  api('GET', '/admin/pair/status', undefined, { timeout: 8000 }).then(function (d) { pollFails = 0; lastOk = Date.now(); S = norm(d); }, function (e) {
    pollFails++; if (pollFails >= 2) S.offline = true; if (e.code === 'timeout' || e.code === 'network') S.offlineReason = e.message;
  }).then(function () { paintStatus(); if (page && page.onStatus) page.onStatus(); pollTimer = setTimeout(pollNow, S.offline ? Math.min(15000, 3000 * pollFails) : 5000); });
}
document.addEventListener('visibilitychange', function () { if (!document.hidden && KEY) pollNow(); });
window.addEventListener('online', function () { if (KEY) pollNow(); });
window.addEventListener('offline', function () { S.offline = true; paintStatus(); });
function paintStatus() {
  var st = S.offline ? 'offline' : S.status, label = { connected: 'Connected', connecting: 'Connecting', disconnected: 'Disconnected', offline: 'Server unreachable' }[st] || st;
  var sub = S.offline ? 'Retrying…' : S.status === 'connected' ? 'Up ' + dur(S.uptime_seconds) : !S.registered ? 'Not paired yet' : S.status === 'connecting' ? 'Reconnecting…' : 'Will retry automatically';
  $('#conn-dot').className = 'dot ' + st; $('#top-dot').className = 'dot ' + st; $('#conn-l').textContent = label; $('#conn-s').textContent = sub;
  $('#top-dot').title = 'WhatsApp: ' + label;
  var b = $('#banner'); if (b) b.innerHTML = bannerHtml();
}
function bannerHtml() {
  if (S.offline) return '<div class="banner err" role="alert">' + ic('warn') + '<span class="grow">Cannot reach the Whatsy server. Data on screen may be out of date' + (lastOk ? ' (last update ' + rel(new Date(lastOk).toISOString()) + ')' : '') + '. Retrying automatically.</span></div>';
  if (!S.registered && S.status !== 'connected') return '<div class="banner">' + ic('phone') + '<span class="grow">WhatsApp is not paired yet — messages will queue until you link a number.</span><a class="btn sm" href="#/pair">Pair now</a></div>';
  if (S.status === 'disconnected' || S.status === 'connecting') return '<div class="banner">' + ic('warn') + '<span class="grow">WhatsApp is ' + esc(S.status) + '. New messages are queued and sent when it reconnects' + (S.queue_length ? ' (' + S.queue_length + ' waiting)' : '') + '.</span></div>';
  return '';
}

/* ───────── router ───────── */
var NAV = [['overview', 'Overview', 'grid'], ['otp', 'OTP tester', 'lock'], ['docs', 'API & connect', 'code'], ['pair', 'Pair WhatsApp', 'phone'], ['projects', 'Projects', 'folder'], ['logs', 'Message logs', 'file']];
var PAGES = {}, page = null, timers = [];
function every(fn, ms) { timers.push(setInterval(function () { if (!document.hidden) fn(); }, ms)); }
function clearPage() { timers.forEach(clearInterval); timers = []; page = null; }
function route() {
  if (!KEY) return;
  var name = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'overview'; if (!PAGES[name]) name = 'overview';
  clearPage(); if (modalOpen) modalOpen.close(null);
  $('#nav').innerHTML = NAV.map(function (n) { return '<a href="#/' + n[0] + '"' + (n[0] === name ? ' aria-current="page"' : '') + '>' + ic(n[2]) + '<span>' + esc(n[1]) + '</span></a>'; }).join('');
  document.title = NAV.filter(function (n) { return n[0] === name; })[0][1] + ' · Whatsy Admin';
  view.innerHTML = '<div id="banner"></div>'; page = PAGES[name]; page.mount(); paintStatus();
  closeNav(); window.scrollTo(0, 0); view.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);
function closeNav() { document.body.classList.remove('nav-open'); $('#burger').setAttribute('aria-expanded', 'false'); }
function head(h, p, right) { return '<div class="ph row" style="justify-content:space-between"><div><h1>' + esc(h) + '</h1><p>' + esc(p) + '</p></div>' + (right || '') + '</div>'; }
function body(html) { var d = document.createElement('div'); d.id = 'pg'; d.innerHTML = html; var old = $('#pg'); if (old) old.remove(); view.appendChild(d); return d; }
function skeleton(n) { var s = ''; for (var i = 0; i < (n || 3); i++) s += '<div class="skel" style="width:' + (60 + (i * 17) % 40) + '%"></div>'; return s; }
function empty(icon, title, text) { return '<div class="empty">' + ic(icon) + '<b>' + esc(title) + '</b><span>' + esc(text || '') + '</span></div>'; }

/* ───────── event delegation ───────── */
var ACT = {};
document.addEventListener('click', function (e) {
  var el = e.target.closest('[data-act]'); if (!el) return;
  var f = ACT[el.getAttribute('data-act')]; if (f) { if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault(); f(el, e); }
});
$('#lk-go').addEventListener('click', doLogin);
$('#lk').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
$('#lk-eye').addEventListener('click', function () { setEye($('#lk').type === 'password'); });
$('#logout').addEventListener('click', function () { signOut(''); });
$('#burger').addEventListener('click', function () { var o = document.body.classList.toggle('nav-open'); this.setAttribute('aria-expanded', String(o)); if (o) $('#nav a').focus(); });
$('#scrim').addEventListener('click', closeNav);
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.body.classList.contains('nav-open') && !modalOpen) { closeNav(); $('#burger').focus(); } });
$('#burger').innerHTML = ic('menu'); setEye(false);

/* ═════════════════════════ OVERVIEW ═════════════════════════ */
var OV = { stats: null };
PAGES.overview = {
  mount: function () {
    body(head('Overview', 'Live server status and recent activity') +
      '<div class="grid g3" id="ov-stats"></div>' +
      '<div class="card"><div class="ch"><h2>Recent messages</h2><button class="btn gh sm" type="button" data-act="ov-refresh">' + ic('refresh') + 'Refresh</button></div><div id="ov-rec">' + skeleton(4) + '</div></div>' +
      '<div class="card"><div class="ch"><h2>Quick test</h2><span class="hint" style="margin:0">Sends a real WhatsApp message. The key is not stored.</span></div>' +
      '<div class="grid g2"><div class="fg"><label for="qt-to">Recipient</label><input id="qt-to" type="tel" inputmode="tel" autocomplete="off" placeholder="+919876543210"></div>' +
      '<div class="fg"><label for="qt-k">Project API key</label><input id="qt-k" type="password" autocomplete="off" spellcheck="false" placeholder="Paste a project API key"></div></div>' +
      '<div class="fg"><label for="qt-m">Message</label><input id="qt-m" type="text" maxlength="1000" placeholder="Hello from Whatsy!"></div>' +
      '<button class="btn p" id="qt-go" type="button" data-act="qt-send">' + ic('send') + 'Send test</button><div id="qt-r" aria-live="polite"></div></div>');
    this.onStatus(); loadStats(); loadRec(); every(function () { loadRec(); loadStats(); }, 10000);
  },
  onStatus: function () {
    var el = $('#ov-stats'); if (!el) return;
    var st = S.offline ? 'offline' : S.status, cls = st === 'connected' ? 'ok' : st === 'connecting' ? 'warn' : 'bad';
    var s = OV.stats;
    el.innerHTML = '<div class="stat"><div class="l">WhatsApp</div><span class="badge ' + (S.offline ? '' : cls) + '"><span class="dot ' + st + '"></span>' + esc(S.offline ? 'Unreachable' : st) + '</span><div class="s">' + (S.offline ? 'Showing last known state' : S.status === 'connected' ? 'Session active' + (S.last_connected_at ? ' · since ' + esc(rel(S.last_connected_at)) : '') : !S.registered ? 'Not paired — <a href="#/pair">pair now</a>' : 'Reconnecting automatically') + '</div></div>' +
      '<div class="stat"><div class="l">Queue</div><div class="v">' + esc(S.queue_length || 0) + '</div><div class="s">messages waiting</div></div>' +
      '<div class="stat"><div class="l">Last 24 hours</div><div class="v">' + (s ? esc(s.sent) : '—') + '<span class="muted" style="font-size:.85rem;font-weight:500"> sent</span></div><div class="s">' + (s ? (s.failed ? '<span style="color:var(--r)">' + esc(s.failed) + ' failed</span> · ' : '') + esc(s.queued) + ' queued' : 'Loading…') + '</div></div>';
  }
};
function loadStats() { api('GET', '/admin/messages/stats').then(function (d) { OV.stats = d.last_24h; if (page && page.onStatus) page.onStatus(); }, function () { }); }
function loadRec() {
  var el = $('#ov-rec'); if (!el) return;
  api('GET', '/admin/messages?limit=7').then(function (d) {
    if (!$('#ov-rec')) return;
    el.innerHTML = d.messages.length ? '<ul class="msg-list">' + d.messages.map(function (m) {
      return '<li><div class="body"><div class="t" title="' + esc(m.body) + '">' + esc(m.body || '(empty)') + '</div><div class="m">' + esc(m.project_name) + ' → <span class="mono">' + esc(m.recipient) + '</span> · ' + timeTag(m.created_at) + '</div></div>' + badge(m.status) + '</li>';
    }).join('') + '</ul>' : empty('inbox', 'No messages yet', 'Send a test below or call the API.');
  }, function (e) { if ($('#ov-rec')) el.innerHTML = errBox(e, 'ov-refresh'); });
}
ACT['ov-refresh'] = function () { loadRec(); loadStats(); };
ACT['qt-send'] = function (btn) {
  var to = $('#qt-to').value.trim(), key = $('#qt-k').value.trim(), msg = $('#qt-m').value.trim(), out = $('#qt-r');
  if (!to || !key || !msg) { out.innerHTML = '<div class="alert warn" role="alert">' + ic('info') + '<span>Fill in recipient, API key and message.</span></div>'; return; }
  setBusy(btn, true); out.innerHTML = '';
  api('POST', '/api/v1/messages', { message: msg, recipient: to }, { apiKey: key, headers: { 'Idempotency-Key': uuid() } }).then(function (d) {
    out.innerHTML = '<div class="alert ok" role="status">' + ic('check') + '<span id="qt-st">Queued as #' + esc(d.id) + ' → ' + esc(d.recipient) + '. Waiting for delivery…</span></div>';
    loadRec(); var n = 0;
    (function poll() { if (!$('#qt-st')) return; api('GET', '/api/v1/messages/' + d.id, undefined, { apiKey: key }).then(function (m) {
      if (m.status === 'sent') { $('#qt-st').textContent = 'Sent to WhatsApp (#' + d.id + ').'; loadRec(); }
      else if (m.status === 'failed') { $('#qt-st').parentNode.className = 'alert bad'; $('#qt-st').textContent = 'Failed: ' + (m.error || 'unknown error'); loadRec(); }
      else if (++n < 12) setTimeout(poll, 1500); else $('#qt-st').textContent = 'Still queued (#' + d.id + '). Check Message logs.';
    }, function () { }); })();
  }, function (e) { out.innerHTML = '<div class="alert bad" role="alert">' + ic('x') + '<span>' + esc(e.message) + '</span></div>'; }).then(function () { setBusy(btn, false); });
};

/* ═════════════════════════ PAIR ═════════════════════════ */
var P = { code: null, issued: 0, mode: '', phone: '' };
function pairMode() { if (S.status === 'connected') return 'connected'; if (P.code) return 'code'; if (S.registered && !S.offline) return 'existing'; return 'phone'; }
PAGES.pair = {
  mount: function () { P.mode = ''; this.onStatus(); every(tickPair, 1000); },
  onStatus: function () { if (!$('#view')) return; var m = pairMode(); if (m === 'connected' && P.code) { P.code = null; toast('WhatsApp linked successfully', 'ok'); } if (m !== P.mode) { P.mode = m; renderPair(m); } else if (m === 'connected' || m === 'existing') renderPair(m); }
};
function stepsHtml(n) { return '<div class="steps" aria-label="Pairing progress">' + ['Phone number', 'Enter code', 'Connected'].map(function (t, i) { var c = i + 1 < n ? 'done' : i + 1 === n ? 'now' : ''; return '<div class="step ' + c + '"' + (c === 'now' ? ' aria-current="step"' : '') + '><i>' + (c === 'done' ? '✓' : i + 1) + '</i><br>' + t + '</div>'; }).join('') + '</div>'; }
function renderPair(m) {
  var h = head('Pair WhatsApp', 'Link a dedicated WhatsApp number to send messages');
  if (m === 'connected') h += stepsHtml(4) + '<div class="card"><div class="alert ok">' + ic('check') + '<span><b>WhatsApp is connected.</b> Messages will be delivered normally.</span></div><dl class="dl"><dt>Status</dt><dd>Connected' + (S.last_connected_at ? ' · ' + timeTag(S.last_connected_at) : '') + '</dd><dt>Queue</dt><dd>' + esc(S.queue_length || 0) + ' waiting</dd></dl><p class="hint">To switch to a different number, unlink first, then pair again. Unlinking logs this server out of WhatsApp.</p><div class="mt"><button class="btn d" type="button" data-act="unlink">Unlink this number</button></div></div>';
  else if (m === 'existing') h += '<div class="card"><div class="alert warn">' + ic('warn') + '<span>' + (S.last_disconnect_code === 401 ? 'WhatsApp logged this device out.' : 'A linked session exists but WhatsApp is <b>' + esc(S.status) + '</b>.') + ' It will reconnect automatically. If it stays disconnected, unlink and pair again.</span></div><button class="btn d" type="button" data-act="unlink">Unlink &amp; start over</button></div>';
  else if (m === 'code') h += stepsHtml(2) + '<div class="card"><p>On your phone open <b>WhatsApp → Settings → Linked devices → Link a device → Link with phone number instead</b>, then enter this code:</p><div class="paircode" id="pc" aria-label="Pairing code">' + esc(P.code) + '</div><div class="row"><button class="btn gh" type="button" data-act="pair-copy">' + ic('copy') + 'Copy code</button><button class="btn gh" type="button" data-act="pair-new">Request a new code</button><button class="btn gh" type="button" data-act="pair-cancel">Use another number</button></div><p class="hint mt" id="pc-age" aria-live="off"></p><p class="hint">This page updates by itself the moment WhatsApp links the device. Codes expire quickly — if WhatsApp rejects it, request a new one.</p></div>';
  else h += stepsHtml(1) + '<div class="card"><div class="fg"><label for="pp">WhatsApp number to link</label><input id="pp" type="tel" inputmode="tel" autocomplete="off" placeholder="919876543210" aria-describedby="pp-h"><div class="hint" id="pp-h">Country code + number. Spaces, + and dashes are fine. Use a dedicated number, not your personal one.</div></div><button class="btn p" id="pair-go" type="button" data-act="pair-go">' + ic('phone') + 'Get pairing code</button><div id="pair-err" aria-live="assertive"></div></div>';
  body(h); tickPair();
  var pp = $('#pp'); if (pp) { pp.addEventListener('keydown', function (e) { if (e.key === 'Enter') ACT['pair-go']($('#pair-go')); }); }
}
function tickPair() { var a = $('#pc-age'); if (a && P.issued) a.textContent = 'Code issued ' + Math.max(0, Math.round((Date.now() - P.issued) / 1000)) + 's ago.'; }
ACT['pair-go'] = function (btn) {
  var v = $('#pp').value.trim(), err = $('#pair-err'); err.innerHTML = '';
  if (!/^\+?[\d\s\-().]{7,}$/.test(v)) { $('#pp').setAttribute('aria-invalid', 'true'); err.innerHTML = '<div class="alert bad" role="alert">' + ic('x') + '<span>Enter a valid number with country code, e.g. 919876543210.</span></div>'; return; }
  $('#pp').removeAttribute('aria-invalid'); setBusy(btn, true); P.phone = v;
  api('POST', '/admin/pair', { phone_number: v }, { timeout: 30000 }).then(function (d) { P.code = d.pairing_code; P.issued = Date.now(); P.mode = ''; PAGES.pair.onStatus(); },
    function (e) { err.innerHTML = '<div class="alert bad" role="alert">' + ic('x') + '<span>' + esc(e.message) + '</span></div>'; setBusy(btn, false); });
};
ACT['pair-copy'] = function () { copy(P.code, 'Pairing code copied'); };
ACT['pair-cancel'] = function () { P.code = null; P.mode = ''; PAGES.pair.onStatus(); };
ACT['pair-new'] = function (btn) {
  setBusy(btn, true);
  api('POST', '/admin/pair', { phone_number: P.phone }, { timeout: 30000 }).then(function (d) { P.code = d.pairing_code; P.issued = Date.now(); toast('New code issued', 'ok'); P.mode = ''; PAGES.pair.onStatus(); },
    function (e) { toast(e.message, 'bad'); setBusy(btn, false); });
};
ACT['unlink'] = function (btn) {
  dialog({ title: 'Unlink WhatsApp?', html: 'This logs the server out of WhatsApp and deletes the stored session. Queued messages stay queued and send after you pair again.', okLabel: 'Unlink', danger: true }).then(function (ok) {
    if (!ok) return; setBusy(btn, true);
    api('POST', '/admin/pair/unlink', {}, { timeout: 20000 }).then(function () { toast('Session removed — you can pair a number now', 'ok'); P.code = null; S.registered = false; S.status = 'disconnected'; P.mode = ''; PAGES.pair.onStatus(); pollNow(); },
      function (e) { toast(e.message, 'bad'); setBusy(btn, false); });
  });
};

/* ═════════════════════════ PROJECTS ═════════════════════════ */
var PJ = [];
PAGES.projects = {
  mount: function () {
    body(head('Projects', 'Each project has its own API keys and default recipient', '<button class="btn p" type="button" data-act="pj-new">' + ic('folder') + 'New project</button>') + '<div id="pj-list">' + skeleton(4) + '</div>');
    loadProjects();
  }
};
function loadProjects() {
  api('GET', '/admin/projects').then(function (l) { PJ = l; paintProjects(); }, function (e) { var el = $('#pj-list'); if (el) el.innerHTML = errBox(e, 'pj-reload'); });
}
ACT['pj-reload'] = function () { $('#pj-list').innerHTML = skeleton(4); loadProjects(); };
function paintProjects() {
  var el = $('#pj-list'); if (!el) return;
  if (!PJ.length) { el.innerHTML = '<div class="card">' + empty('folder', 'No projects yet', 'Create one to get an API key.') + '</div>'; return; }
  el.innerHTML = PJ.map(function (p) {
    var keys = p.api_keys.filter(function (k) { return k.active; });
    return '<article class="pcard" aria-label="Project ' + esc(p.name) + '"><div class="head"><div class="grow"><h3>' + esc(p.name) + ' ' + badge(p.active ? 'active' : 'inactive') + '</h3>' +
      (p.description ? '<div class="muted">' + esc(p.description) + '</div>' : '') + (p.default_recipient ? '<div class="muted mono">Default recipient ' + esc(p.default_recipient) + '</div>' : '<div class="muted">No default recipient</div>') + '</div>' +
      '<div class="row"><button class="btn gh sm" type="button" data-act="pj-edit" data-id="' + p.id + '">Edit</button>' + (p.active ? '<button class="btn gh sm" type="button" data-act="pj-key" data-id="' + p.id + '">' + ic('key') + 'New key</button>' : '') +
      '<button class="btn ' + (p.active ? 'd' : 'gh') + ' sm" type="button" data-act="pj-toggle" data-id="' + p.id + '">' + (p.active ? 'Deactivate' : 'Activate') + '</button></div></div>' +
      (keys.length ? '<div class="keys"><div class="muted" style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px">API keys (' + keys.length + ')</div>' + keys.map(function (k) {
        return '<div class="key"><div class="grow"><span class="mono">' + esc(k.key_prefix) + '••••••••••</span>' + (k.label ? ' · ' + esc(k.label) : '') + '<div class="muted" style="font-size:.72rem">Created ' + timeTag(k.created_at) + ' · ' + (k.last_used_at ? 'last used ' + timeTag(k.last_used_at) : 'never used') + '</div></div><button class="btn d sm" type="button" data-act="pj-revoke" data-id="' + p.id + '" data-key="' + k.id + '" data-label="' + esc(k.label || k.key_prefix) + '">Revoke</button></div>';
      }).join('') + '</div>' : '<div class="keys muted">No active keys.' + (p.active ? ' Create one with “New key”.' : '') + '</div>') + '</article>';
  }).join('');
}
function byId(id) { return PJ.filter(function (p) { return p.id === Number(id); })[0]; }
function revealKey(title, key) {
  return dialog({ title: title, wide: true, persistent: true, hideCancel: true, okLabel: 'I have saved the key',
    html: '<div class="alert warn">' + ic('warn') + '<span>This key is shown <b>once</b>. Whatsy stores only a hash, so it cannot be recovered later.</span></div><div class="keybox" tabindex="0">' + esc(key) + '</div><div class="row mt"><button class="btn gh" type="button" data-copy="' + esc(key) + '">' + ic('copy') + 'Copy key</button></div>' });
}
ACT['pj-new'] = function () {
  dialog({ title: 'New project', okLabel: 'Create project', fields: true,
    html: '<div class="fg"><label for="np-n">Name</label><input id="np-n" data-field="name" maxlength="64" autocomplete="off" placeholder="my-shop"></div><div class="fg"><label for="np-r">Default recipient (optional)</label><input id="np-r" data-field="recipient" type="tel" autocomplete="off" placeholder="+919876543210"><div class="hint">Used when an API call omits “recipient”.</div></div><div class="fg"><label for="np-d">Description (optional)</label><input id="np-d" data-field="description" maxlength="280"></div><div class="hint err" data-err hidden role="alert"></div>',
    validate: function (v) { return v.name.trim() ? '' : 'Give the project a name.'; } }).then(function (v) {
    if (!v) return;
    api('POST', '/admin/projects', { name: v.name, description: v.description || null, default_recipient: v.recipient || null }).then(function (d) { loadProjects(); return revealKey('Project “' + d.name + '” created', d.api_key); }, function (e) { toast(e.message, 'bad'); });
  });
};
ACT['pj-edit'] = function (el) {
  var p = byId(el.getAttribute('data-id')); if (!p) return;
  dialog({ title: 'Edit project', okLabel: 'Save', fields: true,
    html: '<div class="fg"><label for="ep-n">Name</label><input id="ep-n" data-field="name" maxlength="64" value="' + esc(p.name) + '"></div><div class="fg"><label for="ep-r">Default recipient</label><input id="ep-r" data-field="recipient" type="tel" value="' + esc(p.default_recipient || '') + '" placeholder="Leave empty for none"></div><div class="fg"><label for="ep-d">Description</label><input id="ep-d" data-field="description" maxlength="280" value="' + esc(p.description || '') + '"></div><div class="hint err" data-err hidden role="alert"></div>',
    validate: function (v) { return v.name.trim() ? '' : 'Name cannot be empty.'; } }).then(function (v) {
    if (!v) return;
    api('PATCH', '/admin/projects/' + p.id, { name: v.name, description: v.description.trim() || null, default_recipient: v.recipient.trim() || null }).then(function () { toast('Project updated', 'ok'); loadProjects(); }, function (e) { toast(e.message, 'bad'); });
  });
};
ACT['pj-key'] = function (el) {
  var p = byId(el.getAttribute('data-id'));
  dialog({ title: 'New API key', okLabel: 'Create key', fields: true, html: '<div class="fg"><label for="nk-l">Label (optional)</label><input id="nk-l" data-field="label" maxlength="64" placeholder="production" autocomplete="off"></div>' }).then(function (v) {
    if (!v) return;
    api('POST', '/admin/projects/' + p.id + '/keys', { label: v.label || null }).then(function (d) { loadProjects(); return revealKey('New key for “' + p.name + '”', d.api_key); }, function (e) { toast(e.message, 'bad'); });
  });
};
ACT['pj-revoke'] = function (el) {
  var pid = el.getAttribute('data-id'), kid = el.getAttribute('data-key');
  dialog({ title: 'Revoke key “' + el.getAttribute('data-label') + '”?', html: 'Any app using this key will immediately get 401 errors. This cannot be undone.', okLabel: 'Revoke key', danger: true }).then(function (ok) {
    if (ok) api('DELETE', '/admin/projects/' + pid + '/keys/' + kid).then(function () { toast('Key revoked', 'ok'); loadProjects(); }, function (e) { toast(e.message, 'bad'); });
  });
};
ACT['pj-toggle'] = function (el) {
  var p = byId(el.getAttribute('data-id')), to = !p.active;
  dialog({ title: (to ? 'Activate “' : 'Deactivate “') + p.name + '”?', html: to ? 'Its API keys will start working again.' : 'All of its API keys stop working immediately. Queued messages are still delivered.', okLabel: to ? 'Activate' : 'Deactivate', danger: !to }).then(function (ok) {
    if (ok) api('PATCH', '/admin/projects/' + p.id, { active: to }).then(function () { toast('Project ' + (to ? 'activated' : 'deactivated'), 'ok'); loadProjects(); }, function (e) { toast(e.message, 'bad'); });
  });
};

/* ═════════════════════════ LOGS ═════════════════════════ */
var L = { project: '', status: '', q: '', items: [], total: 0, more: false, auto: false, loading: false };
PAGES.logs = {
  mount: function () {
    body(head('Message logs', 'Every message sent through Whatsy') +
      '<div class="card"><div class="row" style="margin-bottom:14px"><div style="min-width:150px"><label class="sr-only" for="lf-p">Project</label><select id="lf-p"><option value="">All projects</option></select></div>' +
      '<div class="seg" role="group" aria-label="Status filter">' + [['', 'All'], ['sent', 'Sent'], ['queued', 'Queued'], ['failed', 'Failed']].map(function (s) { return '<button type="button" data-act="lf-status" data-v="' + s[0] + '" aria-pressed="' + (L.status === s[0]) + '">' + s[1] + '</button>'; }).join('') + '</div>' +
      '<div class="grow" style="min-width:160px"><label class="sr-only" for="lf-q">Search</label><input id="lf-q" type="search" placeholder="Search number or text" maxlength="64" value="' + esc(L.q) + '"></div>' +
      '<label class="row" style="margin:0;text-transform:none;letter-spacing:0;font-size:.8rem;font-weight:500;color:var(--t2);cursor:pointer"><input type="checkbox" id="lf-auto" style="width:18px;min-height:18px"' + (L.auto ? ' checked' : '') + '> Auto-refresh</label></div>' +
      '<div id="lg-meta" class="hint" aria-live="polite"></div><div class="tw" id="lg-body">' + skeleton(5) + '</div><div class="row mt" id="lg-more" style="justify-content:center"></div></div>');
    api('GET', '/admin/projects').then(function (l) { var s = $('#lf-p'); if (!s) return; l.forEach(function (p) { var o = document.createElement('option'); o.value = p.name; o.textContent = p.name; if (p.name === L.project) o.selected = true; s.appendChild(o); }); }, function () { });
    $('#lf-p').addEventListener('change', function () { L.project = this.value; loadLogs(true); });
    var t; $('#lf-q').addEventListener('input', function () { var v = this.value.trim(); clearTimeout(t); t = setTimeout(function () { L.q = v; loadLogs(true); }, 350); });
    $('#lf-auto').addEventListener('change', function () { L.auto = this.checked; });
    every(function () { if (L.auto && !modalOpen) loadLogs(true, true); }, 8000);
    loadLogs(true);
  }
};
function qs(extra) { var p = new URLSearchParams({ limit: '50' }); if (L.project) p.set('project', L.project); if (L.status) p.set('status', L.status); if (L.q) p.set('q', L.q); Object.keys(extra || {}).forEach(function (k) { p.set(k, extra[k]); }); return p.toString(); }
function loadLogs(reset, silent) {
  if (L.loading) return; L.loading = true;
  var extra = !reset && L.items.length ? { before_id: L.items[L.items.length - 1].id } : {};
  if (reset && !silent) { var b = $('#lg-body'); if (b) b.innerHTML = skeleton(5); }
  api('GET', '/admin/messages?' + qs(extra)).then(function (d) {
    L.items = reset ? d.messages : L.items.concat(d.messages); L.total = d.total; L.more = d.has_more; paintLogs();
  }, function (e) { var b = $('#lg-body'); if (b && (reset && !silent)) b.innerHTML = errBox(e, 'lg-reload'); else if (!silent) toast(e.message, 'bad'); }).then(function () { L.loading = false; });
}
ACT['lg-reload'] = function () { loadLogs(true); };
ACT['lf-status'] = function (el) { L.status = el.getAttribute('data-v'); document.querySelectorAll('[data-act=lf-status]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === el)); }); loadLogs(true); };
function paintLogs() {
  var b = $('#lg-body'); if (!b) return;
  $('#lg-meta').textContent = L.total ? 'Showing ' + L.items.length + ' of ' + L.total + ' message' + (L.total === 1 ? '' : 's') : '';
  if (!L.items.length) { b.innerHTML = (L.project || L.status || L.q) ? empty('inbox', 'No messages match these filters', 'Try clearing the search or status.') : empty('inbox', 'No messages yet', 'They will appear here as soon as something is sent.'); $('#lg-more').innerHTML = ''; return; }
  b.innerHTML = '<table class="stack"><thead><tr><th>Time</th><th>Project</th><th>Recipient</th><th>Status</th><th>Message</th></tr></thead><tbody>' + L.items.map(function (m) {
    return '<tr class="click" tabindex="0" data-act="lg-open" data-id="' + m.id + '"><td data-l="Time">' + timeTag(m.created_at) + '</td><td data-l="Project"><b>' + esc(m.project_name) + '</b></td><td data-l="To" class="mono">' + esc(m.recipient) + '</td><td data-l="Status">' + badge(m.status) + '</td><td data-l="Message" class="trunc" title="' + esc(m.error || m.body) + '">' + esc(m.error || m.body) + '</td></tr>';
  }).join('') + '</tbody></table>';
  $('#lg-more').innerHTML = L.more ? '<button class="btn gh" type="button" data-act="lg-more">Load more</button>' : '<span class="hint">End of results</span>';
}
ACT['lg-more'] = function (b) { setBusy(b, true); L.loading = false; loadLogs(false); };
document.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('tr[data-act]')) { e.preventDefault(); e.target.click(); } });
ACT['lg-open'] = function (el) {
  var m = L.items.filter(function (x) { return x.id === Number(el.getAttribute('data-id')); })[0]; if (!m) return;
  dialog({ title: 'Message #' + m.id, wide: true, okLabel: m.status === 'failed' ? 'Retry send' : 'Close', cancelLabel: m.status === 'failed' ? 'Close' : 'Close', hideCancel: m.status !== 'failed',
    html: '<dl class="dl"><dt>Status</dt><dd>' + badge(m.status) + '</dd><dt>Project</dt><dd>' + esc(m.project_name) + '</dd><dt>To</dt><dd class="mono">' + esc(m.recipient) + '</dd><dt>Created</dt><dd>' + esc(absTime(m.created_at)) + '</dd>' + (m.sent_at ? '<dt>Sent</dt><dd>' + esc(absTime(m.sent_at)) + '</dd>' : '') + (m.wa_message_id ? '<dt>WhatsApp id</dt><dd class="mono">' + esc(m.wa_message_id) + '</dd>' : '') + (m.error ? '<dt>Error</dt><dd style="color:var(--r)">' + esc(m.error) + '</dd>' : '') + '</dl><label>Message</label><div class="code"><pre style="white-space:pre-wrap;padding-right:0;color:var(--t1)">' + esc(m.body) + '</pre></div>' }).then(function (ok) {
    if (ok && m.status === 'failed') api('POST', '/admin/messages/' + m.id + '/retry', {}).then(function () { toast('Message re-queued', 'ok'); loadLogs(true); }, function (e) { toast(e.message, 'bad'); });
  });
};

/* ═════════════════════════ OTP TESTER ═════════════════════════ */
var O = { phone: '', key: '', timer: null, left: 0, state: 'idle' };
var DEF_TPL = 'Your verification code is: *{code}*. Valid for {minutes} minutes. Please do not share this code with anyone.';
PAGES.otp = {
  mount: function () {
    body(head('OTP tester', 'Send a real verification code and verify it — the same flow your app will use') +
      '<div class="card"><div class="ch"><h2>1 · Send code</h2></div><div class="grid g2"><div class="fg"><label for="o-ph">Recipient number</label><input id="o-ph" type="tel" inputmode="tel" autocomplete="off" placeholder="+919876543210"><div class="hint">With country code. Spaces and + are fine.</div></div>' +
      '<div class="fg"><label for="o-k">Project API key</label><input id="o-k" type="password" autocomplete="off" spellcheck="false" placeholder="Paste a project API key"><div class="hint">Used for this test only; never stored.</div></div>' +
      '<div class="fg"><label for="o-d">Code length</label><select id="o-d"><option value="6" selected>6 digits (recommended)</option><option value="8">8 digits</option><option value="4">4 digits (weaker)</option></select></div>' +
      '<div class="fg"><label for="o-e">Expires after</label><select id="o-e"><option value="5" selected>5 minutes</option><option value="2">2 minutes</option><option value="10">10 minutes</option><option value="15">15 minutes</option></select></div></div>' +
      '<div class="fg"><div class="row" style="justify-content:space-between"><label for="o-t" style="margin:0">Message template</label><span class="row"><button class="chip" type="button" data-act="o-tag" data-v="{code}">{code}</button><button class="chip" type="button" data-act="o-tag" data-v="{minutes}">{minutes}</button></span></div><input id="o-t" maxlength="250" value="' + esc(DEF_TPL) + '" aria-describedby="o-th"><div class="hint" id="o-th">Must contain {code}. Up to 250 characters. WhatsApp *bold* is supported.</div></div>' +
      '<div class="muted" style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Preview</div><div class="bubble" id="o-pv" aria-live="polite"></div>' +
      '<div class="row mt"><button class="btn p" id="o-send" type="button" data-act="o-send">' + ic('send') + 'Send code</button></div><div id="o-sr" aria-live="polite"></div></div>' +
      '<div class="card" id="o-vcard"><div class="ch"><h2>2 · Verify code</h2><span id="o-att" class="badge">No code sent yet</span></div><div class="row" style="align-items:flex-end"><div class="grow fg" style="margin:0"><label for="o-c">Code received on WhatsApp</label><input id="o-c" inputmode="numeric" autocomplete="one-time-code" maxlength="8" pattern="[0-9]*" placeholder="••••••" style="font-family:var(--mono);font-size:1.2rem;letter-spacing:.3em"></div><button class="btn p" id="o-ver" type="button" data-act="o-ver" style="min-height:42px">Verify</button></div><div class="hint">Three wrong tries lock the code. A new code can be requested after the cooldown (60s by default).</div><div id="o-vr" aria-live="polite"></div></div>');
    if (O.phone) $('#o-ph').value = O.phone;
    ['o-t', 'o-d', 'o-e'].forEach(function (i) { $('#' + i).addEventListener('input', pv); $('#' + i).addEventListener('change', pv); });
    $('#o-c').addEventListener('input', function () { this.value = this.value.replace(/\D/g, ''); });
    $('#o-c').addEventListener('keydown', function (e) { if (e.key === 'Enter') ACT['o-ver']($('#o-ver')); });
    pv();
  }
};
function pv() {
  var el = $('#o-pv'); if (!el) return;
  var d = Number($('#o-d').value), code = d === 4 ? '4819' : d === 8 ? '92841053' : '482910';
  var t = ($('#o-t').value || DEF_TPL).split('{code}').join(code).split('{minutes}').join($('#o-e').value);
  el.innerHTML = esc(t).replace(/\*([^*\n]+)\*/g, '<b>$1</b>') + '<div class="tm">' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ✓✓</div>';
}
ACT['o-tag'] = function (el) { var i = $('#o-t'), v = el.getAttribute('data-v'), s = i.selectionStart == null ? i.value.length : i.selectionStart; i.value = i.value.slice(0, s) + v + i.value.slice(i.selectionEnd == null ? s : i.selectionEnd); i.focus(); pv(); };
function dots(n) { var h = ''; for (var i = 1; i <= 3; i++) h += '<i class="' + (n >= i ? (n === 3 ? '' : 'warn') : 'off') + '"></i>'; return '<span class="dots" aria-hidden="true">' + h + '</span>'; }
function setAtt(text, cls, n) { var a = $('#o-att'); if (a) { a.className = 'badge ' + cls; a.innerHTML = esc(text) + (n == null ? '' : dots(n)); } }
function startCount(sec) {
  clearInterval(O.timer); O.left = sec;
  O.timer = setInterval(function () { var el = $('#o-cd'); O.left--; if (!el) { clearInterval(O.timer); return; } if (O.left <= 0) { clearInterval(O.timer); el.textContent = 'Code expired'; setAtt('Expired', 'bad'); return; } el.textContent = 'Expires in ' + Math.floor(O.left / 60) + ':' + String(O.left % 60).padStart(2, '0'); }, 1000);
  timers.push(O.timer);
}
ACT['o-send'] = function (btn) {
  var ph = $('#o-ph').value.trim(), key = $('#o-k').value.trim(), out = $('#o-sr');
  if (!ph || !key) { out.innerHTML = '<div class="alert warn" role="alert">' + ic('info') + '<span>Enter the recipient number and a project API key.</span></div>'; return; }
  var tpl = $('#o-t').value.trim(); if (tpl && tpl.indexOf('{code}') < 0) { out.innerHTML = '<div class="alert bad" role="alert">' + ic('x') + '<span>The template must contain {code}.</span></div>'; $('#o-t').focus(); return; }
  O.phone = ph; O.key = key; setBusy(btn, true); out.innerHTML = '';
  api('POST', '/api/v1/otp/send', { phone: ph, digits: Number($('#o-d').value), expiry_minutes: Number($('#o-e').value), message_template: tpl || undefined }, { apiKey: key, timeout: 30000 }).then(function (d) {
    out.innerHTML = '<div class="alert ok" role="status">' + ic('check') + '<span>Code sent to <b>' + esc(d.phone) + '</b> (request #' + esc(d.request_id) + ') · <span id="o-cd"></span></span></div>';
    startCount(d.expires_in_seconds); setAtt('3 attempts left', 'ok', 3); $('#o-c').value = ''; $('#o-vr').innerHTML = ''; $('#o-c').focus({ preventScroll: false });
  }, function (e) {
    var hint = e.status === 429 ? ' You can request another code once the wait is over.' : e.code === 'whatsapp_unavailable' ? ' Check the Pair WhatsApp page.' : '';
    out.innerHTML = '<div class="alert bad" role="alert">' + ic('x') + '<span>' + esc(e.message + hint) + '</span></div>';
  }).then(function () { setBusy(btn, false); });
};
ACT['o-ver'] = function (btn) {
  var code = $('#o-c').value.trim(), out = $('#o-vr'), ph = $('#o-ph').value.trim() || O.phone, key = $('#o-k').value.trim() || O.key;
  if (!ph || !key) { out.innerHTML = '<div class="alert warn" role="alert">' + ic('info') + '<span>Enter the number and API key above first.</span></div>'; return; }
  if (!/^\d{4,8}$/.test(code)) { out.innerHTML = '<div class="alert warn" role="alert">' + ic('info') + '<span>Enter the 4–8 digit code from WhatsApp.</span></div>'; $('#o-c').focus(); return; }
  setBusy(btn, true);
  api('POST', '/api/v1/otp/verify', { phone: ph, code: code }, { apiKey: key }).then(function (d) {
    clearInterval(O.timer); setAtt('Verified', 'ok'); out.innerHTML = '<div class="alert ok" role="status">' + ic('check') + '<span><b>Verified.</b> ' + esc(d.phone) + ' confirmed. This code cannot be used again.</span></div>'; toast('Code verified', 'ok');
  }, function (e) {
    var left = e.extra && e.extra.attempts_left;
    if (e.code === 'locked') { clearInterval(O.timer); setAtt('Locked', 'bad', 0); }
    else if (left != null) setAtt(left + (left === 1 ? ' attempt left' : ' attempts left'), 'warn', left);
    else if (e.code === 'expired') setAtt('Expired', 'bad');
    out.innerHTML = '<div class="alert bad" role="alert">' + ic('x') + '<span>' + esc(e.message) + '</span></div>'; $('#o-c').select();
  }).then(function () { setBusy(btn, false); });
};

/* ═════════════════════════ API DOCS ═════════════════════════ */
var LANG = 'curl';
PAGES.docs = {
  mount: function () {
    var o = location.origin;
    body(head('API & connect', 'Call Whatsy from any backend. Keep API keys on your server — never in browser or mobile app code.') +
      '<div class="card"><div class="ch"><div><h2>Base URL</h2><div class="mono" style="color:var(--g);margin-top:4px">' + esc(o) + '</div></div><button class="btn gh sm" type="button" data-copy-text="' + esc(o) + '" data-act="doc-copy">' + ic('copy') + 'Copy</button></div>' +
      '<div class="tabs" role="group" aria-label="Language">' + [['curl', 'cURL'], ['js', 'Node.js'], ['py', 'Python'], ['php', 'PHP']].map(function (l) { return '<button class="btn sm ' + (l[0] === LANG ? 'p' : 'gh') + '" type="button" data-act="doc-lang" data-v="' + l[0] + '" aria-pressed="' + (l[0] === LANG) + '">' + l[1] + '</button>'; }).join('') + '</div>' +
      '<p class="hint">Replace <span class="mono">YOUR_API_KEY</span> with a project key from Projects. Add an <span class="mono">Idempotency-Key</span> header to make retries safe (no duplicate messages).</p></div><div id="snips"></div>');
    snips();
  }
};
function snippets(o, lang) {
  var K = 'YOUR_API_KEY', ph = '+919876543210', J = JSON.stringify;
  var calls = [
    ['Send a message', 'POST /api/v1/messages', '/api/v1/messages', { recipient: ph, message: 'Order #1234 has shipped.' }, true],
    ['Send an OTP', 'POST /api/v1/otp/send', '/api/v1/otp/send', { phone: ph, digits: 6, expiry_minutes: 5 }, false],
    ['Verify an OTP', 'POST /api/v1/otp/verify', '/api/v1/otp/verify', { phone: ph, code: '123456' }, false]];
  var out = calls.map(function (c) {
    var u = o + c[2], b = c[3], idem = c[4], s;
    if (lang === 'curl') s = "curl -X POST '" + u + "' \\\n  -H 'X-Api-Key: " + K + "' \\\n  -H 'Content-Type: application/json' \\\n" + (idem ? "  -H 'Idempotency-Key: order-1234-shipped' \\\n" : '') + "  -d '" + J(b) + "'";
    else if (lang === 'js') s = "const res = await fetch(" + J(u) + ", {\n  method: 'POST',\n  headers: {\n    'X-Api-Key': process.env.WHATSY_API_KEY, // " + K + "\n    'Content-Type': 'application/json',\n" + (idem ? "    'Idempotency-Key': 'order-1234-shipped',\n" : '') + "  },\n  body: JSON.stringify(" + J(b) + "),\n});\nconst data = await res.json(); // check res.status: 202/200 ok, 4xx = your request, 5xx/503 = retry later";
    else if (lang === 'py') s = "import os, requests\n\nres = requests.post(\n    " + J(u) + ",\n    headers={'X-Api-Key': os.environ['WHATSY_API_KEY']" + (idem ? ", 'Idempotency-Key': 'order-1234-shipped'" : '') + "},\n    json=" + J(b).replace(/true/g, 'True') + ",\n    timeout=20,\n)\nprint(res.status_code, res.json())";
    else s = "<?php\n$ch = curl_init(" + J(u).replace(/\\\//g, '/') + ");\ncurl_setopt_array($ch, [\n  CURLOPT_POST => true,\n  CURLOPT_RETURNTRANSFER => true,\n  CURLOPT_TIMEOUT => 20,\n  CURLOPT_HTTPHEADER => [\n    'X-Api-Key: ' . getenv('WHATSY_API_KEY'),\n    'Content-Type: application/json',\n" + (idem ? "    'Idempotency-Key: order-1234-shipped',\n" : '') + "  ],\n  CURLOPT_POSTFIELDS => json_encode(" + J(b).replace(/\{/g, '[').replace(/\}/g, ']').replace(/":/g, '" =>') + "),\n]);\n$body = json_decode(curl_exec($ch), true);\n$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);";
    return [c[0], c[1], s];
  });
  out.push(['Check status', 'GET /api/v1/status (no key needed)', lang === 'curl' ? "curl '" + o + "/api/v1/status'" : lang === 'js' ? "const s = await (await fetch('" + o + "/api/v1/status')).json();" : lang === 'py' ? "print(requests.get('" + o + "/api/v1/status', timeout=10).json())" : "<?php print_r(json_decode(file_get_contents('" + o + "/api/v1/status'), true));"]);
  return out;
}
function snips() {
  var el = $('#snips'); if (!el) return;
  el.innerHTML = snippets(location.origin, LANG).map(function (s, i) { return '<div class="card"><div class="ch"><div><h2>' + esc(s[0]) + '</h2><div class="mono muted" style="margin-top:2px">' + esc(s[1]) + '</div></div></div><div class="code"><pre id="sn' + i + '">' + esc(s[2]) + '</pre><button class="btn gh sm" type="button" data-act="doc-snip" data-i="' + i + '">' + ic('copy') + 'Copy</button></div></div>'; }).join('');
}
ACT['doc-lang'] = function (el) { LANG = el.getAttribute('data-v'); document.querySelectorAll('[data-act=doc-lang]').forEach(function (b) { var on = b === el; b.className = 'btn sm ' + (on ? 'p' : 'gh'); b.setAttribute('aria-pressed', String(on)); }); snips(); };
ACT['doc-snip'] = function (el) { copy($('#sn' + el.getAttribute('data-i')).textContent, 'Snippet copied'); };
ACT['doc-copy'] = function (el) { copy(el.getAttribute('data-copy-text'), 'Base URL copied'); };

/* ───────── boot ───────── */
if (KEY) {
  api('GET', '/admin/pair/status', undefined, { noAuthRedirect: true }).then(function (d) { S = norm(d); showApp(); },
    function (e) { if (e.status === 401 || e.status === 429) { signOut(e.status === 401 ? 'Your session expired. Please sign in again.' : e.message); } else { /* server unreachable: still show the app shell with the offline banner */ S.offline = true; showApp(); } });
} else { $('#lk').focus(); }
})();
