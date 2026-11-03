'use strict';
// Eigener Cloudflare Tunnel (cloudflared) + signierte, ablaufende Medien-Links für Instagram/TikTok.
const { spawn } = require('node:child_process');
const path = require('node:path');
const secrets = require('./secrets');
const { env, which, log } = require('./util');

let proc = null;
let quickUrl = null;
let lastOutput = [];

const LINK_TTL_MS = 60 * 60 * 1000;

function baseUrl() { return (env('PUBLIC_BASE_URL') || quickUrl || '').replace(/\/$/, ''); }

function mediaUrl(file) {
  const base = baseUrl();
  if (!base) throw new Error('Kein öffentlicher Tunnel: PUBLIC_BASE_URL setzen und Tunnel starten (Einstellungen).');
  const exp = Date.now() + LINK_TTL_MS;
  const p = Buffer.from(path.resolve(file)).toString('base64url');
  const sig = secrets.sign(`${p}.${exp}`);
  return `${base}/m/${p}/${exp}/${sig}/${encodeURIComponent(path.basename(file))}`;
}

function resolveMedia(p, exp, sig) {
  if (!secrets.verify(`${p}.${exp}`, sig)) return { error: 403 };
  if (Date.now() > Number(exp)) return { error: 410 };
  return { file: Buffer.from(p, 'base64url').toString() };
}

function start() {
  if (proc) return status();
  const bin = which('cloudflared') || env('CLOUDFLARED_PATH');
  if (!bin) throw new Error('cloudflared ist nicht installiert (siehe docs/SETUP.md).');
  const token = env('CLOUDFLARE_TUNNEL_TOKEN');
  const args = token ? ['tunnel', '--no-autoupdate', 'run', '--token', token] : ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${env('GATEWAY_PORT', '4318')}`];
  proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  lastOutput = [];
  const onData = d => {
    const s = d.toString();
    lastOutput.push(...s.split('\n').filter(Boolean)); lastOutput = lastOutput.slice(-40);
    const m = s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !token) { quickUrl = m[0]; log('tunnel', 'Quick-Tunnel:', quickUrl); }
  };
  proc.stdout.on('data', onData); proc.stderr.on('data', onData);
  proc.on('exit', code => { log('tunnel', 'cloudflared beendet, Code', code); proc = null; quickUrl = null; });
  log('tunnel', token ? 'Eigener Tunnel gestartet' : 'Quick-Tunnel wird gestartet (nur zum Testen – für Instagram/TikTok eigene Domain nutzen)');
  return status();
}

function stop() { if (proc) { proc.kill(); proc = null; quickUrl = null; } return status(); }

function status() {
  return { running: !!proc, mode: env('CLOUDFLARE_TUNNEL_TOKEN') ? 'eigener Tunnel' : 'Quick-Tunnel', publicUrl: baseUrl() || null, installed: !!(which('cloudflared') || env('CLOUDFLARED_PATH')), output: lastOutput.slice(-8) };
}

module.exports = { start, stop, status, mediaUrl, resolveMedia, baseUrl, LINK_TTL_MS };
