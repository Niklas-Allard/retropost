#!/usr/bin/env node
'use strict';
// Supervisor: startet die App und startet sie nach einem Absturz automatisch neu (mit Backoff).
const { fork } = require('node:child_process');
const path = require('node:path');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`RetroPost braucht Node.js ≥ 22.5 (du hast ${process.versions.node}).`);
  process.exit(1);
}

let child = null;
let restarts = [];
let stopping = false;

function start() {
  child = fork(path.join(__dirname, 'app.js'), process.argv.slice(2), { stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping || code === 0 || code === 3) process.exit(code === 3 ? 0 : code || 0);
    const now = Date.now();
    restarts = restarts.filter(t => now - t < 10 * 60 * 1000);
    restarts.push(now);
    const delay = Math.min(60000, 1000 * 2 ** Math.min(restarts.length - 1, 6));
    console.error(`[supervisor] RetroPost abgestürzt (code=${code}, signal=${signal}) – Neustart in ${delay / 1000}s`);
    setTimeout(start, delay);
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopping = true; if (child) child.kill(sig); else process.exit(0); });
start();
