'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR, log } = require('./util');

const FILE = path.join(DATA_DIR, 'db.json');

const DEFAULTS = () => ({
  version: 1,
  projects: [],
  accounts: [],
  posts: [],
  backlog: {},        // id -> { status, sessionId, firstSeen, path }
  sessions: [],
  automations: [],
  stats: {},          // `${accountId}:${remoteId}` -> stat
  learnings: [],
  approvals: [],
  extJobs: [],        // TikTok-Studio-Jobs für die Extension
  settings: {
    toleranceMin: 120,
    uploadAheadDays: 7,
    workerEnabled: true,
    gatewayEnabled: true,
    tunnelEnabled: false,
    wakeEnabled: false,
    defaultAgent: 'claude',
    lastStatsAt: null,
    lastAnalysisAt: {},
    theme: 'console',
  },
});

let db = null;
let timer = null;

function load() {
  if (db) return db;
  try {
    db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const d = DEFAULTS();
    for (const k of Object.keys(d)) if (db[k] === undefined) db[k] = d[k];
    db.settings = { ...d.settings, ...db.settings };
  } catch (e) {
    if (fs.existsSync(FILE)) {
      const bak = FILE + '.corrupt-' + Date.now();
      fs.copyFileSync(FILE, bak);
      log('store', 'db.json defekt, Sicherung:', bak);
    }
    db = DEFAULTS();
    flush();
  }
  return db;
}

function flush() {
  clearTimeout(timer); timer = null;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, FILE);
}

function save() {
  if (timer) return;
  timer = setTimeout(() => { try { flush(); } catch (e) { log('store', e); } }, 150);
}

process.on('exit', () => { if (timer) try { flush(); } catch {} });

const get = () => load();
const find = (coll, id) => load()[coll].find(x => x.id === id);
function remove(coll, id) { const d = load(); d[coll] = d[coll].filter(x => x.id !== id); save(); }

module.exports = { get, save, flush, find, remove, FILE };
