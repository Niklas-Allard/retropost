'use strict';
// Konten, OAuth-Flows, verschlüsselte Tokens, automatische Erneuerung.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const store = require('./store');
const secrets = require('./secrets');
const platforms = require('./platforms');
const { id, log, env, which, dryRun } = require('./util');

function publicAccount(a) {
  const { tokens, ...rest } = a;
  return { ...rest, connected: !!tokens, configured: platforms[a.platform]?.configured() ?? false };
}

function create({ projectId, platform, name, chromeProfile, tiktokMode }) {
  if (!platforms[platform]) throw new Error('Unbekannte Plattform');
  const a = { id: id('acc_'), projectId, platform, name: name || platforms[platform].label, chromeProfile: chromeProfile || '', tiktokMode: platform === 'tiktok' ? (tiktokMode || 'studio') : undefined, createdAt: Date.now(), tokens: null, identity: null, lastError: null };
  store.get().accounts.push(a); store.save();
  return a;
}

function state(accountId) {
  const payload = `${accountId}.${Date.now()}`;
  return Buffer.from(payload).toString('base64url') + '.' + secrets.sign(payload);
}
function parseState(s) {
  const [b, sig] = String(s || '').split('.');
  const payload = Buffer.from(b || '', 'base64url').toString();
  if (!secrets.verify(payload, sig)) throw new Error('OAuth-State ungültig');
  const [accountId, ts] = payload.split('.');
  if (Date.now() - Number(ts) > 30 * 60 * 1000) throw new Error('OAuth-Anfrage abgelaufen – bitte erneut verbinden');
  return accountId;
}

function chromeBinary() {
  if (env('CHROME_PATH')) return env('CHROME_PATH');
  const cands = process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : process.platform === 'win32' ? [`${process.env['PROGRAMFILES']}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`]
    : [];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  return which('google-chrome') || which('google-chrome-stable') || which('chromium') || which('chromium-browser');
}

// Öffnet eine URL im Chrome-Profil des Kontos. Gibt false zurück, wenn kein Chrome gefunden wurde.
function openInProfile(url, profile) {
  const bin = chromeBinary();
  if (!bin || !profile) return false;
  try {
    spawn(bin, [`--profile-directory=${profile}`, url], { detached: true, stdio: 'ignore' }).unref();
    return true;
  } catch (e) { log('accounts', 'Chrome-Start fehlgeschlagen', e.message); return false; }
}

function connectUrl(accountId) {
  const a = store.find('accounts', accountId);
  if (!a) throw new Error('Konto nicht gefunden');
  const p = platforms[a.platform];
  if (!p.configured()) throw new Error(`${p.label} ist nicht konfiguriert – trage die Zugangsdaten in .env ein (npm run doctor).`);
  return p.authUrl(state(accountId));
}

async function handleCallback(platform, code, st) {
  const accountId = parseState(st);
  const a = store.find('accounts', accountId);
  if (!a || a.platform !== platform) throw new Error('Konto passt nicht zum Callback');
  const { tokens, identity } = await platforms[platform].handleCallback(code);
  a.tokens = secrets.encrypt(tokens);
  a.tokenExpiresAt = tokens.expiresAt;
  a.identity = identity;
  a.lastError = null;
  a.connectedAt = Date.now();
  store.save();
  log('accounts', `${platform}-Konto verbunden: ${identity.handle}`);
  return a;
}

async function tokensFor(a) {
  if (dryRun() && !a.tokens) return { access_token: 'dry-run' };
  if (!a.tokens) throw new Error(`Konto "${a.name}" ist nicht verbunden`);
  let t = secrets.decrypt(a.tokens);
  const p = platforms[a.platform];
  const window = p.refreshWindowMs || 5 * 60 * 1000;
  if (t.expiresAt && t.expiresAt - Date.now() < window) t = await refreshAccount(a, t);
  return t;
}

async function refreshAccount(a, t) {
  t = t || secrets.decrypt(a.tokens);
  try {
    const nt = await platforms[a.platform].refresh(t);
    a.tokens = secrets.encrypt(nt);
    a.tokenExpiresAt = nt.expiresAt;
    a.lastError = null;
    store.save();
    log('accounts', `Token erneuert: ${a.platform}/${a.name}`);
    return nt;
  } catch (e) {
    a.lastError = 'Token-Erneuerung: ' + e.message; store.save();
    throw e;
  }
}

// Vom Worker regelmäßig aufgerufen
async function renewAll() {
  for (const a of store.get().accounts) {
    if (!a.tokens) continue;
    const window = platforms[a.platform].refreshWindowMs || 24 * 3600 * 1000;
    if (a.tokenExpiresAt && a.tokenExpiresAt - Date.now() < window) {
      try { await refreshAccount(a); } catch (e) { log('accounts', `Erneuerung fehlgeschlagen ${a.name}:`, e.message); }
    }
  }
}

function disconnect(accountId) {
  const a = store.find('accounts', accountId);
  if (a) { a.tokens = null; a.identity = null; a.tokenExpiresAt = null; store.save(); }
}

module.exports = { publicAccount, create, connectUrl, handleCallback, tokensFor, renewAll, disconnect, openInProfile, chromeBinary };
