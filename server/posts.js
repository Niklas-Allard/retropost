'use strict';
// Posts: aus Backlog erzeugen, bearbeiten (mit Undo), planen, freigeben, Slots füllen.
const store = require('./store');
const backlog = require('./backlog');
const { id } = require('./util');

const EDITABLE = ['title', 'caption', 'hashtags', 'format'];
const DONE = ['posted', 'scheduled_remote'];

function formatFits(platform, format, hasVideo) {
  if (platform === 'youtube') return hasVideo;
  if (platform === 'instagram') return true;
  if (platform === 'tiktok') return format !== 'story';
  return false;
}

function defaultTargets(projectId, item, accountIds) {
  const accs = store.get().accounts.filter(a => a.projectId === projectId);
  const chosen = accountIds?.length ? accs.filter(a => accountIds.includes(a.id))
    : accs.filter(a => (!item.platforms || item.platforms.includes(a.platform)) && formatFits(a.platform, item.format, !!item.video));
  return chosen.map(a => ({ accountId: a.id, platform: a.platform, status: 'pending', attempts: 0 }));
}

function normTags(h) {
  if (typeof h === 'string') h = h.split(/[\s,]+/);
  return [...new Set((h || []).map(x => String(x).trim().replace(/^#*/, '')).filter(Boolean))];
}

function fromBacklog(bid, { status = 'review', scheduledAt = null, accountIds, source = 'backlog' } = {}) {
  const it = backlog.findItem(bid);
  if (!it) throw new Error('Backlog-Eintrag nicht gefunden');
  const db = store.get();
  const existing = db.posts.find(p => p.backlogId === bid && !['posted'].includes(p.status));
  if (existing) return existing;
  const p = {
    id: id('post_'), projectId: it.projectId, backlogId: bid, folder: it.path,
    title: it.title, caption: it.caption, hashtags: normTags(it.hashtags), format: it.format,
    mediaPath: it.video, images: it.images, thumb: it.thumb,
    targets: defaultTargets(it.projectId, it, accountIds),
    scheduledAt, status, history: [], createdAt: Date.now(), updatedAt: Date.now(), source, sessionId: it.sessionId || null, log: [],
  };
  db.posts.push(p);
  backlog.setStatus(bid, { status: 'planned', postId: p.id });
  store.save();
  return p;
}

function edit(postId, patch) {
  const p = store.find('posts', postId);
  if (!p) throw new Error('Post nicht gefunden');
  const snap = Object.fromEntries(EDITABLE.map(k => [k, p[k]]));
  let changed = false;
  for (const k of EDITABLE) if (patch[k] !== undefined) {
    const v = k === 'hashtags' ? normTags(patch[k]) : patch[k];
    if (JSON.stringify(v) !== JSON.stringify(p[k])) { p[k] = v; changed = true; }
  }
  if (changed) { p.history.push(snap); p.history = p.history.slice(-50); }
  if (patch.targets) {
    const old = Object.fromEntries(p.targets.map(t => [t.accountId, t]));
    p.targets = patch.targets.map(aid => old[aid] || { accountId: aid, platform: store.find('accounts', aid)?.platform, status: 'pending', attempts: 0 });
  }
  if (patch.scheduledAt !== undefined) schedule(p, patch.scheduledAt);
  p.updatedAt = Date.now();
  store.save();
  return p;
}

function undo(postId) {
  const p = store.find('posts', postId);
  const snap = p?.history.pop();
  if (!snap) throw new Error('Nichts zum Rückgängigmachen');
  Object.assign(p, snap); p.updatedAt = Date.now(); store.save();
  return p;
}

// Verschieben: alle Konten des Posts wandern gemeinsam mit.
function schedule(p, when) {
  p.scheduledAt = when ? new Date(when).toISOString() : null;
  for (const t of p.targets) {
    if (t.status === 'scheduled_remote') t.needsReschedule = true;
    if (t.status === 'failed' && /verpasst/i.test(t.error || '')) { t.status = 'pending'; t.error = null; t.attempts = 0; }
  }
  if (p.status === 'failed' && p.targets.some(t => t.status === 'pending')) p.status = 'approved';
}

function approve(postIds) {
  const res = [];
  for (const pid of postIds) {
    const p = store.find('posts', pid);
    if (!p || !['review', 'draft'].includes(p.status)) continue;
    if (!p.scheduledAt) { const slot = nextFreeSlots(p.projectId, 1)[0]; if (slot) { p.scheduledAt = slot.at; if (slot.accountIds?.length) p.targets = defaultTargets(p.projectId, { format: p.format, video: p.mediaPath }, slot.accountIds); } }
    if (!p.scheduledAt) { p.lastError = 'Kein Zeitpunkt und kein freier Slot'; continue; }
    if (!p.targets.length) { p.lastError = 'Keine Konten ausgewählt'; continue; }
    p.status = 'approved'; p.approvedAt = Date.now(); p.updatedAt = Date.now();
    res.push(p);
  }
  store.save();
  return res;
}

function retry(postId) {
  const p = store.find('posts', postId);
  for (const t of p.targets) if (t.status === 'failed') { t.status = 'pending'; t.attempts = 0; t.error = null; t.nextAttemptAt = null; }
  if (p.scheduledAt && new Date(p.scheduledAt) < new Date(Date.now() - 60000)) p.scheduledAt = new Date().toISOString();
  p.status = 'approved'; p.updatedAt = Date.now(); store.save();
  return p;
}

function derive(p) {
  if (!['approved', 'posting', 'failed'].includes(p.status)) return p.status;
  const ts = p.targets;
  if (!ts.length) return p.status;
  const due = p.scheduledAt && new Date(p.scheduledAt) <= new Date();
  if (ts.every(t => DONE.includes(t.status)) && (due || ts.every(t => t.status === 'posted'))) return 'posted';
  if (ts.some(t => t.status === 'failed') && ts.every(t => DONE.includes(t.status) || t.status === 'failed')) return 'failed';
  if (ts.some(t => t.status === 'posting')) return 'posting';
  return 'approved';
}

// ── Posting-Slots ──
// slot: { id, weekday: 0-6 (So=0), time: "HH:MM", accountIds: [] }
function slotInstances(project, fromDate, days) {
  const out = [];
  const start = new Date(fromDate); start.setHours(0, 0, 0, 0);
  for (let d = 0; d < days; d++) {
    const day = new Date(start); day.setDate(start.getDate() + d);
    for (const s of project.slots || []) {
      if (Number(s.weekday) !== day.getDay()) continue;
      const [h, m] = s.time.split(':').map(Number);
      const at = new Date(day); at.setHours(h, m, 0, 0);
      if (at <= fromDate) continue;
      out.push({ slotId: s.id, at: at.toISOString(), accountIds: s.accountIds || [], projectId: project.id });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

function nextFreeSlots(projectId, n, days = 28) {
  const project = store.find('projects', projectId);
  if (!project) return [];
  const taken = new Set(store.get().posts.filter(p => p.projectId === projectId && p.scheduledAt && p.status !== 'archived').map(p => new Date(p.scheduledAt).getTime()));
  return slotInstances(project, new Date(), days).filter(s => !taken.has(new Date(s.at).getTime())).slice(0, n);
}

// Freie Slots aus dem Backlog (und ungeplanten Posts) füllen
function fillSlots(projectId, { days = 14, approveDirectly = false } = {}) {
  const free = nextFreeSlots(projectId, 999, days);
  const db = store.get();
  const unscheduled = db.posts.filter(p => p.projectId === projectId && !p.scheduledAt && ['review', 'draft', 'approved'].includes(p.status));
  const project = store.find('projects', projectId);
  const fresh = backlog.scan(project).filter(i => i.status === 'new' && !i.error).reverse(); // älteste zuerst
  const filled = [];
  for (const slot of free) {
    let p = unscheduled.shift();
    if (!p) { const it = fresh.shift(); if (!it) break; p = fromBacklog(it.id, { status: 'review', accountIds: slot.accountIds }); }
    p.scheduledAt = slot.at;
    if (slot.accountIds.length) p.targets = defaultTargets(projectId, { format: p.format, video: p.mediaPath }, slot.accountIds);
    if (approveDirectly) p.status = 'approved';
    filled.push(p);
  }
  store.save();
  return filled;
}

module.exports = { fromBacklog, edit, undo, approve, retry, derive, schedule, slotInstances, nextFreeSlots, fillSlots, normTags, defaultTargets };
