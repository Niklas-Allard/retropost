'use strict';
// Rechner zum nächsten fälligen Post aufwecken (best effort, teils Admin-Rechte nötig).
const { execFile } = require('node:child_process');
const path = require('node:path');
const { log, ROOT } = require('./util');

let scheduledFor = null;
let lastResult = null;

const pad = n => String(n).padStart(2, '0');

function schedule(date) {
  if (!date) return;
  const t = new Date(date.getTime() - 2 * 60 * 1000); // 2 min vorher
  if (t < new Date()) return;
  if (scheduledFor && Math.abs(scheduledFor - t) < 60000) return;
  scheduledFor = t;
  const done = (cmd) => (err, _o, stderr) => {
    lastResult = { at: Date.now(), for: t.toISOString(), ok: !err, cmd, error: err ? (stderr || err.message).toString().slice(0, 300) : null };
    log('wake', err ? `Wecken fehlgeschlagen (${cmd}): ${lastResult.error}` : `Wecken geplant für ${t.toLocaleString()}`);
  };
  if (process.platform === 'darwin') {
    const s = `${pad(t.getMonth() + 1)}/${pad(t.getDate())}/${String(t.getFullYear()).slice(2)} ${pad(t.getHours())}:${pad(t.getMinutes())}:00`;
    execFile('sudo', ['-n', 'pmset', 'schedule', 'wake', s], done('pmset'));
  } else if (process.platform === 'linux') {
    execFile('sudo', ['-n', 'rtcwake', '-m', 'no', '-t', String(Math.floor(t.getTime() / 1000))], done('rtcwake'));
  } else if (process.platform === 'win32') {
    const node = process.execPath.replace(/'/g, "''");
    const script = path.join(ROOT, 'server', 'index.js').replace(/'/g, "''");
    const ps = `$a=New-ScheduledTaskAction -Execute '${node}' -Argument '"${script}"'; ` +
      `$tr=New-ScheduledTaskTrigger -Once -At '${t.toISOString()}'; ` +
      `$s=New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; ` +
      `Register-ScheduledTask -TaskName 'RetroPostWake' -Action $a -Trigger $tr -Settings $s -Force | Out-Null`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], done('ScheduledTask'));
  }
}

const status = () => ({ scheduledFor: scheduledFor?.toISOString() || null, lastResult });
module.exports = { schedule, status };
