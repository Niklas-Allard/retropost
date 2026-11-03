'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ROOT, DATA_DIR, LOG_FILE, log, tailLog, env, mime, id, dryRun, which } = require('./util');
const store = require('./store');
const secrets = require('./secrets');
const backlog = require('./backlog');
const posts = require('./posts');
const accounts = require('./accounts');
const worker = require('./worker');
const tunnel = require('./tunnel');
const agent = require('./agent');
const automation = require('./automation');
const analytics = require('./analytics');
const ai = require('./ai');
const perms = require('./permissions');
const platforms = require('./platforms');

const PORT = Number(env('PORT', '4317'));
const GW_PORT = Number(env('GATEWAY_PORT', '4318'));
const PUBLIC = path.join(ROOT, 'public');

// ── Helfer ───────────────────────────────────────────────────────────
function send(res, code, body, headers = {}) {
  const isStr = typeof body === 'string' || Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(isStr ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ''; req.on('data', c => { d += c; if (d.length > 5e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { reject(Object.assign(new Error('Ungültiges JSON'), { status: 400 })); } });
  });
}
function serveFile(req, res, file, extraHeaders = {}) {
  let st; try { st = fs.statSync(file); } catch { return send(res, 404, 'Nicht gefunden'); }
  if (!st.isFile()) return send(res, 404, 'Nicht gefunden');
  const type = mime(file);
  const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (range) {
    const start = range[1] ? +range[1] : st.size - +range[2];
    const end = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...extraHeaders });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', ...extraHeaders });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}
const html = (title, msg, ok = true) => `<!doctype html><meta charset=utf-8><title>${title}</title><body style="background:#14122b;color:#f4f1de;font:20px monospace;display:grid;place-items:center;height:100vh;margin:0"><div style="border:4px solid ${ok ? '#3ce08c' : '#ff4d6d'};padding:32px;max-width:560px;text-align:center"><h1 style="font-size:22px">${title}</h1><p>${msg}</p><p>Du kannst dieses Fenster schließen.</p></div><script>setTimeout(()=>{try{window.opener&&window.opener.postMessage('retropost-oauth','*')}catch(e){}},300)</script>`;

// Pfad-Freigabe für Vorschau: nur Dateien innerhalb von Projekt-Repos / Content-Ordnern
function allowedFile(f) {
  const r = path.resolve(f);
  return store.get().projects.some(p => [p.repoPath, ...backlog.contentDirs(p)].filter(Boolean).some(d => r.startsWith(path.resolve(d) + path.sep)));
}

// ── Server-Sent Events ───────────────────────────────────────────────
const sseClients = new Set();
function broadcast(type, data) { const m = `event: ${type}\ndata: ${JSON.stringify(data ?? {})}\n\n`; for (const c of sseClients) c.write(m); }
worker.onChange((t, d) => broadcast(t, { id: d }));
agent.onSessions(() => broadcast('sessions', {}));
setInterval(() => { for (const c of sseClients) c.write(': ping\n\n'); }, 25000);

// ── Router ───────────────────────────────────────────────────────────
const routes = [];
const r = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

const publicProject = p => ({ ...p, permissions: p.permissions || { allow: perms.DEFAULT_ALLOW } });

r('GET', '/api/state', () => {
  const db = store.get();
  return {
    settings: db.settings, projects: db.projects.map(publicProject), accounts: db.accounts.map(accounts.publicAccount),
    agents: ai.available(), worker: worker.status(), tunnel: tunnel.status(), gateway: { running: !!gateway?.listening, port: GW_PORT },
    sessionsRunning: agent.runningCount(), maxSessions: agent.MAX_RUNNING,
    platforms: Object.fromEntries(Object.values(platforms).map(p => [p.name, { label: p.label, configured: p.configured(), redirectUri: (() => { try { return p.redirectUri(); } catch { return null; } })(), formats: p.formats }])),
    counts: { review: db.posts.filter(p => p.status === 'review').length, failed: db.posts.filter(p => p.status === 'failed').length, proposed: db.learnings.filter(l => l.status === 'proposed').length, awaiting: db.extJobs.filter(j => j.status !== 'done').length },
    dataDir: DATA_DIR, logFile: LOG_FILE, dbFile: store.FILE, keyBackend: secrets.backend(), dryRun: dryRun(), version: require('../package.json').version,
  };
});

// Projekte
r('GET', '/api/projects', () => store.get().projects.map(publicProject));
r('POST', '/api/projects', async ({ body }) => {
  if (!body.name) throw bad('Name fehlt');
  const p = { id: id('prj_'), name: body.name, repoPath: path.resolve(body.repoPath || path.join(DATA_DIR, 'projects', body.name.replace(/\W+/g, '-').toLowerCase())), contentDirs: body.contentDirs?.length ? body.contentDirs : ['content/shorts'], agent: body.agent || store.get().settings.defaultAgent, helperAgent: body.helperAgent || '', helperTask: body.helperTask || '', aiNotes: body.aiNotes || '', permissions: { allow: [...perms.DEFAULT_ALLOW] }, slots: [], color: body.color || pickColor(), weeklyAnalysis: true, createdAt: Date.now() };
  for (const d of backlog.contentDirs(p)) fs.mkdirSync(d, { recursive: true });
  store.get().projects.push(p); store.save();
  return p;
});
r('PUT', '/api/projects/:id', ({ params, body }) => {
  const p = store.find('projects', params.id); if (!p) throw notFound();
  for (const k of ['name', 'repoPath', 'contentDirs', 'agent', 'helperAgent', 'helperTask', 'aiNotes', 'slots', 'color', 'weeklyAnalysis']) if (body[k] !== undefined) p[k] = body[k];
  if (body.permissions) {
    const v = perms.validate(body.permissions.allow);
    p.permissions = { allow: v.ok };
    if (v.rejected.length) p.permissionsRejected = v.rejected;
  }
  if (body.slots) p.slots = body.slots.map(s => ({ id: s.id || id('slot_'), weekday: Number(s.weekday), time: s.time, accountIds: s.accountIds || [] }));
  store.save(); return { ...publicProject(p), rejected: p.permissionsRejected || [] };
});
r('DELETE', '/api/projects/:id', ({ params }) => { store.remove('projects', params.id); return { ok: true }; });
const COLORS = ['#ff5fa2', '#38e1ff', '#ffd23f', '#3ce08c', '#b58cff', '#ff8a3d'];
const pickColor = () => COLORS[store.get().projects.length % COLORS.length];

// Konten
r('GET', '/api/accounts', () => store.get().accounts.map(accounts.publicAccount));
r('POST', '/api/accounts', ({ body }) => accounts.publicAccount(accounts.create(body)));
r('PUT', '/api/accounts/:id', ({ params, body }) => {
  const a = store.find('accounts', params.id); if (!a) throw notFound();
  for (const k of ['name', 'chromeProfile', 'tiktokMode', 'projectId']) if (body[k] !== undefined) a[k] = body[k];
  store.save(); return accounts.publicAccount(a);
});
r('DELETE', '/api/accounts/:id', ({ params }) => { store.remove('accounts', params.id); return { ok: true }; });
r('POST', '/api/accounts/:id/connect', ({ params }) => {
  const url = accounts.connectUrl(params.id);
  const a = store.find('accounts', params.id);
  return { url, openedInProfile: accounts.openInProfile(url, a.chromeProfile) };
});
r('POST', '/api/accounts/:id/disconnect', ({ params }) => { accounts.disconnect(params.id); return { ok: true }; });

// OAuth-Callback (YouTube lokal; Instagram/TikTok über Gateway)
async function oauthCallback(platform, url, res) {
  const q = url.searchParams;
  if (q.get('error')) return send(res, 400, html('Verbindung abgebrochen', q.get('error_description') || q.get('error'), false), { 'Content-Type': 'text/html; charset=utf-8' });
  try {
    const a = await accounts.handleCallback(platform, q.get('code'), q.get('state'));
    broadcast('accounts', {});
    send(res, 200, html('Konto verbunden ✔', `${platforms[platform].label}: <b>${a.identity.handle}</b> ist jetzt mit RetroPost verbunden.`), { 'Content-Type': 'text/html; charset=utf-8' });
  } catch (e) {
    log('oauth', platform, e.message);
    send(res, 400, html('Verbindung fehlgeschlagen', e.message, false), { 'Content-Type': 'text/html; charset=utf-8' });
  }
}

// Backlog
r('GET', '/api/backlog', ({ url }) => {
  const pid = url.searchParams.get('projectId');
  const items = pid ? backlog.scan(store.find('projects', pid) || { id: pid, contentDirs: [] }) : backlog.scanAll();
  return items;
});
r('POST', '/api/backlog/:id/status', ({ params, body }) => { backlog.setStatus(params.id, { status: body.status }); return { ok: true }; });
r('POST', '/api/backlog/handoff', ({ body }) => {
  const folder = path.resolve(body.folder || '');
  const project = store.get().projects.find(p => backlog.contentDirs(p).some(d => folder.startsWith(path.resolve(d) + path.sep))) || store.find('projects', body.projectId);
  if (!project) throw bad('Ordner liegt in keinem Content-Ordner eines Projekts: ' + folder);
  if (!backlog.readFolder(folder)) throw bad('Kein Video/Bild im Ordner gefunden');
  const item = backlog.scan(project).find(i => path.resolve(i.path) === folder);
  if (!item) throw bad('Ordner liegt nicht direkt in einem Content-Ordner (erwartet: <content-dir>/<short-ordner>)');
  const patch = {};
  if (body.sessionId) patch.sessionId = body.sessionId;
  backlog.setStatus(item.id, patch);
  const s = body.sessionId && store.find('sessions', body.sessionId);
  if (s && !s.handoffs.includes(item.id)) { s.handoffs.push(item.id); store.save(); broadcast('sessions', {}); }
  let post = null;
  if (body.toReview || s?.automationId) post = posts.fromBacklog(item.id, { status: 'review', source: s?.automationId ? 'automation' : 'studio' });
  broadcast('backlog', {});
  return { ok: true, backlogId: item.id, postId: post?.id || null, message: `Übergeben: ${item.title}` };
});

// Posts
r('GET', '/api/posts', ({ url }) => {
  const q = url.searchParams;
  let list = store.get().posts;
  if (q.get('projectId')) list = list.filter(p => p.projectId === q.get('projectId'));
  if (q.get('status')) list = list.filter(p => q.get('status').split(',').includes(p.status));
  if (q.get('from')) list = list.filter(p => p.scheduledAt && p.scheduledAt >= q.get('from'));
  if (q.get('to')) list = list.filter(p => p.scheduledAt && p.scheduledAt < q.get('to'));
  return list.map(({ history, ...p }) => ({ ...p, canUndo: history.length > 0 }));
});
r('GET', '/api/posts/:id', ({ params }) => { const p = store.find('posts', params.id); if (!p) throw notFound(); const { history, ...rest } = p; return { ...rest, canUndo: history.length > 0 }; });
r('POST', '/api/posts/from-backlog', ({ body }) => {
  const ids = body.backlogIds || [body.backlogId];
  const out = [];
  for (const bid of ids) {
    const p = posts.fromBacklog(bid, { status: body.status || 'review', scheduledAt: body.scheduledAt || null, accountIds: body.accountIds });
    if (body.autoSlot && !p.scheduledAt) { const s = posts.nextFreeSlots(p.projectId, 1)[0]; if (s) { p.scheduledAt = s.at; if (s.accountIds.length) p.targets = posts.defaultTargets(p.projectId, { format: p.format, video: p.mediaPath }, s.accountIds); } }
    out.push(p);
  }
  store.save(); broadcast('posts', {});
  return body.backlogIds ? out : out[0];
});
r('PUT', '/api/posts/:id', ({ params, body }) => { const p = posts.edit(params.id, body); broadcast('posts', {}); return p; });
r('POST', '/api/posts/:id/undo', ({ params }) => posts.undo(params.id));
r('POST', '/api/posts/approve', ({ body }) => {
  const db = store.get();
  const ids = body.all ? db.posts.filter(p => p.status === 'review' && (!body.projectId || p.projectId === body.projectId)).map(p => p.id) : body.ids || [];
  const res = posts.approve(ids); broadcast('posts', {});
  return { approved: res.length, skipped: ids.length - res.length };
});
r('POST', '/api/posts/:id/reject', ({ params }) => {
  const p = store.find('posts', params.id);
  store.remove('posts', p.id);
  if (p.backlogId) backlog.setStatus(p.backlogId, { status: 'new', postId: null });
  broadcast('posts', {}); return { ok: true };
});
r('POST', '/api/posts/:id/retry', ({ params }) => { const p = posts.retry(params.id); worker.tick().catch(() => {}); broadcast('posts', {}); return p; });
r('POST', '/api/posts/:id/mark-posted', ({ params, body }) => worker.markPosted(params.id, body.accountId));
r('DELETE', '/api/posts/:id', ({ params }) => {
  const p = store.find('posts', params.id); if (!p) throw notFound();
  if (p.targets.some(t => ['posted', 'scheduled_remote'].includes(t.status))) throw bad('Teilweise bereits gepostet – kann nicht entfernt werden. (YouTube-Vorab-Uploads bitte in YouTube Studio löschen.)');
  store.remove('posts', p.id);
  if (p.backlogId) backlog.setStatus(p.backlogId, { status: 'new', postId: null });
  broadcast('posts', {}); return { ok: true };
});
r('POST', '/api/posts/fill-slots', ({ body }) => { const res = posts.fillSlots(body.projectId, { days: body.days || 14 }); broadcast('posts', {}); return { filled: res.length }; });
r('GET', '/api/slots', ({ url }) => {
  const from = new Date(url.searchParams.get('from') || Date.now());
  const days = Number(url.searchParams.get('days') || 42);
  return store.get().projects.flatMap(p => posts.slotInstances(p, from, days));
});

// KI-Editor-Werkzeuge
r('POST', '/api/ai/hook', async ({ body }) => {
  const local = ai.hookScore(body.text);
  let aiRes = null, aiError = null;
  if (body.useAi !== false) {
    try { aiRes = await ai.runJson(`Bewerte den Hook (erste Zeile) dieses Short-Video-Texts für YouTube Shorts/Reels/TikTok. Hält er in den ersten 2 Sekunden? Gib Score 0-100, 2-3 kurze Kritikpunkte und 3 bessere Hook-Alternativen (gleiche Sprache wie der Text).\n\nText:\n${body.text}`, { projectId: body.projectId, schemaHint: '{"score":0,"feedback":["..."],"alternatives":["..."]}' }); }
    catch (e) { aiError = e.message; }
  }
  return { local, ai: aiRes, aiError };
});
r('POST', '/api/ai/rewrite', async ({ body }) => ai.runJson(`Schreibe diesen Short-Video-Text (Titel + Caption) neu. ${body.instruction || 'Stärkerer Hook in der ersten Zeile, kürzer, klarer CTA am Ende.'} Gleiche Sprache, max. 2200 Zeichen Caption, Titel max. 90 Zeichen. Keine Hashtags in der Caption.\n\nTitel: ${body.title || ''}\nCaption:\n${body.caption || ''}`, { projectId: body.projectId, schemaHint: '{"title":"...","caption":"..."}' }));
r('POST', '/api/ai/hashtags', async ({ body }) => ai.runJson(`Schlage 3-6 passende Hashtags für diesen Short vor (Mischung aus Nische und mittelgroß, keine Spam-Tags wie #fyp/#viral). Plattformen: ${body.platforms || 'YouTube, Instagram, TikTok'}.\n\nTitel: ${body.title || ''}\nCaption: ${body.caption || ''}`, { projectId: body.projectId, schemaHint: '{"hashtags":["tag1","tag2"]}' }));
r('POST', '/api/ai/improve-backlog', async ({ body }) => {
  const project = store.find('projects', body.projectId);
  const items = backlog.scan(project).filter(i => i.status === 'new').slice(0, 12);
  const pending = store.get().posts.filter(p => p.projectId === body.projectId && ['review', 'draft', 'approved'].includes(p.status)).slice(0, 12);
  const list = [...pending.map(p => ({ ref: 'post:' + p.id, title: p.title, caption: p.caption })), ...items.map(i => ({ ref: 'backlog:' + i.id, title: i.title, caption: i.caption }))].slice(0, 15);
  if (!list.length) throw bad('Keine offenen Texte im Backlog/Queue.');
  const res = await ai.runJson(`Verbessere die Texte dieser noch nicht veröffentlichten Shorts anhand der Learnings und der Performance-Analyse:\n${analytics.summaryText(body.projectId)}\n\nTexte:\n${JSON.stringify(list, null, 1)}\n\nGib für jeden Eintrag (ref beibehalten) einen verbesserten Titel und Caption zurück, plus eine kurze Begründung.`, { projectId: body.projectId, schemaHint: '{"items":[{"ref":"...","title":"...","caption":"...","why":"..."}]}' });
  return (res.items || []).map(x => ({ ...x, before: list.find(l => l.ref === x.ref) }));
});
r('POST', '/api/ai/apply-text', ({ body }) => {
  const [kind, rid] = body.ref.split(':');
  if (kind === 'post') return posts.edit(rid, { title: body.title, caption: body.caption });
  const it = backlog.findItem(rid); if (!it) throw notFound();
  const f = path.join(it.path, 'post.json');
  let meta = {}; try { meta = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  fs.writeFileSync(f, JSON.stringify({ ...meta, title: body.title, caption: body.caption }, null, 2));
  return { ok: true };
});
r('POST', '/api/ai/replies', async ({ body }) => {
  const st = store.get().stats[body.statKey]; if (!st) throw notFound();
  const a = store.find('accounts', st.accountId);
  let comments;
  if (dryRun() && !a.tokens) comments = [{ id: 'c1', author: 'pixelfan', text: 'Wie hast du das animiert?' }, { id: 'c2', author: 'neo', text: 'Klappt das auch auf Windows?' }];
  else comments = await platforms[a.platform].comments({ tokens: await accounts.tokensFor(a), remoteId: st.remoteId });
  if (!comments.length) return { comments: [], replies: [] };
  const res = await ai.runJson(`Schlage für jeden Kommentar unter meinem Video „${st.title}“ eine kurze, freundliche Antwort vor (gleiche Sprache wie der Kommentar, max. 2 Sätze, gern mit Gegenfrage).\n\n${JSON.stringify(comments.map(c => ({ id: c.id, author: c.author, text: c.text })))}`, { projectId: a.projectId, schemaHint: '{"replies":[{"id":"...","reply":"..."}]}' });
  return { comments, replies: res.replies || [] };
});
r('POST', '/api/ai/plan', async ({ body }) => {
  const free = posts.nextFreeSlots(body.projectId, 30, 14);
  const titles = backlog.scan(store.find('projects', body.projectId)).slice(0, 30).map(i => i.title);
  return ai.runJson(`Plane die nächsten 2 Wochen Shorts für dieses Projekt. Freie Posting-Slots: ${free.length ? free.map(s => s.at).join(', ') : 'keine definiert – schlage Zeiten vor'}.\nBereits vorhandene Titel: ${titles.join(' | ') || '-'}\nPerformance:\n${analytics.summaryText(body.projectId)}\n\nGib pro Slot/Tag eine Short-Idee mit Hook, Blickwinkel und Format.`, { projectId: body.projectId, schemaHint: '{"plan":[{"at":"ISO oder Wochentag+Zeit","idea":"...","hook":"...","format":"short|carousel|story"}],"notes":"..."}' });
});
r('POST', '/api/ai/bios', async ({ body }) => ai.runJson('Schreibe 5 Profil-Bio-Varianten (je max. 150 Zeichen, mit klarem Nutzenversprechen und CTA) für die Social-Media-Profile dieses Projekts, jeweils eine Variante pro Plattform-Tonfall.', { projectId: body.projectId, schemaHint: '{"bios":[{"platform":"instagram|tiktok|youtube","text":"..."}]}' }));

// Studio-Sessions
r('GET', '/api/presets', () => Object.fromEntries(Object.entries(agent.PRESETS).map(([k, v]) => [k, v.label])));
r('GET', '/api/sessions', ({ url }) => agent.list(url.searchParams.get('projectId')));
r('POST', '/api/sessions', ({ body }) => { const s = agent.create(body.projectId, body); return { id: s.id }; });
r('GET', '/api/sessions/:id', ({ params }) => {
  const s = store.find('sessions', params.id); if (!s) throw notFound();
  return { ...s, running: s.status === 'running', handoffItems: s.handoffs.map(h => backlog.findItem(h)).filter(Boolean) };
});
r('POST', '/api/sessions/:id/send', ({ params, body }) => { agent.send(params.id, body.text); return { ok: true }; });
r('POST', '/api/sessions/:id/approve', ({ params, body }) => agent.resolveApproval(params.id, body.approvalId, body.decision));
r('POST', '/api/sessions/:id/stop', ({ params }) => { agent.stopSession(params.id); return { ok: true }; });
r('DELETE', '/api/sessions/:id', ({ params }) => { agent.remove(params.id); return { ok: true }; });

// Automationen
r('GET', '/api/automations', () => store.get().automations);
r('POST', '/api/automations', ({ body }) => automation.create(body));
r('PUT', '/api/automations/:id', ({ params, body }) => automation.update(params.id, body));
r('DELETE', '/api/automations/:id', ({ params }) => { store.remove('automations', params.id); return { ok: true }; });
r('POST', '/api/automations/:id/run', ({ params }) => ({ sessionId: automation.runNow(params.id).id }));

// Analytics & Learnings
r('POST', '/api/analytics/refresh', async ({ body }) => analytics.refreshStats(body.accountIds));
r('GET', '/api/analytics', ({ url }) => { const q = url.searchParams; return { rows: analytics.rows(q.get('projectId'), q.get('accountId')), insights: analytics.insights(q.get('projectId'), q.get('accountId')), lastStatsAt: store.get().settings.lastStatsAt }; });
r('GET', '/api/analytics/summary', ({ url }) => ({ summary: analytics.summaryText(url.searchParams.get('projectId')) }));
r('POST', '/api/analytics/analyze', async ({ body }) => analytics.weeklyAnalysis(body.projectId));
r('GET', '/api/learnings', ({ url }) => store.get().learnings.filter(l => !url.searchParams.get('projectId') || l.projectId === url.searchParams.get('projectId')));
r('POST', '/api/learnings', ({ body }) => { const l = { id: id('lrn_'), projectId: body.projectId, text: body.text, evidence: 'manuell', status: 'approved', createdAt: Date.now() }; store.get().learnings.push(l); store.save(); return l; });
r('PUT', '/api/learnings/:id', ({ params, body }) => { const l = store.find('learnings', params.id); if (!l) throw notFound(); if (body.status) l.status = body.status; if (body.text) l.text = body.text; store.save(); return l; });
r('DELETE', '/api/learnings/:id', ({ params }) => { store.remove('learnings', params.id); return { ok: true }; });

// Einstellungen & Dienste
r('PUT', '/api/settings', ({ body }) => {
  const s = store.get().settings;
  for (const k of ['toleranceMin', 'uploadAheadDays', 'wakeEnabled', 'defaultAgent', 'theme', 'scanlines']) if (body[k] !== undefined) s[k] = body[k];
  store.save(); return s;
});
r('POST', '/api/worker/:action', ({ params }) => { const s = store.get().settings; if (params.action === 'start') { worker.start(); s.workerEnabled = true; } else { worker.stop(); s.workerEnabled = false; } store.save(); return worker.status(); });
r('POST', '/api/worker-tick', async () => { await worker.tick(); return worker.status(); });
r('POST', '/api/gateway/:action', async ({ params }) => { const s = store.get().settings; if (params.action === 'start') { await startGateway(); s.gatewayEnabled = true; } else { stopGateway(); s.gatewayEnabled = false; } store.save(); return { running: !!gateway?.listening }; });
r('POST', '/api/tunnel/:action', ({ params }) => { const s = store.get().settings; const st = params.action === 'start' ? tunnel.start() : tunnel.stop(); s.tunnelEnabled = params.action === 'start'; store.save(); return st; });
r('GET', '/api/logs', () => ({ text: tailLog(300), file: LOG_FILE }));
r('GET', '/api/doctor', () => {
  const keys = ['PUBLIC_BASE_URL', 'CLOUDFLARE_TUNNEL_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'];
  return { env: Object.fromEntries(keys.map(k => [k, !!env(k)])), tools: { claude: !!which('claude'), codex: !!which('codex'), 'cursor-agent': !!which('cursor-agent'), cloudflared: !!which('cloudflared'), ffprobe: !!which('ffprobe'), chrome: !!accounts.chromeBinary() } };
});
r('GET', '/api/ext-token', () => ({ token: extToken() }));

function extToken() { const s = store.get().settings; if (!s.extToken) { s.extToken = crypto.randomBytes(9).toString('base64url'); store.save(); } return s.extToken; }

// ── TikTok-Studio-Extension ──────────────────────────────────────────
function extCors(req) {
  const o = req.headers.origin || '';
  return /^(chrome-extension:\/\/|https:\/\/(www\.)?tiktok\.com$)/.test(o) ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Headers': 'Content-Type, X-RetroPost-Token', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } : {};
}
async function handleExt(req, res, url) {
  const cors = extCors(req);
  if (req.method === 'OPTIONS') return send(res, 204, '', cors);
  const token = req.headers['x-retropost-token'] || url.searchParams.get('token');
  if (token !== extToken()) return send(res, 401, { error: 'Falscher Extension-Token (siehe RetroPost › Einstellungen)' }, cors);
  const db = store.get();
  if (url.pathname === '/ext/accounts') return send(res, 200, db.accounts.filter(a => a.platform === 'tiktok').map(a => ({ id: a.id, name: a.name, mode: a.tiktokMode })), cors);
  if (url.pathname === '/ext/tiktok/next') {
    const acc = url.searchParams.get('accountId');
    const j = db.extJobs.find(x => x.status !== 'done' && (!acc || x.accountId === acc) && !(x.snoozeUntil > Date.now()));
    if (!j) return send(res, 200, { job: null }, cors);
    const p = store.find('posts', j.postId);
    if (!p) { j.status = 'done'; store.save(); return send(res, 200, { job: null }, cors); }
    j.status = 'opened'; j.openedAt = Date.now(); store.save();
    const tags = (p.hashtags || []).map(h => '#' + h).filter(t => !p.caption.includes(t)).join(' ');
    return send(res, 200, { job: { id: j.id, title: p.title, caption: (p.caption + (tags ? ' ' + tags : '')).trim(), images: (p.images || []).length, file: p.mediaPath ? path.basename(p.mediaPath) : null, mediaUrl: `http://127.0.0.1:${PORT}/ext/media/${j.id}?token=${token}` } }, cors);
  }
  const mm = url.pathname.match(/^\/ext\/media\/([\w-]+)$/);
  if (mm) {
    const j = db.extJobs.find(x => x.id === mm[1]); const p = j && store.find('posts', j.postId);
    if (!p?.mediaPath) return send(res, 404, 'Kein Video', cors);
    return serveFile(req, res, p.mediaPath, cors);
  }
  if (url.pathname === '/ext/tiktok/snooze' && req.method === 'POST') {
    const b = await readBody(req); const j = db.extJobs.find(x => x.id === b.jobId);
    if (j) { j.snoozeUntil = Date.now() + 15 * 60000; j.status = 'queued'; store.save(); }
    return send(res, 200, { ok: true }, cors);
  }
  if (url.pathname === '/ext/tiktok/done' && req.method === 'POST') {
    const b = await readBody(req); worker.studioDone(b.jobId, b.url); broadcast('posts', {});
    return send(res, 200, { ok: true }, cors);
  }
  send(res, 404, { error: 'Unbekannt' }, cors);
}

// ── Haupt-Handler (nur localhost) ────────────────────────────────────
const LOCAL_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  // Schutz vor DNS-Rebinding & fremden Webseiten
  if (!LOCAL_HOSTS.has(req.headers.host)) return send(res, 403, 'Nur lokal erreichbar');
  if (url.pathname.startsWith('/ext/')) return handleExt(req, res, url).catch(e => send(res, 500, { error: e.message }));
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && !LOCAL_HOSTS.has(origin.replace(/^https?:\/\//, ''))) return send(res, 403, { error: 'Fremde Herkunft blockiert' });

  if (url.pathname === '/oauth/youtube/callback') return oauthCallback('youtube', url, res);
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 3000\n\n'); sseClients.add(res); req.on('close', () => sseClients.delete(res)); return;
  }
  const sm = url.pathname.match(/^\/api\/sessions\/([\w-]+)\/stream$/);
  if (sm) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const off = agent.subscribe(sm[1], ev => res.write(`data: ${JSON.stringify(ev)}\n\n`));
    req.on('close', off); return;
  }
  if (url.pathname === '/file') {
    const f = url.searchParams.get('path');
    if (!f || !allowedFile(f)) return send(res, 403, 'Pfad nicht freigegeben');
    return serveFile(req, res, f);
  }
  if (url.pathname.startsWith('/api/')) {
    for (const rt of routes) {
      if (rt.method !== req.method) continue;
      const m = rt.re.exec(url.pathname); if (!m) continue;
      try {
        const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
        const out = await rt.fn({ req, url, body, params: m.groups || {} });
        return send(res, 200, out ?? { ok: true });
      } catch (e) {
        if (!e.status) log('api', req.method, url.pathname, e.message);
        return send(res, e.status || 500, { error: e.message });
      }
    }
    return send(res, 404, { error: 'Unbekannte Route' });
  }
  // statische Dateien
  let f = path.join(PUBLIC, decodeURIComponent(url.pathname));
  if (!f.startsWith(PUBLIC)) return send(res, 403, 'Nein');
  if (url.pathname === '/' || !fs.existsSync(f)) f = path.join(PUBLIC, 'index.html');
  serveFile(req, res, f);
}
const bad = m => Object.assign(new Error(m), { status: 400 });
const notFound = () => Object.assign(new Error('Nicht gefunden'), { status: 404 });

// ── Gateway: das Einzige, was der Tunnel öffentlich macht ────────────
let gateway = null;
function gatewayHandle(req, res) {
  const url = new URL(req.url, 'http://gateway');
  if (url.pathname === '/health') return send(res, 200, 'ok');
  if (url.pathname === '/oauth/instagram/callback') return oauthCallback('instagram', url, res);
  if (url.pathname === '/oauth/tiktok/callback') return oauthCallback('tiktok', url, res);
  const m = url.pathname.match(/^\/m\/([\w-]+)\/(\d+)\/([\w-]+)\/[^/]+$/);
  if (m && (req.method === 'GET' || req.method === 'HEAD')) {
    const r = tunnel.resolveMedia(m[1], m[2], m[3]);
    if (r.error) return send(res, r.error, r.error === 410 ? 'Link abgelaufen' : 'Ungültige Signatur');
    if (!allowedFile(r.file)) return send(res, 403, 'Nein');
    return serveFile(req, res, r.file);
  }
  // TikTok-Domain-Verifizierung: Datei im Datenordner ablegen (tiktok*.txt)
  const v = url.pathname.match(/^\/(tiktok[\w-]*\.txt)$/);
  if (v && fs.existsSync(path.join(DATA_DIR, v[1]))) return serveFile(req, res, path.join(DATA_DIR, v[1]));
  send(res, 404, 'Not found');
}
function startGateway() {
  return new Promise((resolve) => {
    if (gateway?.listening) return resolve();
    gateway = http.createServer(gatewayHandle);
    gateway.on('error', e => { log('gateway', 'Fehler:', e.message); resolve(); });
    gateway.listen(GW_PORT, '127.0.0.1', () => { log('gateway', `Gateway auf 127.0.0.1:${GW_PORT}`); resolve(); });
  });
}
function stopGateway() { gateway?.close(); gateway = null; }

// ── Start ────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => handle(req, res).catch(e => { log('http', e); try { send(res, 500, { error: e.message }); } catch {} }));
server.on('error', e => {
  if (e.code === 'EADDRINUSE') { log('app', `Port ${PORT} belegt – RetroPost läuft vermutlich schon.`); process.exit(3); }
  throw e;
});
server.listen(PORT, '127.0.0.1', async () => {
  log('app', `RetroPost läuft: http://localhost:${PORT}  (Daten: ${DATA_DIR})${dryRun() ? '  [DRY-RUN]' : ''}`);
  const s = store.get().settings;
  if (s.gatewayEnabled) await startGateway();
  if (s.workerEnabled) worker.start();
  if (s.tunnelEnabled) { try { tunnel.start(); } catch (e) { log('tunnel', e.message); } }
  // Sessions, die beim Absturz liefen, als unterbrochen markieren
  for (const ses of store.get().sessions) if (ses.status === 'running') ses.status = 'interrupted';
  // Posts, die beim Absturz mitten im Posten waren, erneut versuchen (YouTube setzt den Upload fort)
  for (const p of store.get().posts) for (const t of p.targets) if (t.status === 'posting') { t.status = 'pending'; if (p.status === 'posting') p.status = 'approved'; }
  store.save();
});

function shutdown() { log('app', 'Beende…'); tunnel.stop(); try { store.flush(); } catch {} process.exit(0); }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);

module.exports = { server };
