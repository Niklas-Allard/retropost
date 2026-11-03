'use strict';
// Token-Verschlüsselung: AES-256-GCM. Der Master-Key liegt im OS-Schlüsselbund
// (macOS Keychain, Windows DPAPI, Linux Secret Service); Fallback: Key-Datei mit 0600.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { DATA_DIR, log, which } = require('./util');

const SERVICE = 'RetroPost';
let KEY = null;
let backend = 'file';

function tryRun(cmd, args, input) {
  try { return execFileSync(cmd, args, { input, stdio: ['pipe', 'pipe', 'ignore'], timeout: 15000 }).toString().trim(); }
  catch { return null; }
}

function fromKeychainMac() {
  if (process.platform !== 'darwin') return null;
  let k = tryRun('security', ['find-generic-password', '-s', SERVICE, '-a', 'master', '-w']);
  if (!k) {
    k = crypto.randomBytes(32).toString('hex');
    if (tryRun('security', ['add-generic-password', '-s', SERVICE, '-a', 'master', '-w', k, '-U']) === null) return null;
  }
  backend = 'macOS Keychain';
  return k;
}

function fromSecretTool() {
  if (process.platform !== 'linux' || !which('secret-tool')) return null;
  let k = tryRun('secret-tool', ['lookup', 'service', SERVICE, 'account', 'master']);
  if (!k) {
    k = crypto.randomBytes(32).toString('hex');
    if (tryRun('secret-tool', ['store', '--label=RetroPost master key', 'service', SERVICE, 'account', 'master'], k) === null) return null;
    if (tryRun('secret-tool', ['lookup', 'service', SERVICE, 'account', 'master']) !== k) return null;
  }
  backend = 'Linux Keyring';
  return k;
}

function fromDpapi() {
  if (process.platform !== 'win32') return null;
  const file = path.join(DATA_DIR, 'master.dpapi');
  const ps = (script) => tryRun('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  const pre = 'Add-Type -AssemblyName System.Security;';
  if (fs.existsSync(file)) {
    const enc = fs.readFileSync(file, 'utf8').trim();
    const k = ps(`${pre} [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${enc}'),$null,'CurrentUser'))`);
    if (k) { backend = 'Windows DPAPI'; return k; }
    return null;
  }
  const k = crypto.randomBytes(32).toString('hex');
  const enc = ps(`${pre} [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes('${k}'),$null,'CurrentUser'))`);
  if (!enc) return null;
  fs.writeFileSync(file, enc);
  backend = 'Windows DPAPI';
  return k;
}

function fromFile() {
  const file = path.join(DATA_DIR, 'master.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  backend = 'Key-Datei (Fallback)';
  log('secrets', 'Kein OS-Schlüsselbund verfügbar – nutze', file);
  return fs.readFileSync(file, 'utf8').trim();
}

function key() {
  if (KEY) return KEY;
  const hex = fromKeychainMac() || fromDpapi() || fromSecretTool() || fromFile();
  KEY = Buffer.from(hex, 'hex');
  return KEY;
}

function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

function decrypt(str) {
  if (!str) return null;
  const [v, iv, tag, data] = str.split('.');
  if (v !== 'v1') throw new Error('Unbekanntes Token-Format');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8'));
}

// HMAC für signierte Medien-Links / OAuth-State
function sign(str) { return crypto.createHmac('sha256', key()).update(str).digest('base64url'); }
function verify(str, sig) {
  const a = Buffer.from(sign(str)), b = Buffer.from(String(sig || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { encrypt, decrypt, sign, verify, backend: () => (key(), backend) };
