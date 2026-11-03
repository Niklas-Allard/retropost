'use strict';
// Wachsen: Stats der letzten 90 Tage (auch extern gepostete Videos), Rating gegen den Kanal-Median,
// Analyse von Hooks, CTAs, Länge, Hashtags und besten Zeiten, wöchentliche KI-Learnings.
const store = require('./store');
const accounts = require('./accounts');
const platforms = require('./platforms');
const ai = require('./ai');
const { median, log, dryRun, id } = require('./util');

const DAYS = 90;
const STRONG = 1.5, WEAK = 0.5;
const CTA_RE = /(folg|follow|abonnier|subscribe|kommentier|comment|link in (der )?bio|speicher|save|teil|share|like|klick|mehr dazu|schreib)/i;

async function refreshStats(accountIds) {
  const db = store.get();
  const since = Date.now() - DAYS * 86400000;
  const res = { ok: [], failed: [] };
  for (const a of db.accounts.filter(x => !accountIds || accountIds.includes(x.id))) {
    try {
      let items;
      if (dryRun() && !a.tokens) items = demoStats(a);
      else if (!a.tokens) continue;
      else items = await platforms[a.platform].stats({ tokens: await accounts.tokensFor(a), account: a, sinceMs: since });
      const ours = new Map();
      for (const p of db.posts) for (const t of p.targets) if (t.accountId === a.id && t.remoteId) ours.set(String(t.remoteId), p.id);
      for (const k of Object.keys(db.stats)) if (k.startsWith(a.id + ':')) delete db.stats[k];
      for (const it of items) db.stats[`${a.id}:${it.remoteId}`] = { ...it, accountId: a.id, platform: a.platform, projectId: a.projectId, postId: ours.get(String(it.remoteId)) || null, external: !ours.has(String(it.remoteId)), fetchedAt: Date.now() };
      a.statsAt = Date.now(); res.ok.push(a.name);
    } catch (e) { a.lastError = 'Stats: ' + e.message; res.failed.push(`${a.name}: ${e.message}`); log('analytics', a.name, e.message); }
  }
  db.settings.lastStatsAt = Date.now();
  store.save();
  return res;
}

// Demo-Daten im Dry-Run, damit die Analyse-Ansicht ohne echte Konten ausprobiert werden kann
function demoStats(a) {
  const hooks = ['3 Fehler, die du bei X machst', 'Warum niemand über Y spricht', 'Hallo und willkommen zu meinem Video', 'So sparst du 2 Stunden pro Woche', 'Stopp! Mach das nicht mehr', 'Das Geheimnis hinter Z', 'Heute zeige ich euch etwas', 'Du machst es falsch – so geht’s'];
  let seed = [...a.id].reduce((s, c) => s + c.charCodeAt(0), 0);
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  return Array.from({ length: 24 }, (_, i) => {
    const h = hooks[i % hooks.length];
    const base = /hallo|heute/i.test(h) ? 400 : /\d/.test(h) ? 2600 : 1300;
    const d = new Date(Date.now() - (i * 3 + 1) * 86400000); d.setHours([7, 12, 18, 20][i % 4], 0, 0, 0);
    const views = Math.round(base * (0.5 + rnd() * 1.4));
    const tags = ['#tipps', '#produktivität', '#tutorial', '#shorts', '#lernen'].slice(0, 1 + (i % 5));
    return { remoteId: `demo${i}`, title: h, caption: `${h}\n\n${i % 3 ? 'Folg für mehr!' : ''} ${tags.join(' ')}`, publishedAt: d.toISOString(), views, likes: Math.round(views * (0.03 + rnd() * 0.05)), comments: Math.round(views * 0.004 * rnd() * 3), durationSec: [12, 24, 38, 55, 75][i % 5], hashtags: tags, url: null };
  });
}

function rows(projectId, accountId) {
  const all = Object.values(store.get().stats).filter(s => (!projectId || s.projectId === projectId) && (!accountId || s.accountId === accountId));
  const byAcc = {};
  for (const s of all) (byAcc[s.accountId] = byAcc[s.accountId] || []).push(s);
  const out = [];
  for (const [aid, list] of Object.entries(byAcc)) {
    const med = median(list.map(s => s.views));
    for (const s of list) {
      const ratio = med ? s.views / med : 1;
      out.push({ ...s, median: med, ratio: Math.round(ratio * 100) / 100, rating: ratio >= STRONG ? 'strong' : ratio <= WEAK ? 'weak' : 'normal' });
    }
  }
  return out.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

const hookOf = s => String(s.caption || s.title || '').split('\n')[0].trim().slice(0, 120);
const avg = arr => arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : 0;
function groupAvg(list, keyFn) {
  const g = {};
  for (const r of list) { const k = keyFn(r); if (k === null || k === undefined) continue; (g[k] = g[k] || []).push(r.ratio); }
  return Object.entries(g).map(([k, v]) => ({ key: k, n: v.length, avgRatio: Math.round(avg(v) * 100) / 100 })).sort((a, b) => b.avgRatio - a.avgRatio);
}

function insights(projectId, accountId) {
  const r = rows(projectId, accountId);
  const lenBucket = s => s.durationSec == null ? null : s.durationSec < 15 ? '< 15 s' : s.durationSec < 30 ? '15–30 s' : s.durationSec < 45 ? '30–45 s' : s.durationSec <= 60 ? '45–60 s' : '> 60 s';
  const tags = {};
  for (const s of r) for (const t of new Set((s.hashtags || []).map(x => '#' + String(x).replace(/^#/, '').toLowerCase()))) (tags[t] = tags[t] || []).push(s.ratio);
  const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  return {
    count: r.length,
    strong: r.filter(x => x.rating === 'strong').length,
    weak: r.filter(x => x.rating === 'weak').length,
    totals: { views: r.reduce((a, s) => a + (s.views || 0), 0), likes: r.reduce((a, s) => a + (s.likes || 0), 0), comments: r.reduce((a, s) => a + (s.comments || 0), 0) },
    hooks: {
      best: r.filter(x => x.rating === 'strong').slice(0, 6).map(s => ({ hook: hookOf(s), ratio: s.ratio })),
      worst: r.filter(x => x.rating === 'weak').slice(0, 6).map(s => ({ hook: hookOf(s), ratio: s.ratio })),
      features: [
        { key: 'mit Zahl', ...cmp(r, s => /\d/.test(hookOf(s))) },
        { key: 'als Frage', ...cmp(r, s => /\?/.test(hookOf(s))) },
        { key: 'mit „du“', ...cmp(r, s => /\b(du|dein|dir|you)\b/i.test(hookOf(s))) },
        { key: 'Begrüßung', ...cmp(r, s => /^(hallo|hi|hey|heute|willkommen)/i.test(hookOf(s))) },
      ],
    },
    cta: groupAvg(r, s => CTA_RE.test(s.caption || '') ? 'mit CTA' : 'ohne CTA'),
    length: groupAvg(r, lenBucket),
    hashtagCount: groupAvg(r, s => { const n = (s.hashtags || []).length; return n === 0 ? '0' : n <= 2 ? '1–2' : n <= 5 ? '3–5' : '6+'; }),
    topTags: Object.entries(tags).filter(([, v]) => v.length >= 2).map(([k, v]) => ({ key: k, n: v.length, avgRatio: Math.round(avg(v) * 100) / 100 })).sort((a, b) => b.avgRatio - a.avgRatio).slice(0, 12),
    weekday: groupAvg(r, s => WD[new Date(s.publishedAt).getDay()]),
    hour: groupAvg(r, s => String(new Date(s.publishedAt).getHours()).padStart(2, '0') + ':00'),
  };
}
function cmp(r, pred) {
  const a = r.filter(pred), b = r.filter(s => !pred(s));
  return { with: Math.round(avg(a.map(x => x.ratio)) * 100) / 100, without: Math.round(avg(b.map(x => x.ratio)) * 100) / 100, n: a.length };
}

function summaryText(projectId) {
  const i = insights(projectId);
  if (!i.count) return '(noch keine Daten)';
  const f = (l) => l.slice(0, 3).map(x => `${x.key} (×${x.avgRatio}, n=${x.n})`).join(', ');
  const approved = store.get().learnings.filter(l => l.projectId === projectId && l.status === 'approved').map(l => '- ' + l.text).join('\n');
  return `Posts (90 Tage): ${i.count}, stark: ${i.strong}, schwach: ${i.weak}
Beste Hooks: ${i.hooks.best.map(h => `„${h.hook}“ ×${h.ratio}`).join(' | ') || '-'}
Schwache Hooks: ${i.hooks.worst.map(h => `„${h.hook}“ ×${h.ratio}`).join(' | ') || '-'}
CTA: ${f(i.cta)} · Länge: ${f(i.length)} · Hashtag-Anzahl: ${f(i.hashtagCount)}
Beste Wochentage: ${f(i.weekday)} · Beste Uhrzeiten: ${f(i.hour)}
${approved ? 'Bereits freigegebene Learnings:\n' + approved : ''}`;
}

// Wöchentliche Analyse → Learnings-Vorschläge (du gibst sie frei)
async function weeklyAnalysis(projectId) {
  const data = summaryText(projectId);
  if (data === '(noch keine Daten)') throw new Error('Noch keine Statistiken – erst „Stats aktualisieren“.');
  const res = await ai.runJson(`Du bist Short-Form-Video-Analyst. Leite aus diesen Performance-Daten 3–6 konkrete, umsetzbare Learnings für künftige Hooks, Captions, Längen, Hashtags und Posting-Zeiten ab. Keine Wiederholung bereits freigegebener Learnings.\n\n${data}`, { projectId, schemaHint: '{"learnings":[{"text":"...","evidence":"..."}]}' });
  const list = (res.learnings || res || []).filter(l => l && (l.text || typeof l === 'string'));
  const db = store.get();
  const created = list.map(l => ({ id: id('lrn_'), projectId, text: l.text || l, evidence: l.evidence || '', status: 'proposed', createdAt: Date.now() }));
  db.learnings.push(...created);
  db.settings.lastAnalysisAt = { ...(db.settings.lastAnalysisAt || {}), [projectId]: Date.now() };
  store.save();
  return created;
}

async function periodic() {
  const s = store.get().settings;
  if (!s.lastStatsAt || Date.now() - s.lastStatsAt > 6 * 3600000) {
    if (store.get().accounts.some(a => a.tokens)) await refreshStats();
    else s.lastStatsAt = Date.now();
  }
  for (const p of store.get().projects) {
    const last = s.lastAnalysisAt?.[p.id] || 0;
    if (p.weeklyAnalysis !== false && Date.now() - last > 7 * 86400000 && rows(p.id).length >= 5) {
      s.lastAnalysisAt = { ...(s.lastAnalysisAt || {}), [p.id]: Date.now() }; store.save();
      weeklyAnalysis(p.id).then(l => log('analytics', `Wochenanalyse ${p.name}: ${l.length} Learnings vorgeschlagen`)).catch(e => log('analytics', 'Wochenanalyse:', e.message));
    }
  }
}

module.exports = { refreshStats, rows, insights, summaryText, weeklyAnalysis, periodic, STRONG, WEAK };
