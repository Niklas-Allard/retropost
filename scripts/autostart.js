#!/usr/bin/env node
'use strict';
// Autostart beim Login: macOS (launchd), Linux (systemd --user), Windows (Autostart-Ordner).
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath;
const ENTRY = path.join(ROOT, 'server', 'index.js');
const action = process.argv[2] || 'install';
const sh = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'inherit' }); } catch {} };

if (process.platform === 'darwin') {
  const f = path.join(os.homedir(), 'Library', 'LaunchAgents', 'de.retropost.app.plist');
  if (action === 'uninstall') { sh('launchctl', ['unload', f]); fs.rmSync(f, { force: true }); console.log('Entfernt.'); process.exit(0); }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>de.retropost.app</string>
  <key>ProgramArguments</key><array><string>${NODE}</string><string>${ENTRY}</string></array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${process.env.PATH}</string></dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${path.join(os.homedir(), 'Library', 'Logs', 'retropost.out.log')}</string>
  <key>StandardErrorPath</key><string>${path.join(os.homedir(), 'Library', 'Logs', 'retropost.err.log')}</string>
</dict></plist>`);
  sh('launchctl', ['unload', f]); sh('launchctl', ['load', f]);
  console.log('Installiert: ' + f);
} else if (process.platform === 'linux') {
  const f = path.join(os.homedir(), '.config', 'systemd', 'user', 'retropost.service');
  if (action === 'uninstall') { sh('systemctl', ['--user', 'disable', '--now', 'retropost']); fs.rmSync(f, { force: true }); console.log('Entfernt.'); process.exit(0); }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `[Unit]\nDescription=RetroPost\nAfter=network-online.target\n\n[Service]\nWorkingDirectory=${ROOT}\nExecStart=${NODE} ${ENTRY}\nEnvironment=PATH=${process.env.PATH}\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n`);
  sh('systemctl', ['--user', 'daemon-reload']); sh('systemctl', ['--user', 'enable', '--now', 'retropost']);
  console.log('Installiert: ' + f + '\nTipp (Server ohne Login): sudo loginctl enable-linger $USER');
} else if (process.platform === 'win32') {
  const dir = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
  const f = path.join(dir, 'RetroPost.vbs');
  if (action === 'uninstall') { fs.rmSync(f, { force: true }); console.log('Entfernt.'); process.exit(0); }
  fs.writeFileSync(f, `Set sh = CreateObject("WScript.Shell")\nsh.CurrentDirectory = "${ROOT}"\nsh.Run """${NODE}"" ""${ENTRY}""", 0, False\n`);
  console.log('Installiert: ' + f + ' (startet beim nächsten Login unsichtbar)');
} else console.log('Plattform nicht unterstützt: ' + process.platform);
