'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv();

function dataDir() {
  let d = process.env.RETROPOST_DATA_DIR;
  if (!d) {
    if (process.platform === 'win32') d = path.join(process.env.APPDATA || os.homedir(), 'RetroPost');
    else if (process.platform === 'darwin') d = path.join(os.homedir(), 'Library', 'Application Support', 'RetroPost');
    else d = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'retropost');
  }
  fs.mkdirSync(path.join(d, 'logs'), { recursive: true });
  return d;
}

const DATA_DIR = dataDir();
const LOG_FILE = path.join(DATA_DIR, 'logs', 'retropost.log');

function log(scope, ...args) {
  const msg = args.map(a => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const line = `${new Date().toISOString()} [${scope}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
    const st = fs.statSync(LOG_FILE);
    if (st.size > 5 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
  } catch {}
}

function tailLog(lines = 200) {
  try {
    const txt = fs.readFileSync(LOG_FILE, 'utf8');
    return txt.split('\n').slice(-lines - 1).join('\n');
  } catch { return ''; }
}

const id = (p = '') => p + crypto.randomBytes(6).toString('hex');
const env = (k, d = '') => (process.env[k] ?? d).trim();
const dryRun = () => env('RETROPOST_DRY_RUN') === '1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function median(arr) {
  const a = arr.filter(x => typeof x === 'number' && !isNaN(x)).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cands = [fence && fence[1], text];
  for (const c of cands) {
    if (!c) continue;
    try { return JSON.parse(c); } catch {}
    const s = c.search(/[\[{]/);
    if (s >= 0) {
      const open = c[s], close = open === '{' ? '}' : ']';
      const e = c.lastIndexOf(close);
      if (e > s) { try { return JSON.parse(c.slice(s, e + 1)); } catch {} }
    }
  }
  return null;
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const txt = await res.text();
  let body; try { body = txt ? JSON.parse(txt) : {}; } catch { body = { raw: txt }; }
  if (!res.ok) {
    const msg = body?.error?.message || body?.error_description || body?.error?.code || body?.message || txt.slice(0, 300);
    const err = new Error(`HTTP ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    err.status = res.status; err.body = body;
    throw err;
  }
  return body;
}

function form(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) p.append(k, String(v));
  return p;
}

function which(cmd) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const e of exts) {
      const f = path.join(dir, cmd + e);
      try { if (fs.statSync(f).isFile()) return f; } catch {}
    }
  }
  return null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};
const mime = f => MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
const VIDEO_EXT = ['.mp4', '.mov', '.webm', '.m4v'];
const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

module.exports = { ROOT, DATA_DIR, LOG_FILE, log, tailLog, id, env, dryRun, sleep, median, extractJson, fetchJson, form, which, mime, VIDEO_EXT, IMAGE_EXT };
