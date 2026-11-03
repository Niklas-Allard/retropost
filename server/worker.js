'use strict';
// Posting-Engine: läuft lokal im Hintergrund, postet über die offiziellen APIs.
// Retries nach 1, 5, 15, 60 Minuten. Verpasste Posts gehen innerhalb der Toleranz noch raus.
const store = require('./store');
const posts = require('./posts');
const accounts = require('./accounts');
const platforms = require('./platforms');
const tunnel = require('./tunnel');
const wake = require('./wake');
const { log, dryRun, sleep } = require('./util');

const RETRY_MIN = [1, 5, 15, 60];
const TICK_MS = 20000;
let timer = null;
let busy = false;
const inFlight = new Set();
let lastTick = null;
const listeners = new Set();

const onChange = fn => (listeners.add(fn), () => listeners.delete(fn));
const emit = (type, data) => { for (const fn of listeners) try { fn(type, data); } catch {} };

function running() { return !!timer; }
function start() {
  if (timer) return;
  timer = setInterval(() => tick().catch(e => log('worker', e)), TICK_MS);
  setTimeout(() => tick().catch(e => log('worker', e)), 1500);
  log('worker', 'Worker gestartet');
}
function stop() { clearInterval(timer); timer = null; log('worker', 'Worker gestoppt'); }

function plog(p, msg) { p.log = [...(p.log || []), { at: Date.now(), msg }].slice(-40); }

async function postTarget(p, t, { publishAt } = {}) {
  const key = p.id + ':' + t.accountId;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  const a = store.find('accounts', t.accountId);
  const prev = t.status;
  t.status = 'posting'; p.status = 'posting'; store.save(); emit('post', p.id);
  try {
    if (!a) throw new Error('Konto wurde gelöscht');
    if (a.platform === 'tiktok' && a.tiktokMode === 'studio') {
      queueStudioJob(p, t, a);
      t.status = 'awaiting_user'; t.note = 'Wartet auf dich in TikTok Studio (Extension) – dort auf „Posten“ klicken';
      plog(p, `TikTok Studio-Job für ${a.name} bereit`);
      return;
    }
    let res;
    if (dryRun()) {
      await sleep(800);
      if (p.caption?.includes('#fail')) throw new Error('Simulierter Fehler (#fail in der Caption)');
      res = { remoteId: 'dry_' + Math.random().toString(36).slice(2, 10), url: null, note: 'Dry-Run – nicht wirklich gepostet', scheduledRemote: !!publishAt };
    } else {
      const tokens = await accounts.tokensFor(a);
      res = await platforms[a.platform].publish({
        tokens, account: a, post: p, target: t, publishAt,
        mediaUrl: f => tunnel.mediaUrl(f),
        saveTarget: patch => { Object.assign(t, patch); store.save(); },
      });
    }
    Object.assign(t, { status: res.scheduledRemote ? 'scheduled_remote' : 'posted', remoteId: res.remoteId, url: res.url, note: res.note || null, error: null, postedAt: Date.now(), upload: undefined });
    plog(p, `${a.platform}/${a.name}: ${res.scheduledRemote ? 'vorab hochgeladen, veröffentlicht automatisch' : 'gepostet'}`);
    log('worker', `OK ${p.id} → ${a.platform}/${a.name} ${res.remoteId}`);
  } catch (e) {
    t.attempts = (t.attempts || 0) + 1;
    t.error = e.message;
    if (t.attempts <= RETRY_MIN.length) {
      t.status = prev === 'scheduled_remote' ? prev : 'pending';
      t.nextAttemptAt = Date.now() + RETRY_MIN[t.attempts - 1] * 60000;
      plog(p, `Fehler (${a?.name}): ${e.message} – neuer Versuch in ${RETRY_MIN[t.attempts - 1]} min`);
    } else {
      t.status = 'failed';
      plog(p, `Endgültig fehlgeschlagen (${a?.name}): ${e.message}`);
    }
    log('worker', `FEHLER ${p.id} → ${a?.platform}: ${e.message}`);
  } finally {
    inFlight.delete(key);
    p.status = posts.derive(p);
    p.updatedAt = Date.now();
    store.save(); emit('post', p.id);
  }
}

function queueStudioJob(p, t, a) {
  const db = store.get();
  if (db.extJobs.some(j => j.postId === p.id && j.accountId === a.id && j.status !== 'done')) return;
  db.extJobs.push({ id: 'job_' + Math.random().toString(36).slice(2, 10), postId: p.id, accountId: a.id, status: 'queued', createdAt: Date.now() });
}

async function tick() {
  if (busy) return;
  busy = true; lastTick = Date.now();
  try {
    const db = store.get();
    const s = db.settings;
    const now = Date.now();
    const tol = (Number(s.toleranceMin) || 120) * 60000;
    const ahead = (Number(s.uploadAheadDays) || 0) * 86400000;
    const jobs = [];
    for (const p of db.posts) {
      if (!['approved', 'posting'].includes(p.status) || !p.scheduledAt) continue;
      const due = new Date(p.scheduledAt).getTime();
      for (const t of p.targets) {
        if (t.nextAttemptAt && t.nextAttemptAt > now) continue;
        // YouTube: vorab mit publishAt hochladen → veröffentlicht auch bei ausgeschaltetem Rechner
        if (t.platform === 'youtube' && ahead && t.status === 'pending' && due - now > 15 * 60000 && due - now < ahead) { jobs.push(() => postTarget(p, t, { publishAt: new Date(due).toISOString() })); continue; }
        if (t.platform === 'youtube' && t.status === 'scheduled_remote' && t.needsReschedule) { jobs.push(() => rescheduleYt(p, t)); continue; }
        if (t.status !== 'pending' || now < due) continue;
        if (now - due > tol && !t.attempts) {
          t.status = 'failed'; t.error = `Verpasst: Rechner war aus/Worker gestoppt (Toleranz ${s.toleranceMin} min überschritten). Neu planen oder „Erneut senden“.`;
          plog(p, t.error); p.status = posts.derive(p); store.save(); emit('post', p.id); continue;
        }
        jobs.push(() => postTarget(p, t));
      }
      const st = posts.derive(p);
      if (st !== p.status && !p.targets.some(t => t.status === 'posting')) { p.status = st; store.save(); emit('post', p.id); }
    }
    // parallel pro Konto, aber nicht mehr als 3 gleichzeitig
    for (let i = 0; i < jobs.length; i += 3) await Promise.all(jobs.slice(i, i + 3).map(j => j()));

    if (!dryRun()) await accounts.renewAll();
    if (s.wakeEnabled) {
      const next = db.posts.filter(p => p.status === 'approved' && p.scheduledAt && new Date(p.scheduledAt) > new Date()).map(p => new Date(p.scheduledAt)).sort((a, b) => a - b)[0];
      if (next) wake.schedule(next);
    }
    // periodische Jobs (Stats, Analyse, Automationen) – lazy require gegen Zyklen
    await require('./automation').tick().catch(e => log('automation', e));
    await require('./analytics').periodic().catch(e => log('analytics', e));
  } finally { busy = false; }
}

async function rescheduleYt(p, t) {
  const a = store.find('accounts', t.accountId);
  try {
    if (!dryRun()) await platforms.youtube.reschedule({ tokens: await accounts.tokensFor(a), remoteId: t.remoteId, publishAt: new Date(p.scheduledAt).toISOString() });
    t.needsReschedule = false; plog(p, 'YouTube-Veröffentlichungszeit aktualisiert'); store.save();
  } catch (e) { t.error = 'Verschieben auf YouTube: ' + e.message; store.save(); }
}

// TikTok-Studio-Extension meldet „gepostet“
function studioDone(jobId, url) {
  const db = store.get();
  const j = db.extJobs.find(x => x.id === jobId);
  if (!j) throw new Error('Job nicht gefunden');
  j.status = 'done'; j.doneAt = Date.now();
  const p = store.find('posts', j.postId);
  const t = p?.targets.find(x => x.accountId === j.accountId);
  if (t) { t.status = 'posted'; t.url = url || null; t.note = 'Über TikTok Studio gepostet'; t.postedAt = Date.now(); plog(p, 'TikTok Studio: gepostet'); p.status = posts.derive(p); }
  store.save(); if (p) emit('post', p.id);
}

function markPosted(postId, accountId) {
  const p = store.find('posts', postId);
  const t = p.targets.find(x => x.accountId === accountId);
  t.status = 'posted'; t.postedAt = Date.now(); t.note = 'Manuell als gepostet markiert'; t.error = null;
  for (const j of store.get().extJobs) if (j.postId === postId && j.accountId === accountId) j.status = 'done';
  p.status = posts.derive(p); store.save(); emit('post', p.id);
  return p;
}

const status = () => ({ running: running(), lastTick, inFlight: [...inFlight], dryRun: dryRun(), wake: wake.status() });

module.exports = { start, stop, tick, status, running, onChange, studioDone, markPosted, RETRY_MIN };
