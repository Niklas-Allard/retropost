#!/usr/bin/env node
'use strict';
// Setup-Check: zeigt nur, WELCHE Werte fehlen – gibt niemals Secrets aus.
const fs = require('node:fs');
const path = require('node:path');
const { which, env, ROOT, DATA_DIR } = require('../server/util');

const ok = (b) => (b ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✘\x1b[0m');
const warn = '\x1b[33m!\x1b[0m';
let problems = 0;
const line = (state, label, hint = '') => { if (state === false) problems++; console.log(` ${state === null ? warn : ok(state)} ${label}${hint ? '  \x1b[2m' + hint + '\x1b[0m' : ''}`); };

console.log('\n\x1b[35m▓▓ RETROPOST · SETUP-CHECK ▓▓\x1b[0m\n');
const [maj, min] = process.versions.node.split('.').map(Number);
line(maj > 22 || (maj === 22 && min >= 5), `Node.js ${process.versions.node}`, '≥ 22.5 nötig');
line(fs.existsSync(path.join(ROOT, '.env')), '.env vorhanden', 'cp .env.example .env');

console.log('\n.env-Werte (nur leer/gesetzt):');
const groups = {
  'YouTube': ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  'Instagram': ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'],
  'TikTok': ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
  'Tunnel (für Instagram/TikTok)': ['PUBLIC_BASE_URL', 'CLOUDFLARE_TUNNEL_TOKEN'],
};
for (const [g, keys] of Object.entries(groups)) {
  const set = keys.filter(k => env(k));
  line(set.length === keys.length ? true : set.length ? false : null, `${g}: ${keys.map(k => `${k}=${env(k) ? 'gesetzt' : 'LEER'}`).join(', ')}`);
}
if (env('PUBLIC_BASE_URL') && !/^https:\/\//.test(env('PUBLIC_BASE_URL'))) line(false, 'PUBLIC_BASE_URL muss mit https:// beginnen');

console.log('\nWerkzeuge:');
const agents = ['claude', 'codex', 'cursor-agent'].filter(which);
line(agents.length > 0, `KI-Agent: ${agents.join(', ') || 'keiner gefunden'}`, 'Claude Code, Codex oder Cursor CLI installieren & einloggen');
line(!!which('ffprobe') || null, 'ffmpeg/ffprobe', 'empfohlen – der Agent prüft Videos damit');
line(!!which('cloudflared') || null, 'cloudflared', 'für Instagram/TikTok nötig');
console.log(`\nDaten: ${DATA_DIR}`);
console.log(problems ? `\n${problems} Punkt(e) offen – siehe docs/SETUP.md\n` : '\nAlles bereit. Start: npm start → http://localhost:' + env('PORT', '4317') + '\n');
