'use strict';
/* RetroPost – Frontend (Vanilla JS, kein Build) */

// ── Basis ─────────────────────────────────────────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { state: null, project: localStorage.getItem('rp.project') || '', route: 'studio', arg: '', planTab: localStorage.getItem('rp.planTab') || 'month', planDate: new Date(), allProjects: localStorage.getItem('rp.allProjects') === '1', growTab: 'overview', backlogTab: 'new', drafts: {}, sesStream: null };
const view = $('#view');

async function api(method, path, body) {
  const r = await fetch('/api' + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
const GET = p => api('GET', p), POST = (p, b = {}) => api('POST', p, b), PUT = (p, b) => api('PUT', p, b), DEL = p => api('DELETE', p);

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3500);
}
// Button-Aktion mit Ladeanzeige + Fehler-Toast
async function run(btn, fn, okMsg) {
  if (btn) { btn.classList.add('loading'); btn.disabled = true; }
  try { const r = await fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'ok'); return r; }
  catch (e) { toast(e.message, 'err'); throw e; }
  finally { if (btn) { btn.classList.remove('loading'); btn.disabled = false; } }
}
const quiet = p => p.catch(() => {});

function modal(html, { narrow = false, onClose } = {}) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="back"><div class="modal ${narrow ? 'narrow' : ''}" role="dialog" aria-modal="true"><button class="btn sm icon-only close" data-close aria-label="Schließen">${icon('x', 14)}</button>${html}</div></div>`;
  const back = $('.back', root);
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', e => { if (e.target === back) close(); });
  $('[data-close]', root).onclick = close;
  return { el: $('.modal', root), close };
}

// ── Formatierung ──────────────────────────────────────────────────────
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const pad = n => String(n).padStart(2, '0');
const fmtTime = d => { d = new Date(d); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtDate = d => { d = new Date(d); return `${WD[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`; };
const fmtDT = d => d ? `${fmtDate(d)} ${fmtTime(d)}` : '–';
const toLocalInput = iso => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayKey = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const ago = ts => { if (!ts) return 'nie'; const s = (Date.now() - ts) / 1000; return s < 60 ? 'gerade eben' : s < 3600 ? `vor ${Math.round(s / 60)} min` : s < 86400 ? `vor ${Math.round(s / 3600)} h` : `vor ${Math.round(s / 86400)} T`; };
const n = x => (x ?? 0).toLocaleString('de-DE');
const fileUrl = p => p ? '/file?path=' + encodeURIComponent(p) : '';
const PLAT_IC = { youtube: 'yt', instagram: 'ig', tiktok: 'tt' };
const platIcon = (p, size = 16) => `<span class="plat"><span class="${p}">${icon(PLAT_IC[p], size)}</span></span>`;
const STATUS = {
  review: ['Review', 'yellow'], draft: ['Entwurf', ''], approved: ['Geplant', 'cyan'], posting: ['Postet…', 'orange'], posted: ['Gepostet', 'green'], failed: ['Fehler', 'red'],
  pending: ['Wartet', ''], scheduled_remote: ['Vorab hochgeladen', 'violet'], awaiting_user: ['Wartet auf dich', 'orange'],
  new: ['Neu', 'pink'], planned: ['Geplant', 'cyan'], archived: ['Archiv', ''], running: ['Läuft', 'orange'], done: ['Fertig', 'green'], error: ['Fehler', 'red'], idle: ['Bereit', ''], needs_approval: ['Freigabe nötig', 'orange'], interrupted: ['Unterbrochen', 'red'],
};
const badge = st => { const [l, c] = STATUS[st] || [st, '']; return `<span class="badge ${c}">${esc(l)}</span>`; };
const project = () => S.state?.projects.find(p => p.id === S.project);
const projColor = pid => S.state?.projects.find(p => p.id === pid)?.color || 'var(--pink)';
const accName = aid => S.state?.accounts.find(a => a.id === aid)?.name || '?';

function thumbHtml(item, { fmt = true } = {}) {
  const media = item.thumb ? `<img src="${fileUrl(item.thumb)}" alt="" loading="lazy">`
    : item.video || item.mediaPath ? `<video src="${fileUrl(item.video || item.mediaPath)}#t=0.5" muted preload="metadata" playsinline></video>`
    : item.images?.[0] ? `<img src="${fileUrl(item.images[0])}" alt="" loading="lazy">` : icon('folder', 28);
  return `<div class="thumb">${media}${fmt && item.format ? `<span class="badge fmt">${esc(item.format)}${item.images?.length > 1 ? ' ×' + item.images.length : ''}</span>` : ''}</div>`;
}
function hoverPlay(root) {
  $$('.thumb video', root).forEach(v => { v.parentElement.onmouseenter = () => quiet(v.play()); v.parentElement.onmouseleave = () => v.pause(); });
}

// ── State & Navigation ────────────────────────────────────────────────
async function loadState() {
  S.state = await GET('/state');
  if (!S.state.projects.find(p => p.id === S.project)) S.project = S.state.projects[0]?.id || '';
  document.documentElement.dataset.theme = S.state.settings.theme === 'handheld' ? 'handheld' : '';
  document.body.classList.toggle('scan', !!S.state.settings.scanlines);
  renderSide();
}

const NAV = [
  ['studio', 'Studio', 'studio'], ['backlog', 'Backlog', 'backlog'], ['plan', 'Planen', 'plan'], ['review', 'Review', 'review', 'review'],
  ['auto', 'Automation', 'auto'], ['grow', 'Wachsen', 'grow', 'proposed'], ['accounts', 'Konten', 'accounts'], ['projects', 'Projekte', 'projects'], ['settings', 'System', 'settings', 'failed'],
];

function renderSide() {
  const st = S.state;
  $('#projectSelect').innerHTML = st.projects.length ? st.projects.map(p => `<option value="${p.id}" ${p.id === S.project ? 'selected' : ''}>${esc(p.name)}</option>`).join('') : '<option value="">– kein Projekt –</option>';
  $('#nav').innerHTML = NAV.map(([r, l, ic, cnt]) => {
    const c = cnt && st.counts[cnt];
    return `<a href="#/${r}" class="${S.route === r ? 'on' : ''}">${icon(ic, 18)}<span>${l}</span>${c ? `<span class="badge ${cnt === 'failed' ? 'red' : 'yellow'}">${c}</span>` : ''}</a>`;
  }).join('');
  const w = st.worker;
  $('#sideStatus').innerHTML = `
    <div class="row"><span class="led ${w.running ? 'on' : 'err'}"></span> Worker ${w.running ? 'aktiv' : 'gestoppt'}</div>
    <div class="row"><span class="led ${st.tunnel.running ? 'on' : ''}"></span> Tunnel ${st.tunnel.running ? 'online' : 'aus'}</div>
    ${st.dryRun ? '<div class="row"><span class="badge orange">DRY-RUN</span></div>' : ''}
    ${st.counts.awaiting ? `<div class="row"><span class="led busy"></span> ${st.counts.awaiting} TikTok-Studio-Job(s)</div>` : ''}`;
  renderSideSessions();
}
async function renderSideSessions() {
  if (!S.project) { $('#sideSessions').innerHTML = ''; return; }
  const list = await GET('/sessions?projectId=' + S.project).catch(() => []);
  $('#sesCount').textContent = `${S.state.sessionsRunning}/${S.state.maxSessions}`;
  $('#sideSessions').innerHTML = list.slice(0, 6).map(s => `<a class="ses-item" href="#/studio/${s.id}"><span class="led ${s.running ? 'busy' : s.status === 'needs_approval' ? 'err' : s.status === 'done' ? 'on' : ''}"></span><span>${esc(s.title)}</span></a>`).join('') || '<span class="muted tiny">Noch keine Chats</span>';
}

$('#projectSelect').onchange = e => { S.project = e.target.value; localStorage.setItem('rp.project', S.project); render(); };
$('#menuBtn').onclick = () => $('#side').classList.toggle('open');
document.addEventListener('click', e => { if (e.target.closest('#nav a, .ses-item')) $('#side').classList.remove('open'); });

function setHeader(title, actions = '') { $('#pageTitle').textContent = title; $('#topActions').innerHTML = actions; document.title = `${title} · RetroPost`; }

async function render() {
  const [r, ...rest] = (location.hash.replace(/^#\//, '') || 'studio').split('/');
  S.route = VIEWS[r] ? r : 'studio'; S.arg = rest.join('/');
  if (S.sesStream && !(S.route === 'studio' && S.arg === S.sesStream.sid)) { S.sesStream.es.close(); S.sesStream = null; }
  renderSide();
  if (!S.state.projects.length && !['projects', 'settings', 'accounts'].includes(S.route)) return renderWelcome();
  try { await VIEWS[S.route](S.arg); }
  catch (e) { view.innerHTML = `<div class="card warn"><h2>Fehler</h2><p>${esc(e.message)}</p></div>`; }
}
window.addEventListener('hashchange', () => { $('#modalRoot').innerHTML = ''; render(); });

// Live-Updates
let reTimer = null;
function softRefresh(kinds) {
  clearTimeout(reTimer);
  reTimer = setTimeout(async () => {
    await loadState().catch(() => {});
    const busy = document.activeElement && view.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if ($('#modalRoot').innerHTML || busy) return;
    if (S.route === 'studio') { if (kinds.has('sessions')) renderStudioLists?.(); return; }
    if (['plan', 'review', 'backlog', 'accounts', 'settings'].includes(S.route)) render();
  }, 500);
}
(function connectEvents() {
  const es = new EventSource('/api/events');
  const kinds = new Set();
  for (const k of ['post', 'posts', 'sessions', 'accounts', 'backlog']) es.addEventListener(k, () => { kinds.add(k); softRefresh(kinds); setTimeout(() => kinds.clear(), 600); });
  window.addEventListener('message', e => { if (e.data === 'retropost-oauth') { loadState().then(render); } });
})();

// ── Willkommen ────────────────────────────────────────────────────────
function renderWelcome() {
  setHeader('Willkommen');
  view.innerHTML = `<div class="card raised hl" style="max-width:760px">
    <h2>Player 1 – Start</h2>
    <p>RetroPost erstellt mit deinem KI-Agenten Shorts, plant sie und postet sie auf YouTube, Instagram und TikTok – alles lokal auf deinem Rechner.</p>
    <p class="muted">Leg zuerst ein Projekt an. Ein Projekt = ein Repo (dort arbeitet der Agent) + Content-Ordner + Konten + Posting-Slots.</p>
    <hr>${projectForm()}
    <div class="row end"><button class="btn pri" id="createProj">${icon('plus', 12)} Projekt anlegen</button></div></div>`;
  $('#createProj').onclick = e => createProject(e.target);
}
function projectForm(p = {}) {
  const agents = S.state.agents;
  return `<div class="grid2">
    <label class="field"><span class="lbl">Name</span><input name="name" value="${esc(p.name || '')}" placeholder="z. B. Meine App"></label>
    <label class="field"><span class="lbl">Repo-Pfad (Agent arbeitet hier)</span><input name="repoPath" value="${esc(p.repoPath || '')}" placeholder="/Users/du/code/meine-app-shorts"></label>
    <label class="field"><span class="lbl">Content-Ordner (relativ zum Repo, einer pro Zeile)</span><textarea name="contentDirs" style="min-height:60px">${esc((p.contentDirs || ['content/shorts']).join('\n'))}</textarea></label>
    <label class="field"><span class="lbl">KI-Agent</span><select name="agent">${['claude', 'codex', 'cursor'].map(a => `<option value="${a}" ${p.agent === a ? 'selected' : ''}>${a === 'claude' ? 'Claude Code' : a === 'codex' ? 'Codex' : 'Cursor'}${agents[a] ? '' : ' (nicht installiert)'}</option>`).join('')}</select></label>
  </div>`;
}
function readForm(root) {
  const o = {};
  $$('[name]', root).forEach(el => { o[el.name] = el.type === 'checkbox' ? el.checked : el.value; });
  return o;
}
async function createProject(btn) {
  const f = readForm(btn.closest('.card, .modal'));
  f.contentDirs = f.contentDirs.split('\n').map(s => s.trim()).filter(Boolean);
  const p = await run(btn, () => POST('/projects', f), 'Projekt angelegt');
  S.project = p.id; localStorage.setItem('rp.project', p.id);
  await loadState(); location.hash = '#/studio'; render();
}

// ── STUDIO ────────────────────────────────────────────────────────────
let renderStudioLists = null;
const VIEWS = {};
VIEWS.studio = async (sid) => {
  const presets = await GET('/presets');
  setHeader('Studio', `<span class="muted tiny">Agent: ${esc(project()?.agent || 'claude')} · ${S.state.sessionsRunning}/${S.state.maxSessions} aktiv</span>`);
  view.innerHTML = `<div class="studio">
    <div class="col"><a class="btn pri" href="#/studio">${icon('plus', 12)} Neuer Chat</a><div class="chat-list" id="chatList"></div></div>
    <div class="col" id="chatMain"></div>
    <div class="col right" id="chatSide" style="overflow-y:auto"></div></div>`;
  renderStudioLists = async () => {
    const list = await GET('/sessions?projectId=' + S.project);
    $('#chatList') && ($('#chatList').innerHTML = list.map(s => `<a href="#/studio/${s.id}" class="${s.id === sid ? 'on' : ''}"><div class="row" style="gap:8px">${badge(s.running ? 'running' : s.status)}${s.automationId ? '<span class="badge violet">auto</span>' : ''}</div><div>${esc(s.title)}</div><small>${esc(s.last)}</small></a>`).join('') || '<p class="muted tiny" style="padding:8px">Noch keine Chats.</p>');
    if (sid) renderChatSide(sid);
    renderSideSessions();
  };
  await renderStudioLists();
  if (!sid) return renderNewChat(presets);
  await renderChat(sid, presets);
};

function renderNewChat(presets) {
  const draft = S.drafts.new || '';
  $('#chatMain').innerHTML = `<div class="card raised" style="margin-top:4px">
    <h2>Neuer Chat</h2>
    <p class="muted">Beschreib, welche Shorts du willst. Der Agent rendert sie im Repo und übergibt jeden fertigen Short an den Backlog.</p>
    <div class="presets" style="margin-bottom:8px">${Object.entries(presets).map(([k, l]) => `<button class="btn sm" data-preset="${k}">${icon('spark', 10)} ${esc(l)}</button>`).join('')}</div>
    <textarea id="newPrompt" placeholder="z. B. Mach 5 Shorts, die je ein Feature meiner App zeigen. Hook in den ersten 2 Sekunden.">${esc(draft)}</textarea>
    <div class="row"><label class="row" style="gap:6px"><span class="lbl">Serie</span><input id="series" type="number" min="1" max="20" value="1" style="width:80px"></label>
      <span class="muted tiny grow1">Anzahl Shorts, die der Agent nacheinander rendert, prüft und übergibt.</span>
      <button class="btn pri" id="startChat">${icon('play', 12)} Start</button></div>
  </div>
  <div class="card"><h3>So funktioniert die Übergabe</h3><p class="muted tiny">Jeder fertige Short landet als Ordner in <span class="mono">${esc((project()?.contentDirs || [])[0] || 'content/shorts')}/&lt;datum-slug&gt;/</span> mit <b>video.mp4</b> und <b>post.json</b>. Auch andere Render-Tools können dort Ordner ablegen – RetroPost erkennt sie automatisch.</p></div>`;
  let preset = null;
  $('#newPrompt').oninput = e => S.drafts.new = e.target.value;
  $$('[data-preset]').forEach(b => b.onclick = () => { preset = preset === b.dataset.preset ? null : b.dataset.preset; $$('[data-preset]').forEach(x => x.classList.toggle('pri', x.dataset.preset === preset)); });
  $('#startChat').onclick = async e => {
    const prompt = $('#newPrompt').value.trim();
    if (!prompt && !preset) return toast('Schreib einen Prompt oder wähl ein Preset.', 'err');
    const series = Number($('#series').value) > 1 ? Number($('#series').value) : null;
    const s = await run(e.target, () => POST('/sessions', { projectId: S.project, prompt, preset, series }));
    S.drafts.new = ''; await loadState(); location.hash = '#/studio/' + s.id;
  };
}

function evHtml(ev) {
  return `<div class="ev ${ev.type}">${esc(ev.tool ? `${ev.tool}: ${ev.text}` : ev.text)}</div>`;
}
async function renderChat(sid) {
  const s = await GET('/sessions/' + sid);
  $('#chatMain').innerHTML = `
    <div class="row" style="margin-bottom:6px"><h2 class="grow1" style="margin:0">${esc(s.title)}</h2>${badge(s.running ? 'running' : s.status)}</div>
    <div class="term px" id="term">${s.events.map(evHtml).join('')}<span class="cursor ${s.running ? '' : 'hide'}" id="cur"></span></div>
    <div class="composer">
      <textarea id="msg" placeholder="${s.running ? 'Agent arbeitet …' : 'Antworten / nächste Anweisung …'}">${esc(S.drafts[sid] || '')}</textarea>
      <div class="row end">${s.running ? `<button class="btn bad" id="stopS">${icon('stop', 12)} Stop</button>` : ''}<button class="btn pri" id="sendS" ${s.running ? 'disabled' : ''}>${icon('play', 12)} Senden</button></div>
    </div>`;
  const term = $('#term'); term.scrollTop = term.scrollHeight;
  $('#msg').oninput = e => S.drafts[sid] = e.target.value;
  $('#msg').onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#sendS').click(); };
  $('#sendS').onclick = async e => { const t = $('#msg').value.trim(); if (!t) return; await run(e.target, () => POST(`/sessions/${sid}/send`, { text: t })); S.drafts[sid] = ''; renderChat(sid); };
  $('#stopS') && ($('#stopS').onclick = e => run(e.target, () => POST(`/sessions/${sid}/stop`), 'Gestoppt'));
  renderChatSide(sid, s);
  if (!S.sesStream || S.sesStream.sid !== sid) {
    S.sesStream?.es.close();
    const es = new EventSource(`/api/sessions/${sid}/stream`);
    S.sesStream = { sid, es };
    es.onmessage = m => {
      const ev = JSON.parse(m.data);
      const t = $('#term'); if (!t) return;
      const atBottom = t.scrollHeight - t.scrollTop - t.clientHeight < 60;
      $('#cur').insertAdjacentHTML('beforebegin', evHtml(ev));
      if (atBottom) t.scrollTop = t.scrollHeight;
      if (['result', 'error', 'handoff', 'approval'].includes(ev.type)) setTimeout(() => { if (S.route === 'studio' && S.arg === sid && !$('#modalRoot').innerHTML) { loadState().then(() => renderChat(sid)); renderStudioLists(); } }, 800);
    };
  }
}

async function renderChatSide(sid, s) {
  s = s || await GET('/sessions/' + sid);
  const el = $('#chatSide'); if (!el) return;
  const pend = s.approvals.filter(a => a.status === 'pending');
  el.innerHTML = `
    ${pend.length ? `<div class="card warn"><h3>Freigabe nötig</h3>${pend.map(a => `<div style="margin-bottom:12px"><div class="mono" style="color:var(--orange)">${esc(a.exact)}</div>
      <div class="row" style="gap:0"><button class="btn sm ok" data-ap="${a.id}" data-d="once">Einmal</button>${a.pattern ? `<button class="btn sm" data-ap="${a.id}" data-d="pattern" title="${esc(a.pattern)}">Immer: ${esc(a.pattern.slice(5, -1))}</button>` : ''}<button class="btn sm bad" data-ap="${a.id}" data-d="deny">Nein</button></div></div>`).join('')}
      <p class="muted tiny">Catch-all-Regeln (z. B. Bash(*)) werden immer abgelehnt.</p></div>` : ''}
    <div class="card"><h3>Übergebene Shorts (${s.handoffItems.length})</h3>
      ${s.handoffItems.map(it => `<div class="item" style="grid-template-columns:56px 1fr;margin-bottom:10px">${thumbHtml(it, { fmt: false })}<div><div class="t" style="font-size:19px">${esc(it.title)}</div>${badge(it.status)}
        ${it.status === 'new' ? `<button class="btn sm" data-review="${it.id}">→ Review</button>` : ''}</div></div>`).join('') || '<p class="muted tiny">Noch keine. Fertige Shorts erscheinen hier und im Backlog.</p>'}
      ${s.handoffItems.some(i => i.status === 'new') ? `<button class="btn sm pri" id="allReview">Alle in Review</button>` : ''}
    </div>
    <div class="card"><h3>Session</h3><dl class="kv"><dt>Agent</dt><dd>${esc(s.agent)}</dd><dt>Status</dt><dd>${badge(s.running ? 'running' : s.status)}</dd><dt>Kosten</dt><dd>${s.cost ? '$' + s.cost.toFixed(2) : '–'}</dd></dl>
      <div class="row" style="gap:0;margin-top:8px">
        ${s.handoffItems.length ? `<button class="btn sm" id="asRecipe">${icon('auto', 10)} Als Rezept</button>` : ''}
        <button class="btn sm bad" id="delS">${icon('trash', 10)} Löschen</button></div></div>`;
  hoverPlay(el);
  $$('[data-ap]', el).forEach(b => b.onclick = async () => { await run(b, () => POST(`/sessions/${sid}/approve`, { approvalId: b.dataset.ap, decision: b.dataset.d })); renderChat(sid); });
  $$('[data-review]', el).forEach(b => b.onclick = () => run(b, () => POST('/posts/from-backlog', { backlogId: b.dataset.review, status: 'review', autoSlot: true }), 'In Review gelegt').then(() => renderChatSide(sid)));
  $('#allReview', el) && ($('#allReview', el).onclick = e => run(e.target, () => POST('/posts/from-backlog', { backlogIds: s.handoffItems.filter(i => i.status === 'new').map(i => i.id), status: 'review', autoSlot: true }), 'In Review gelegt').then(() => renderChatSide(sid)));
  $('#asRecipe', el) && ($('#asRecipe', el).onclick = () => automationModal({ recipeSessionId: sid, recipeBacklogId: s.handoffItems[s.handoffItems.length - 1].id, name: s.title }));
  $('#delS', el).onclick = async e => { if (!confirm('Chat löschen?')) return; await run(e.target, () => DEL('/sessions/' + sid)); location.hash = '#/studio'; };
}

// ── BACKLOG ───────────────────────────────────────────────────────────
VIEWS.backlog = async () => {
  setHeader('Backlog', `<button class="btn" id="fill">${icon('plan', 12)} Freie Slots füllen</button><button class="btn" id="improve">${icon('spark', 12)} Texte verbessern</button><button class="btn" id="rescan">${icon('refresh', 12)} Scannen</button>`);
  const items = await GET('/backlog?projectId=' + S.project);
  const tabs = [['new', 'Neu'], ['planned', 'Geplant'], ['archived', 'Archiv'], ['all', 'Alle']];
  const list = items.filter(i => S.backlogTab === 'all' || i.status === S.backlogTab);
  view.innerHTML = `<div class="tab-row">${tabs.map(([k, l]) => `<button class="tab ${S.backlogTab === k ? 'on' : ''}" data-tab="${k}">${l} (${k === 'all' ? items.length : items.filter(i => i.status === k).length})</button>`).join('')}</div>
    ${list.length ? `<div class="cards">${list.map(it => `<div class="card">
      <div class="item">${thumbHtml(it)}<div style="min-width:0"><div class="row" style="gap:6px;margin-bottom:6px">${badge(it.status)}${it.sessionId ? '<span class="badge violet">studio</span>' : ''}${it.error ? '<span class="badge red">post.json</span>' : ''}</div>
      <div class="t">${esc(it.title)}</div><div class="c">${esc(it.caption) || '<i>keine Caption</i>'}</div></div></div>
      <div class="row" style="gap:0;margin-top:10px">
        ${it.status === 'new' ? `<button class="btn sm pri" data-act="review" data-id="${it.id}">→ Review</button><button class="btn sm" data-act="plan" data-id="${it.id}">Planen…</button>` : ''}
        ${it.postId ? `<button class="btn sm" data-act="open" data-post="${it.postId}">Post öffnen</button>` : ''}
        ${it.status !== 'archived' ? `<button class="btn sm ghost" data-act="archive" data-id="${it.id}">Archiv</button>` : `<button class="btn sm ghost" data-act="unarchive" data-id="${it.id}">Zurück</button>`}
      </div><div class="muted tiny mono" style="margin-top:6px" title="${esc(it.path)}">${esc(it.name)}</div></div>`).join('')}</div>`
    : `<div class="empty card"><span class="big">Backlog leer</span>Erzeuge Shorts im Studio oder lege Ordner in<br><span class="mono">${esc(project().repoPath)}/${esc(project().contentDirs[0])}</span> ab<br>(video.mp4 + post.json).</div>`}`;
  hoverPlay(view);
  $$('[data-tab]').forEach(b => b.onclick = () => { S.backlogTab = b.dataset.tab; render(); });
  view.onclick = async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const idv = b.dataset.id;
    if (b.dataset.act === 'review') { await run(b, () => POST('/posts/from-backlog', { backlogId: idv, status: 'review', autoSlot: true }), 'In Review gelegt (nächster freier Slot)'); render(); }
    if (b.dataset.act === 'plan') planModal(items.find(i => i.id === idv));
    if (b.dataset.act === 'archive') { await POST(`/backlog/${idv}/status`, { status: 'archived' }); render(); }
    if (b.dataset.act === 'unarchive') { await POST(`/backlog/${idv}/status`, { status: 'new' }); render(); }
    if (b.dataset.act === 'open') editPost(b.dataset.post);
  };
  $('#rescan').onclick = () => render();
  $('#fill').onclick = e => run(e.target, () => POST('/posts/fill-slots', { projectId: S.project }), r => r.filled ? `${r.filled} Slot(s) gefüllt → Review` : 'Keine freien Slots oder keine neuen Shorts').then(() => loadState().then(render));
  $('#improve').onclick = e => improveTexts(e.target);
};

function accountChecks(selected, filterFn = () => true) {
  const accs = S.state.accounts.filter(a => a.projectId === S.project && filterFn(a));
  if (!accs.length) return `<p class="muted tiny">Keine Konten im Projekt – <a href="#/accounts">Konto hinzufügen</a>.</p>`;
  return `<div class="targets">${accs.map(a => `<label class="target"><input type="checkbox" name="acc" value="${a.id}" ${selected.includes(a.id) ? 'checked' : ''}>${platIcon(a.platform)} ${esc(a.name)} ${a.connected ? '' : '<span class="badge red">nicht verbunden</span>'}${a.platform === 'tiktok' ? `<span class="badge">${esc(a.tiktokMode)}</span>` : ''}</label>`).join('')}</div>`;
}

function planModal(it) {
  const defaults = S.state.accounts.filter(a => a.projectId === S.project && (!it.platforms || it.platforms.includes(a.platform)) && (a.platform !== 'youtube' || it.video)).map(a => a.id);
  const m = modal(`<h2>Planen</h2><div class="item" style="margin-bottom:14px">${thumbHtml(it)}<div><div class="t">${esc(it.title)}</div><div class="c">${esc(it.caption)}</div></div></div>
    <label class="field"><span class="lbl">Zeitpunkt (leer = nächster freier Slot)</span><input type="datetime-local" id="at"></label>
    <span class="lbl">Konten (alle bewegen sich gemeinsam)</span>${accountChecks(defaults)}
    <div class="row end" style="margin-top:14px"><button class="btn" id="toReview">In Review</button><button class="btn pri" id="approveNow">${icon('check', 12)} Direkt freigeben</button></div>`, { narrow: true });
  const go = async (btn, status) => {
    const at = $('#at', m.el).value;
    const accountIds = $$('[name=acc]:checked', m.el).map(x => x.value);
    const p = await run(btn, () => POST('/posts/from-backlog', { backlogId: it.id, status: 'review', scheduledAt: at ? new Date(at).toISOString() : null, autoSlot: !at, accountIds }));
    if (status === 'approved') await POST('/posts/approve', { ids: [p.id] });
    toast(status === 'approved' ? `Geplant: ${fmtDT(p.scheduledAt)}` : 'In Review gelegt', 'ok');
    m.close(); await loadState(); render();
  };
  $('#toReview', m.el).onclick = e => go(e.target, 'review');
  $('#approveNow', m.el).onclick = e => go(e.target, 'approved');
}

async function improveTexts(btn) {
  const res = await run(btn, () => POST('/ai/improve-backlog', { projectId: S.project }));
  const m = modal(`<h2>Verbesserte Texte</h2><p class="muted">Basierend auf deinen freigegebenen Learnings und der letzten Analyse. Übernimm, was dir gefällt.</p>
    ${res.map((x, i) => `<div class="card"><div class="grid2"><div><span class="lbl">Vorher</span><p><b>${esc(x.before?.title)}</b></p><p class="muted">${esc(x.before?.caption)}</p></div>
      <div><span class="lbl">Nachher</span><p><b>${esc(x.title)}</b></p><p>${esc(x.caption)}</p><p class="muted tiny">${esc(x.why || '')}</p></div></div>
      <div class="row end"><button class="btn sm pri" data-i="${i}">${icon('check', 10)} Übernehmen</button></div></div>`).join('') || '<p>Keine Vorschläge.</p>'}`);
  $$('[data-i]', m.el).forEach(b => b.onclick = async () => { const x = res[b.dataset.i]; await run(b, () => POST('/ai/apply-text', { ref: x.ref, title: x.title, caption: x.caption }), 'Übernommen'); b.closest('.card').style.opacity = .4; b.remove(); });
}

// ── POST-EDITOR ───────────────────────────────────────────────────────
async function editPost(pid) {
  let p = await GET('/posts/' + pid);
  const proj = S.state.projects.find(x => x.id === p.projectId);
  const sel = p.targets.map(t => t.accountId);
  const locked = ['posted'].includes(p.status);
  const m = modal(`<div class="row" style="margin-bottom:14px;padding-right:40px"><h2 class="grow1" style="margin:0">Post bearbeiten</h2>${badge(p.status)}<span class="badge" style="background:${proj?.color}">${esc(proj?.name)}</span></div>
    <div class="editor"><div>${p.mediaPath ? `<div class="thumb"><video src="${fileUrl(p.mediaPath)}" controls playsinline preload="metadata"></video></div>` : thumbHtml(p)}
      <p class="muted tiny mono" style="margin-top:8px">${esc(p.folder || '')}</p>
      <h3 style="margin-top:14px">Verlauf</h3><div class="logbox">${(p.log || []).slice().reverse().map(l => `<div>${fmtDT(l.at)} · ${esc(l.msg)}</div>`).join('') || '–'}</div></div>
    <div>
      <label class="field"><span class="lbl">Titel</span><input id="eTitle" value="${esc(p.title)}" maxlength="100"></label>
      <label class="field"><span class="lbl">Caption <span id="cc"></span></span><textarea id="eCap" style="min-height:150px">${esc(p.caption)}</textarea></label>
      <div class="row" style="gap:0;margin:-6px 0 8px"><button class="btn sm" id="hookBtn">${icon('hook', 10)} Hook prüfen</button><button class="btn sm" id="rwBtn">${icon('spark', 10)} KI-Rewrite</button><button class="btn sm" id="tagBtn">${icon('hash', 10)} Hashtags vorschlagen</button><button class="btn sm" id="undoBtn" ${p.canUndo ? '' : 'disabled'}>${icon('undo', 10)} Undo</button></div>
      <div id="aiOut"></div>
      <label class="field"><span class="lbl">Hashtags (ohne #, mit Leerzeichen getrennt)</span><input id="eTags" value="${esc((p.hashtags || []).join(' '))}"></label>
      <div class="grid2"><label class="field"><span class="lbl">Zeitpunkt</span><input type="datetime-local" id="eAt" value="${toLocalInput(p.scheduledAt)}"></label>
      <label class="field"><span class="lbl">Format</span><select id="eFmt">${['short', 'reel', 'story', 'feed', 'carousel', 'video'].map(f => `<option ${p.format === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label></div>
      <span class="lbl">Konten</span>
      <div class="targets" style="margin-bottom:8px">${p.targets.map(t => `<div class="target">${platIcon(t.platform)} ${esc(accName(t.accountId))} ${badge(t.status)} ${t.attempts ? `<span class="muted tiny">Versuch ${t.attempts}/4</span>` : ''}
        ${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">${icon('link', 12)}</a>` : ''}${t.status === 'awaiting_user' ? `<button class="btn sm" data-mark="${t.accountId}">Als gepostet markieren</button>` : ''}
        ${t.note ? `<span class="muted tiny" style="flex-basis:100%">${esc(t.note)}</span>` : ''}${t.error ? `<span class="err">⚠ ${esc(t.error)}</span>` : ''}</div>`).join('')}</div>
      ${locked ? '' : `<details><summary class="lbl" style="cursor:pointer">Konten ändern</summary>${accountChecks(sel)}</details>`}
      <div class="row end" style="margin-top:16px">
        ${!locked ? `<button class="btn bad" id="delP">${icon('trash', 12)} Entfernen</button>` : ''}
        ${p.status === 'failed' ? `<button class="btn" id="retryP">${icon('refresh', 12)} Erneut senden</button>` : ''}
        <button class="btn" id="saveP">Speichern</button>
        ${['review', 'draft'].includes(p.status) ? `<button class="btn pri" id="apprP">${icon('check', 12)} Freigeben</button>` : ''}
      </div></div></div>`);
  const el = m.el;
  hoverPlay(el);
  const cc = () => $('#cc', el).textContent = `${$('#eCap', el).value.length}/2200`; cc();
  $('#eCap', el).oninput = cc;
  const collect = () => {
    const o = { title: $('#eTitle', el).value, caption: $('#eCap', el).value, hashtags: $('#eTags', el).value, format: $('#eFmt', el).value, scheduledAt: $('#eAt', el).value ? new Date($('#eAt', el).value).toISOString() : null };
    const accs = $$('[name=acc]', el); if (accs.length) o.targets = accs.filter(x => x.checked).map(x => x.value);
    return o;
  };
  const save = () => PUT('/posts/' + pid, collect());
  $('#saveP', el).onclick = async e => { await run(e.target, save, 'Gespeichert'); m.close(); render(); };
  $('#apprP', el) && ($('#apprP', el).onclick = async e => { await run(e.target, async () => { await save(); return POST('/posts/approve', { ids: [pid] }); }, 'Freigegeben'); m.close(); await loadState(); render(); });
  $('#retryP', el) && ($('#retryP', el).onclick = async e => { await run(e.target, async () => { await save(); return POST(`/posts/${pid}/retry`); }, 'Wird erneut gesendet'); m.close(); render(); });
  $('#delP', el) && ($('#delP', el).onclick = async e => { if (!confirm('Post entfernen? Der Short bleibt im Backlog.')) return; await run(e.target, () => DEL('/posts/' + pid), 'Entfernt'); m.close(); await loadState(); render(); });
  $$('[data-mark]', el).forEach(b => b.onclick = async () => { await run(b, () => POST(`/posts/${pid}/mark-posted`, { accountId: b.dataset.mark }), 'Markiert'); m.close(); render(); });
  $('#undoBtn', el).onclick = async e => { const r = await run(e.target, () => POST(`/posts/${pid}/undo`)); $('#eTitle', el).value = r.title; $('#eCap', el).value = r.caption; $('#eTags', el).value = r.hashtags.join(' '); cc(); e.target.disabled = !r.history?.length; };
  $('#hookBtn', el).onclick = async e => {
    const r = await run(e.target, () => POST('/ai/hook', { text: $('#eTitle', el).value + '\n' + $('#eCap', el).value.split('\n')[0], projectId: p.projectId }));
    const sc = r.ai?.score ?? r.local.score;
    $('#aiOut', el).innerHTML = `<div class="card" style="margin-top:4px"><div class="row"><h3 class="grow1" style="margin:0">Hook-Check</h3><b style="font-family:var(--font-h);font-size:12px;color:${sc >= 70 ? 'var(--green)' : sc >= 45 ? 'var(--yellow)' : 'var(--red)'}">${sc}/100</b></div>
      <div class="hook-meter"><i style="width:${sc}%"></i></div>
      <p class="muted tiny">„${esc(r.local.hook)}“</p>
      ${[...(r.ai?.feedback || []), ...r.local.tips].map(t => `<div class="tiny">▸ ${esc(t)}</div>`).join('')}
      ${r.ai?.alternatives?.length ? `<h3 style="margin-top:10px">Alternativen</h3>${r.ai.alternatives.map(a => `<div class="row" style="gap:6px"><span class="grow1">${esc(a)}</span><button class="btn sm" data-alt="${esc(a)}">Nutzen</button></div>`).join('')}` : ''}
      ${r.aiError ? `<p class="muted tiny">KI nicht verfügbar: ${esc(r.aiError)}</p>` : ''}</div>`;
    $$('[data-alt]', el).forEach(b => b.onclick = () => { const c = $('#eCap', el).value.split('\n'); c[0] = b.dataset.alt; $('#eCap', el).value = c.join('\n'); cc(); });
  };
  $('#rwBtn', el).onclick = async e => {
    const instr = prompt('Anweisung für den Rewrite (leer = stärkerer Hook, kürzer, klarer CTA):', '');
    if (instr === null) return;
    await save();
    const r = await run(e.target, () => POST('/ai/rewrite', { title: $('#eTitle', el).value, caption: $('#eCap', el).value, instruction: instr, projectId: p.projectId }));
    if (r.title) $('#eTitle', el).value = r.title; if (r.caption) $('#eCap', el).value = r.caption; cc();
    await save(); $('#undoBtn', el).disabled = false; toast('Rewrite eingesetzt – Undo möglich', 'ok');
  };
  $('#tagBtn', el).onclick = async e => {
    const r = await run(e.target, () => POST('/ai/hashtags', { title: $('#eTitle', el).value, caption: $('#eCap', el).value, projectId: p.projectId }));
    const tags = (r.hashtags || []).map(t => String(t).replace(/^#/, ''));
    $('#aiOut', el).innerHTML = `<div class="card"><h3>Hashtag-Vorschläge</h3>${tags.map(t => `<label class="chip-box"><input type="checkbox" value="${esc(t)}" checked>#${esc(t)}</label>`).join('')}<div class="row end"><button class="btn sm pri" id="useTags">Übernehmen</button></div></div>`;
    $('#useTags', el).onclick = () => { const cur = $('#eTags', el).value.split(/\s+/).filter(Boolean); const add = $$('#aiOut input:checked', el).map(x => x.value); $('#eTags', el).value = [...new Set([...cur, ...add])].join(' '); };
  };
}

// ── PLANEN ────────────────────────────────────────────────────────────
VIEWS.plan = async () => {
  const tab = S.planTab;
  setHeader('Planen', `<label class="row" style="gap:4px"><input type="checkbox" id="allP" ${S.allProjects ? 'checked' : ''}><span class="tiny">Alle Projekte</span></label><button class="btn" id="fill">${icon('plan', 12)} Freie Slots füllen</button>`);
  const d = new Date(S.planDate);
  let from, to;
  if (tab === 'month') { from = new Date(d.getFullYear(), d.getMonth(), 1); from.setDate(from.getDate() - ((from.getDay() + 6) % 7)); to = new Date(from); to.setDate(to.getDate() + 42); }
  else if (tab === 'week') { from = new Date(d); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - ((from.getDay() + 6) % 7)); to = new Date(from); to.setDate(to.getDate() + 7); }
  else { from = new Date(Date.now() - 3 * 86400000); to = new Date(Date.now() + 60 * 86400000); }
  const qp = S.allProjects ? '' : `projectId=${S.project}&`;
  const [plist, slots, failed] = await Promise.all([
    GET(`/posts?${qp}from=${from.toISOString()}&to=${to.toISOString()}`),
    GET(`/slots?from=${new Date().toISOString()}&days=${Math.ceil((to - new Date()) / 86400000) + 1}`),
    GET(`/posts?${qp}status=failed`),
  ]);
  const visSlots = slots.filter(s => (S.allProjects || s.projectId === S.project) && new Date(s.at) >= from && new Date(s.at) < to && !plist.some(p => p.projectId === s.projectId && new Date(p.scheduledAt).getTime() === new Date(s.at).getTime()));
  const title = tab === 'month' ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : tab === 'week' ? `${fmtDate(from)} – ${fmtDate(new Date(to - 1))}` : 'Queue';
  view.innerHTML = `<div class="row"><div class="tab-row">${[['month', 'Monat'], ['week', 'Woche'], ['queue', 'Queue']].map(([k, l]) => `<button class="tab ${tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
    ${tab !== 'queue' ? `<div class="row" style="gap:0;margin-bottom:20px"><button class="btn sm" id="prev">◀</button><button class="btn sm" id="today">Heute</button><button class="btn sm" id="next">▶</button></div>` : ''}<h2 style="margin:0 0 20px">${title}</h2></div>
    ${failed.length ? `<div class="card warn"><h3>${failed.length} fehlgeschlagene(r) Post(s)</h3>${failed.map(p => `<div class="row" style="gap:8px;margin-bottom:6px"><span class="grow1">${esc(p.title)} <span class="muted tiny">· ${fmtDT(p.scheduledAt)}</span><br><span class="tiny" style="color:var(--red)">${esc(p.targets.find(t => t.error)?.error || '')}</span></span><button class="btn sm" data-edit="${p.id}">Beheben</button></div>`).join('')}</div>` : ''}
    <div id="planBody"></div>`;
  const body = $('#planBody');
  const chip = p => `<div class="pchip st-${p.status}" draggable="${p.status !== 'posted'}" data-pid="${p.id}" style="--c:${projColor(p.projectId)}" title="${esc(p.title)} · ${STATUS[p.status]?.[0] || p.status}">${fmtTime(p.scheduledAt)} ${p.targets.map(t => icon(PLAT_IC[t.platform], 11)).join('')}<span class="tx">${esc(p.title)}</span></div>`;
  const ghost = s => `<div class="slot-ghost" title="Freier Slot">${fmtTime(s.at)} frei</div>`;
  if (tab === 'month') {
    const days = [...Array(42)].map((_, i) => { const x = new Date(from); x.setDate(from.getDate() + i); return x; });
    body.innerHTML = `<div class="cal">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(w => `<div class="dow">${w}</div>`).join('')}
      ${days.map(x => { const k = dayKey(x); const ps = plist.filter(p => dayKey(p.scheduledAt) === k).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)); const sl = visSlots.filter(s => dayKey(s.at) === k);
        return `<div class="day ${x.getMonth() !== d.getMonth() ? 'other' : ''} ${k === dayKey(new Date()) ? 'today' : ''}" data-day="${k}"><span class="dn">${x.getDate()}</span>${ps.map(chip).join('')}${sl.slice(0, 3).map(ghost).join('')}</div>`; }).join('')}</div>`;
  } else if (tab === 'week') {
    const days = [...Array(7)].map((_, i) => { const x = new Date(from); x.setDate(from.getDate() + i); return x; });
    const hours = [...Array(18)].map((_, i) => i + 6);
    body.innerHTML = `<div class="wk-wrap"><div class="wk"><div class="h"></div>${days.map(x => `<div class="h" style="${dayKey(x) === dayKey(new Date()) ? 'color:var(--yellow)' : ''}">${fmtDate(x)}</div>`).join('')}
      ${hours.map(h => `<div class="t">${pad(h)}:00</div>${days.map(x => { const k = dayKey(x); const inH = t => dayKey(t) === k && new Date(t).getHours() === h;
        return `<div class="cell" data-day="${k}" data-hour="${h}">${plist.filter(p => inH(p.scheduledAt)).map(chip).join('')}${visSlots.filter(s => inH(s.at)).map(ghost).join('')}</div>`; }).join('')}`).join('')}</div></div>`;
  } else {
    const upcoming = plist.filter(p => p.scheduledAt).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const groups = {};
    for (const p of upcoming) (groups[dayKey(p.scheduledAt)] = groups[dayKey(p.scheduledAt)] || []).push(p);
    body.innerHTML = Object.keys(groups).length ? Object.entries(groups).map(([k, ps]) => `<div class="card"><h3>${fmtDate(k + 'T12:00')}${k === dayKey(new Date()) ? ' · heute' : ''}</h3>
      ${ps.map(p => `<div class="row" style="gap:10px;padding:6px 0;border-bottom:2px dashed var(--panel2);cursor:pointer" data-edit="${p.id}"><b style="font-family:var(--font-h);font-size:10px;width:52px">${fmtTime(p.scheduledAt)}</b><span class="led" style="background:${projColor(p.projectId)}"></span><span class="grow1">${esc(p.title)}</span>${p.targets.map(t => `<span title="${esc(accName(t.accountId))}: ${STATUS[t.status]?.[0]}">${platIcon(t.platform)}</span>`).join('')}${badge(p.status)}</div>`).join('')}</div>`).join('')
      : `<div class="empty card"><span class="big">Queue leer</span>Plane Shorts aus dem Backlog oder fülle freie Slots.</div>`;
  }
  // Interaktion
  $$('[data-tab]').forEach(b => b.onclick = () => { S.planTab = b.dataset.tab; localStorage.setItem('rp.planTab', S.planTab); render(); });
  const shift = dir => { const x = new Date(S.planDate); if (tab === 'month') x.setMonth(x.getMonth() + dir); else x.setDate(x.getDate() + 7 * dir); S.planDate = x; render(); };
  $('#prev') && ($('#prev').onclick = () => shift(-1)); $('#next') && ($('#next').onclick = () => shift(1)); $('#today') && ($('#today').onclick = () => { S.planDate = new Date(); render(); });
  $('#allP').onchange = e => { S.allProjects = e.target.checked; localStorage.setItem('rp.allProjects', S.allProjects ? '1' : '0'); render(); };
  $('#fill').onclick = e => run(e.target, () => POST('/posts/fill-slots', { projectId: S.project }), r => r.filled ? `${r.filled} Slot(s) gefüllt → Review` : 'Keine freien Slots oder keine neuen Shorts im Backlog').then(() => loadState().then(render));
  view.onclick = e => { const c = e.target.closest('[data-pid],[data-edit]'); if (c) editPost(c.dataset.pid || c.dataset.edit); };
  // Drag & Drop: alle Konten eines Posts wandern gemeinsam
  $$('.pchip[draggable=true]').forEach(c => c.ondragstart = e => { e.dataTransfer.setData('text/plain', c.dataset.pid); e.dataTransfer.effectAllowed = 'move'; });
  $$('[data-day]').forEach(cell => {
    cell.ondragover = e => { e.preventDefault(); cell.classList.add('drop'); };
    cell.ondragleave = () => cell.classList.remove('drop');
    cell.ondrop = async e => {
      e.preventDefault(); cell.classList.remove('drop');
      const pid = e.dataTransfer.getData('text/plain'); const p = plist.find(x => x.id === pid); if (!p) return;
      const old = new Date(p.scheduledAt);
      const [y, mo, da] = cell.dataset.day.split('-').map(Number);
      const nd = new Date(y, mo - 1, da, cell.dataset.hour ? Number(cell.dataset.hour) : old.getHours(), cell.dataset.hour ? 0 : old.getMinutes());
      if (nd < new Date()) return toast('Zeitpunkt liegt in der Vergangenheit', 'err');
      await run(null, () => PUT('/posts/' + pid, { scheduledAt: nd.toISOString() }), `Verschoben auf ${fmtDT(nd)}`);
      render();
    };
  });
};

// ── REVIEW ────────────────────────────────────────────────────────────
VIEWS.review = async () => {
  const list = (await GET(`/posts?projectId=${S.project}&status=review,draft`)).sort((a, b) => (a.scheduledAt || 'z').localeCompare(b.scheduledAt || 'z'));
  setHeader('Queue › Review', list.length ? `<button class="btn ok" id="apprAll">${icon('check', 12)} Alle freigeben (${list.length})</button>` : '');
  view.innerHTML = list.length ? `<div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${list.map(p => `<div class="card">
    <div class="item">${thumbHtml(p)}<div style="min-width:0"><div class="row" style="gap:6px;margin-bottom:6px">${badge(p.status)}${p.source === 'automation' ? '<span class="badge violet">auto</span>' : ''}</div>
    <div class="t">${esc(p.title)}</div><div class="c">${esc(p.caption)}</div>
    <div class="tiny" style="margin-top:6px">${icon('plan', 12)} ${p.scheduledAt ? fmtDT(p.scheduledAt) : '<span style="color:var(--orange)">kein Zeitpunkt → nächster Slot</span>'}</div>
    <div style="margin-top:4px">${p.targets.map(t => platIcon(t.platform)).join(' ') || '<span class="badge red">keine Konten</span>'}</div></div></div>
    <div class="row" style="gap:0;margin-top:10px"><button class="btn sm ok" data-a="ok" data-id="${p.id}">${icon('check', 10)} Freigeben</button><button class="btn sm" data-a="edit" data-id="${p.id}">Bearbeiten</button><button class="btn sm bad" data-a="no" data-id="${p.id}">${icon('x', 10)} Verwerfen</button></div></div>`).join('')}</div>`
    : `<div class="empty card"><span class="big">Alles geprüft ✔</span>Neue Shorts aus Studio und Automationen landen hier zur Freigabe.</div>`;
  hoverPlay(view);
  $('#apprAll') && ($('#apprAll').onclick = e => run(e.target, () => POST('/posts/approve', { all: true, projectId: S.project }), r => `${r.approved} freigegeben${r.skipped ? `, ${r.skipped} übersprungen (keine Konten)` : ''}`).then(() => loadState().then(render)));
  view.onclick = async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    if (b.dataset.a === 'ok') { await run(b, () => POST('/posts/approve', { ids: [b.dataset.id] }), r => r.approved ? 'Freigegeben' : 'Nicht freigegeben – Konten/Zeitpunkt prüfen'); await loadState(); render(); }
    if (b.dataset.a === 'edit') editPost(b.dataset.id);
    if (b.dataset.a === 'no') { await run(b, () => POST(`/posts/${b.dataset.id}/reject`), 'Zurück in den Backlog'); await loadState(); render(); }
  };
};

// ── AUTOMATION ────────────────────────────────────────────────────────
VIEWS.auto = async () => {
  setHeader('Automation', `<button class="btn pri" id="newAuto">${icon('plus', 12)} Neue Automation</button>`);
  const list = (await GET('/automations')).filter(a => a.projectId === S.project);
  const items = await GET('/backlog?projectId=' + S.project);
  view.innerHTML = `<p class="muted" style="max-width:820px">Tägliche Shorts: Ein fertiger Short dient als <b>Rezept</b>. Zur festen Zeit erzeugt der Agent die eingestellte Anzahl neuer Shorts – jedes Mal mit neuem Blickwinkel und auf Basis der neuesten Performance-Analyse. Ergebnisse landen in <a href="#/review">Queue › Review</a>.</p>
    ${list.length ? list.map(a => { const ref = items.find(i => i.id === a.recipeBacklogId); return `<div class="card ${a.enabled ? 'ok' : ''}">
      <div class="row"><span class="led ${a.enabled ? 'on' : ''}"></span><h2 class="grow1" style="margin:0">${esc(a.name)}</h2>
      <button class="btn sm" data-a="run" data-id="${a.id}">${icon('play', 10)} Jetzt</button><button class="btn sm" data-a="edit" data-id="${a.id}">Bearbeiten</button><button class="btn sm" data-a="toggle" data-id="${a.id}">${a.enabled ? 'Pausieren' : 'Aktivieren'}</button><button class="btn sm bad" data-a="del" data-id="${a.id}">${icon('trash', 10)}</button></div>
      <dl class="kv" style="margin-top:12px"><dt>Wann</dt><dd>${a.days.map(d => WD[d]).join(', ')} um ${esc(a.time)} · ${a.count} Short(s) pro Lauf</dd>
      <dt>Rezept</dt><dd>${ref ? esc(ref.title) : '<span class="muted">Referenz-Short nicht gefunden</span>'}</dd>
      <dt>Letzter Lauf</dt><dd>${a.lastRunAt ? fmtDT(a.lastRunAt) : 'noch nie'}${a.runs?.length ? ` · <a href="#/studio/${a.runs[a.runs.length - 1].sessionId}">Chat öffnen</a>` : ''}${a.lastError ? ` <span style="color:var(--red)">⚠ ${esc(a.lastError)}</span>` : ''}</dd></dl></div>`; }).join('')
    : `<div class="empty card"><span class="big">Keine Automationen</span>Öffne einen Chat im Studio mit einem fertigen Short und klick „Als Rezept“ – oder leg hier eine an.</div>`}`;
  $('#newAuto').onclick = () => automationModal({});
  view.onclick = async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = list.find(x => x.id === b.dataset.id);
    if (b.dataset.a === 'run') { const r = await run(b, () => POST(`/automations/${a.id}/run`), 'Lauf gestartet'); location.hash = '#/studio/' + r.sessionId; }
    if (b.dataset.a === 'edit') automationModal(a);
    if (b.dataset.a === 'toggle') { await PUT('/automations/' + a.id, { enabled: !a.enabled }); render(); }
    if (b.dataset.a === 'del') { if (confirm('Automation löschen?')) { await DEL('/automations/' + a.id); render(); } }
  };
};

async function automationModal(a) {
  const items = await GET('/backlog?projectId=' + S.project);
  const days = a.days || [1, 2, 3, 4, 5];
  const m = modal(`<h2>${a.id ? 'Automation bearbeiten' : 'Neue Automation'}</h2>
    <label class="field"><span class="lbl">Name</span><input name="name" value="${esc(a.name || 'Tägliche Shorts')}"></label>
    <label class="field"><span class="lbl">Rezept (Referenz-Short)</span><select name="recipeBacklogId">${items.map(i => `<option value="${i.id}" ${i.id === a.recipeBacklogId ? 'selected' : ''}>${esc(i.title)}</option>`).join('')}</select></label>
    <span class="lbl">Tage</span><div class="days" style="margin:6px 0 12px">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label><input type="checkbox" name="d" value="${d}" ${days.includes(d) ? 'checked' : ''}>${WD[d]}</label>`).join('')}</div>
    <div class="grid2"><label class="field"><span class="lbl">Uhrzeit</span><input type="time" name="time" value="${esc(a.time || '06:00')}"></label>
    <label class="field"><span class="lbl">Shorts pro Lauf</span><input type="number" min="1" max="10" name="count" value="${a.count || 1}"></label></div>
    <label class="field"><span class="lbl">Zusätzliche Anweisung (optional)</span><textarea name="extraPrompt" style="min-height:70px">${esc(a.extraPrompt || '')}</textarea></label>
    <div class="row end"><button class="btn pri" id="saveA">Speichern</button></div>`, { narrow: true });
  $('#saveA', m.el).onclick = async e => {
    const f = readForm(m.el);
    const body = { projectId: S.project, name: f.name, recipeBacklogId: f.recipeBacklogId, recipeSessionId: a.recipeSessionId, time: f.time, count: Number(f.count), extraPrompt: f.extraPrompt, days: $$('[name=d]:checked', m.el).map(x => Number(x.value)) };
    if (!body.recipeBacklogId) return toast('Wähle einen Referenz-Short (erst einen Short erzeugen).', 'err');
    await run(e.target, () => a.id ? PUT('/automations/' + a.id, body) : POST('/automations', body), 'Gespeichert');
    m.close(); location.hash = '#/auto'; render();
  };
}

// ── WACHSEN ───────────────────────────────────────────────────────────
VIEWS.grow = async () => {
  setHeader('Wachsen', `<button class="btn" id="refreshS">${icon('refresh', 12)} Stats aktualisieren</button><button class="btn pri" id="analyze">${icon('spark', 12)} Analyse jetzt</button>`);
  const accs = S.state.accounts.filter(a => a.projectId === S.project);
  const accId = S.growAcc && accs.some(a => a.id === S.growAcc) ? S.growAcc : '';
  const [data, learnings] = await Promise.all([GET(`/analytics?projectId=${S.project}${accId ? '&accountId=' + accId : ''}`), GET('/learnings?projectId=' + S.project)]);
  const I = data.insights;
  const tabs = [['overview', 'Übersicht'], ['insights', 'Analyse'], ['learnings', `Learnings${learnings.filter(l => l.status === 'proposed').length ? ' (' + learnings.filter(l => l.status === 'proposed').length + ')' : ''}`], ['tools', 'Werkzeuge']];
  view.innerHTML = `<div class="row"><div class="tab-row">${tabs.map(([k, l]) => `<button class="tab ${S.growTab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
    <select id="accF" style="width:auto;margin-bottom:20px"><option value="">Alle Konten</option>${accs.map(a => `<option value="${a.id}" ${a.id === accId ? 'selected' : ''}>${esc(a.name)} (${a.platform})</option>`).join('')}</select>
    <span class="muted tiny" style="margin-bottom:20px">Stats: ${data.lastStatsAt ? ago(data.lastStatsAt) : 'nie'} · letzte 90 Tage</span></div><div id="growBody"></div>`;
  const body = $('#growBody');
  const bars = (list, { c = 'var(--cyan)' } = {}) => { const max = Math.max(2, ...list.map(x => x.avgRatio)); return `<div class="bars">${list.map(x => `<div class="bar"><span>${esc(x.key)}</span><div class="track"><div class="fill" style="width:${x.avgRatio / max * 100}%;--c:${x.avgRatio >= 1.5 ? 'var(--green)' : x.avgRatio <= .5 ? 'var(--red)' : c}"></div><div class="mid" style="left:${100 / max}%"></div></div><span class="num">×${x.avgRatio} <span class="muted">n${x.n}</span></span></div>`).join('') || '<p class="muted tiny">zu wenig Daten</p>'}</div>`; };
  if (S.growTab === 'overview') {
    body.innerHTML = `<div class="kpis"><div class="kpi"><span class="lbl">Posts</span><b>${I.count}</b></div><div class="kpi"><span class="lbl">Aufrufe</span><b>${n(I.totals.views)}</b></div><div class="kpi"><span class="lbl">Likes</span><b>${n(I.totals.likes)}</b></div><div class="kpi"><span class="lbl">Kommentare</span><b>${n(I.totals.comments)}</b></div><div class="kpi"><span class="lbl">Stark ≥×1,5</span><b style="color:var(--green)">${I.strong}</b></div><div class="kpi"><span class="lbl">Schwach ≤×0,5</span><b style="color:var(--red)">${I.weak}</b></div></div>
    <div class="card" style="margin-top:22px"><div class="table-wrap"><table><thead><tr><th>Datum</th><th>Konto</th><th>Titel / Hook</th><th class="num">Aufrufe</th><th class="num">Likes</th><th class="num">Komm.</th><th class="num">vs. Median</th><th></th></tr></thead><tbody>
    ${data.rows.map(r => `<tr><td>${fmtDate(r.publishedAt)}</td><td>${platIcon(r.platform)} ${esc(accName(r.accountId))}${r.external ? ' <span class="badge" title="nicht über RetroPost gepostet">ext</span>' : ''}</td><td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>` : esc(r.title)}</td><td class="num">${n(r.views)}</td><td class="num">${n(r.likes)}</td><td class="num">${n(r.comments)}</td><td class="num r-${r.rating}">×${r.ratio} ${r.rating === 'strong' ? '▲' : r.rating === 'weak' ? '▼' : ''}</td>
      <td><div class="row" style="gap:0;flex-wrap:nowrap">${r.rating === 'strong' ? `<button class="btn sm" data-remake="${esc(r.accountId + ':' + r.remoteId)}" title="Im Studio nachbauen">${icon('studio', 10)}</button>` : ''}${r.comments ? `<button class="btn sm" data-replies="${esc(r.accountId + ':' + r.remoteId)}" title="Antwortvorschläge">💬</button>` : ''}</div></td></tr>`).join('') || `<tr><td colspan="8" class="empty">Noch keine Daten – Konten verbinden und „Stats aktualisieren“.</td></tr>`}
    </tbody></table></div></div>`;
  } else if (S.growTab === 'insights') {
    body.innerHTML = `<div class="grid2">
      <div class="card"><h3>Hooks – beste</h3>${I.hooks.best.map(h => `<div class="row tiny" style="gap:8px"><span class="r-strong">×${h.ratio}</span><span class="grow1">${esc(h.hook)}</span></div>`).join('') || '<p class="muted tiny">–</p>'}
        <h3 style="margin-top:14px">Hooks – schwächste</h3>${I.hooks.worst.map(h => `<div class="row tiny" style="gap:8px"><span class="r-weak">×${h.ratio}</span><span class="grow1">${esc(h.hook)}</span></div>`).join('') || '<p class="muted tiny">–</p>'}
        <h3 style="margin-top:14px">Hook-Merkmale</h3>${I.hooks.features.map(f => `<div class="tiny">${esc(f.key)}: ×${f.with} mit / ×${f.without} ohne <span class="muted">(n${f.n})</span></div>`).join('')}</div>
      <div class="card"><h3>Call-to-Action</h3>${bars(I.cta)}<h3 style="margin-top:18px">Länge</h3>${bars(I.length)}</div>
      <div class="card"><h3>Hashtag-Anzahl</h3>${bars(I.hashtagCount)}<h3 style="margin-top:18px">Top-Hashtags</h3>${bars(I.topTags)}</div>
      <div class="card"><h3>Beste Wochentage</h3>${bars(I.weekday)}<h3 style="margin-top:18px">Beste Uhrzeiten</h3>${bars(I.hour)}</div></div>
      <p class="muted tiny">×1 = Median des Kontos (gelbe Linie). Grün ≥ ×1,5 stark, rot ≤ ×0,5 schwach.</p>`;
  } else if (S.growTab === 'learnings') {
    const grp = st => learnings.filter(l => l.status === st);
    body.innerHTML = `<div class="card hl"><h3>Vorgeschlagen (wöchentliche Analyse)</h3><p class="muted tiny">Nur freigegebene Learnings fließen in künftige Texte, Rewrites und Studio-Chats ein.</p>
      ${grp('proposed').map(l => `<div class="learning"><div class="grow1">${esc(l.text)}<small>${esc(l.evidence || '')} · ${ago(l.createdAt)}</small></div><button class="btn sm ok" data-l="approved" data-id="${l.id}">${icon('check', 10)}</button><button class="btn sm bad" data-l="rejected" data-id="${l.id}">${icon('x', 10)}</button></div>`).join('') || '<p class="muted tiny">Keine offenen Vorschläge. „Analyse jetzt“ startet eine.</p>'}</div>
      <div class="card ok"><h3>Freigegeben</h3>${grp('approved').map(l => `<div class="learning"><div class="grow1">${esc(l.text)}<small>${esc(l.evidence || '')}</small></div><button class="btn sm ghost" data-l="del" data-id="${l.id}">${icon('trash', 10)}</button></div>`).join('') || '<p class="muted tiny">–</p>'}
        <div class="row"><input id="newL" class="grow1" placeholder="Eigenes Learning hinzufügen …"><button class="btn sm" id="addL">${icon('plus', 10)}</button></div></div>
      ${grp('rejected').length ? `<details><summary class="lbl" style="cursor:pointer">Abgelehnt (${grp('rejected').length})</summary>${grp('rejected').map(l => `<div class="learning"><div class="grow1 muted">${esc(l.text)}</div><button class="btn sm" data-l="approved" data-id="${l.id}">Doch freigeben</button></div>`).join('')}</details>` : ''}`;
  } else {
    body.innerHTML = `<div class="grid2">
      <div class="card"><h3>Nächste 2 Wochen planen</h3><p class="muted tiny">Ideen für die freien Slots, basierend auf Analyse und Learnings.</p><button class="btn pri" id="plan2">${icon('plan', 12)} Plan vorschlagen</button><div id="planOut"></div></div>
      <div class="card"><h3>Backlog-Texte verbessern</h3><p class="muted tiny">Überarbeitet Titel/Captions aller noch nicht veröffentlichten Shorts.</p><button class="btn" id="impr">${icon('spark', 12)} Texte verbessern</button></div>
      <div class="card"><h3>Profil-Kit</h3><p class="muted tiny">Bio-Varianten sofort; Highlight-Cover und Banner rendert der Agent im Studio nach <span class="mono">profile-kit/</span>. Hochladen machst du selbst.</p><div class="row" style="gap:0"><button class="btn" id="bios">Bio-Varianten</button><button class="btn" id="kit">${icon('studio', 12)} Cover & Banner im Studio</button></div><div id="bioOut"></div></div>
      <div class="card"><h3>Antwortvorschläge</h3><p class="muted tiny">In der Übersicht bei Posts mit Kommentaren auf 💬 klicken (YouTube & Instagram).</p></div></div>`;
  }
  $$('[data-tab]').forEach(b => b.onclick = () => { S.growTab = b.dataset.tab; render(); });
  $('#accF').onchange = e => { S.growAcc = e.target.value; render(); };
  $('#refreshS').onclick = e => run(e.target, () => POST('/analytics/refresh', {}), r => `Aktualisiert: ${r.ok.length} Konto/en${r.failed.length ? ' · Fehler: ' + r.failed.join('; ') : ''}`).then(render);
  $('#analyze').onclick = e => run(e.target, () => POST('/analytics/analyze', { projectId: S.project }), r => `${r.length} Learnings vorgeschlagen`).then(() => { S.growTab = 'learnings'; loadState().then(render); });
  view.onclick = async e => {
    const lb = e.target.closest('[data-l]');
    if (lb) { if (lb.dataset.l === 'del') await DEL('/learnings/' + lb.dataset.id); else await PUT('/learnings/' + lb.dataset.id, { status: lb.dataset.l }); await loadState(); return render(); }
    const rm = e.target.closest('[data-remake]');
    if (rm) { const r = data.rows.find(x => x.accountId + ':' + x.remoteId === rm.dataset.remake); const s = await run(rm, () => POST('/sessions', { projectId: S.project, prompt: `Dieser Short lief stark (×${r.ratio} über Median, ${n(r.views)} Aufrufe):\nTitel: ${r.title}\nCaption: ${r.caption}\n\nMach daraus einen neuen Short mit demselben Erfolgsrezept (Hook-Muster, Länge, Aufbau), aber neuem Thema/Blickwinkel.` })); location.hash = '#/studio/' + s.id; }
    const rp = e.target.closest('[data-replies]');
    if (rp) { const r = await run(rp, () => POST('/ai/replies', { statKey: rp.dataset.replies })); modal(`<h2>Antwortvorschläge</h2>${r.comments.map(c => { const rep = r.replies.find(x => x.id === c.id)?.reply || ''; return `<div class="card"><p><b>${esc(c.author)}:</b> ${esc(c.text)}</p><div class="row"><textarea class="grow1" style="min-height:60px">${esc(rep)}</textarea><button class="btn sm" onclick="navigator.clipboard.writeText(this.previousElementSibling.value);this.textContent='Kopiert'">Kopieren</button></div></div>`; }).join('') || '<p>Keine Kommentare.</p>'}<p class="muted tiny">Antworten postest du selbst – RetroPost antwortet nie automatisch.</p>`); }
  };
  $('#addL') && ($('#addL').onclick = async () => { const t = $('#newL').value.trim(); if (!t) return; await POST('/learnings', { projectId: S.project, text: t }); render(); });
  $('#plan2') && ($('#plan2').onclick = async e => {
    const r = await run(e.target, () => POST('/ai/plan', { projectId: S.project }));
    $('#planOut').innerHTML = `<div style="margin-top:12px">${(r.plan || []).map(x => `<div class="learning"><div class="grow1"><b>${esc(x.at)}</b> · <span class="badge">${esc(x.format || 'short')}</span><br>${esc(x.idea)}<small>Hook: ${esc(x.hook || '')}</small></div></div>`).join('')}${r.notes ? `<p class="muted tiny">${esc(r.notes)}</p>` : ''}<button class="btn pri" id="planStudio">${icon('studio', 12)} Als Serie im Studio erzeugen</button></div>`;
    $('#planStudio').onclick = async ev => { const s = await run(ev.target, () => POST('/sessions', { projectId: S.project, series: (r.plan || []).length, prompt: 'Erzeuge diese Shorts als Serie:\n' + (r.plan || []).map((x, i) => `${i + 1}. ${x.idea} – Hook: ${x.hook} (${x.format || 'short'})`).join('\n') })); location.hash = '#/studio/' + s.id; };
  });
  $('#impr') && ($('#impr').onclick = e => improveTexts(e.target));
  $('#bios') && ($('#bios').onclick = async e => { const r = await run(e.target, () => POST('/ai/bios', { projectId: S.project })); $('#bioOut').innerHTML = (r.bios || []).map(b => `<div class="learning"><div class="grow1"><span class="badge">${esc(b.platform)}</span> ${esc(b.text)}</div><button class="btn sm" onclick="navigator.clipboard.writeText(${esc(JSON.stringify(b.text))});this.textContent='✔'">Kopieren</button></div>`).join(''); });
  $('#kit') && ($('#kit').onclick = async e => { const s = await run(e.target, () => POST('/sessions', { projectId: S.project, preset: 'profile' })); location.hash = '#/studio/' + s.id; });
};

// ── KONTEN ────────────────────────────────────────────────────────────
VIEWS.accounts = async () => {
  setHeader('Konten');
  const st = S.state;
  const accs = st.accounts.filter(a => a.projectId === S.project);
  view.innerHTML = !S.project ? '<div class="card">Erst ein Projekt anlegen.</div>' : ['youtube', 'instagram', 'tiktok'].map(pl => {
    const P = st.platforms[pl];
    return `<div class="card"><div class="row"><span style="font-size:0">${platIcon(pl, 26)}</span><h2 class="grow1" style="margin:0">${P.label}</h2>${P.configured ? '<span class="badge green">App konfiguriert</span>' : '<span class="badge red">.env fehlt</span>'}<button class="btn sm pri" data-add="${pl}">${icon('plus', 10)} Konto</button></div>
      ${P.configured ? '' : `<p class="muted tiny" style="margin-top:10px">Trage die Zugangsdaten deiner eigenen ${pl === 'youtube' ? 'Google-Cloud' : pl === 'instagram' ? 'Meta' : 'TikTok'}-App in <span class="mono">.env</span> ein (siehe docs/SETUP.md) und starte RetroPost neu.${pl !== 'youtube' ? ' Benötigt außerdem PUBLIC_BASE_URL (eigener Cloudflare Tunnel).' : ''}</p>`}
      ${P.redirectUri ? `<p class="muted tiny">Redirect-URI: <span class="mono">${esc(P.redirectUri)}</span></p>` : ''}
      <div style="margin-top:12px">${accs.filter(a => a.platform === pl).map(a => `<div class="target" style="margin-bottom:8px;padding:10px">
        <span class="led ${a.connected ? 'on' : 'err'}"></span><b class="grow1">${esc(a.name)} ${a.identity ? `<span class="muted">@${esc(a.identity.handle)}</span>` : ''}</b>
        ${a.chromeProfile ? `<span class="badge">Chrome: ${esc(a.chromeProfile)}</span>` : ''}${pl === 'tiktok' ? `<span class="badge orange">${esc({ studio: 'TikTok Studio', draft: 'Entwürfe', private: 'Nur ich' }[a.tiktokMode])}</span>` : ''}
        ${a.tokenExpiresAt ? `<span class="muted tiny">Token bis ${fmtDT(a.tokenExpiresAt)}</span>` : ''}
        <button class="btn sm ${a.connected ? '' : 'pri'}" data-connect="${a.id}">${a.connected ? 'Neu verbinden' : 'Verbinden'}</button><button class="btn sm" data-edit="${a.id}">Bearbeiten</button>${a.connected ? `<button class="btn sm ghost" data-disc="${a.id}">Trennen</button>` : ''}<button class="btn sm bad" data-del="${a.id}">${icon('trash', 10)}</button>
        ${a.lastError ? `<span class="err">⚠ ${esc(a.lastError)}</span>` : ''}</div>`).join('') || '<p class="muted tiny">Noch kein Konto.</p>'}</div>
      <p class="muted tiny">${{ youtube: 'Shorts & normale Videos · ca. 100 Uploads/Tag pro Google-Cloud-Projekt (geteilt) · lädt vorab hoch, YouTube veröffentlicht auch bei ausgeschaltetem Rechner. Testmodus-Login läuft nach 7 Tagen ab, bis die OAuth-App in Produktion ist.', instagram: 'Reel, Story, Feed-Bild, Karussell (2–20 Bilder) · ca. 50–100 Posts/Tag · Professional-Konto + Meta-Developer-App nötig · Medien über deinen Tunnel (Links 1 h gültig).', tiktok: 'Video & Foto-Karussell (1–35 Bilder, Tunnel + verifizierte Domain) · ca. 15 Posts/Tag · Modi: TikTok Studio (öffentlich, du klickst Posten), Entwürfe oder „Nur ich“ (bis deine App das Audit bestanden hat).' }[pl]}</p></div>`;
  }).join('');
  view.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.add) accountModal({ platform: b.dataset.add });
    if (b.dataset.edit) accountModal(accs.find(a => a.id === b.dataset.edit));
    if (b.dataset.connect) {
      const r = await run(b, () => POST(`/accounts/${b.dataset.connect}/connect`));
      if (r.openedInProfile) toast('Login im Chrome-Profil geöffnet', 'ok'); else window.open(r.url, 'retropost-oauth', 'width=620,height=760');
    }
    if (b.dataset.disc) { await POST(`/accounts/${b.dataset.disc}/disconnect`); await loadState(); render(); }
    if (b.dataset.del) { if (!confirm('Konto entfernen?')) return; await DEL('/accounts/' + b.dataset.del); await loadState(); render(); }
  };
};
function accountModal(a) {
  const m = modal(`<h2>${a.id ? 'Konto bearbeiten' : 'Konto hinzufügen'} · ${S.state.platforms[a.platform].label}</h2>
    <label class="field"><span class="lbl">Anzeigename</span><input name="name" value="${esc(a.name || '')}" placeholder="z. B. Hauptkanal / Kunde X"></label>
    <label class="field"><span class="lbl">Chrome-Profil (optional, z. B. "Profile 2")</span><input name="chromeProfile" value="${esc(a.chromeProfile || '')}" placeholder="Default"></label>
    <p class="muted tiny" style="margin-top:-6px">Jedes Konto meldet sich in seinem eigenen Chrome-Profil an – so kommen sich mehrere Konten pro Plattform nicht in die Quere. Profilname: chrome://version → „Profilpfad“, letzter Ordner.</p>
    ${a.platform === 'tiktok' ? `<label class="field"><span class="lbl">Posting-Modus</span><select name="tiktokMode">${[['studio', 'TikTok Studio (Extension füllt aus, du klickst Posten → öffentlich)'], ['draft', 'Entwürfe / Inbox (per API)'], ['private', 'Direkt als „Nur ich“ (öffentlich nach Audit)']].map(([k, l]) => `<option value="${k}" ${a.tiktokMode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
    <div class="row end"><button class="btn pri" id="saveAcc">Speichern</button></div>`, { narrow: true });
  $('#saveAcc', m.el).onclick = async e => {
    const f = readForm(m.el);
    await run(e.target, () => a.id ? PUT('/accounts/' + a.id, f) : POST('/accounts', { ...f, platform: a.platform, projectId: S.project }), 'Gespeichert');
    m.close(); await loadState(); render();
  };
}

// ── PROJEKTE ──────────────────────────────────────────────────────────
VIEWS.projects = async () => {
  setHeader('Projekte', `<button class="btn" id="newP">${icon('plus', 12)} Neues Projekt</button>`);
  const p = project();
  $('#newP').onclick = () => { const m = modal(`<h2>Neues Projekt</h2>${projectForm()}<div class="row end"><button class="btn pri" id="cp">Anlegen</button></div>`); $('#cp', m.el).onclick = e => { createProject(e.target).then(m.close); }; };
  if (!p) return renderWelcome();
  const accs = S.state.accounts.filter(a => a.projectId === p.id);
  const slots = [...(p.slots || [])].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) || a.time.localeCompare(b.time));
  view.innerHTML = `<div class="tab-row">${S.state.projects.map(x => `<button class="tab ${x.id === p.id ? 'on' : ''}" data-proj="${x.id}">${esc(x.name)}</button>`).join('')}</div>
    <div class="card raised"><h2>Projekt</h2>${projectForm(p)}
      <div class="grid2"><label class="field"><span class="lbl">Helfer-Agent (optional, z. B. "codex exec")</span><input name="helperAgent" value="${esc(p.helperAgent || '')}"></label>
      <label class="field"><span class="lbl">Wofür?</span><input name="helperTask" value="${esc(p.helperTask || '')}" placeholder="Bildgenerierung"></label></div>
      <label class="field"><span class="lbl">KI-Notizen (Zielgruppe, Ton, Do's & Don'ts)</span><textarea name="aiNotes">${esc(p.aiNotes || '')}</textarea></label>
      <div class="row"><label class="row" style="gap:4px"><input type="checkbox" name="weeklyAnalysis" ${p.weeklyAnalysis !== false ? 'checked' : ''}> Wöchentliche Analyse</label><label class="row" style="gap:4px"><span class="lbl">Farbe</span><input type="color" name="color" value="${esc(p.color || '#ff5fa2')}" style="width:60px;padding:2px"></label>
      <span class="grow1"></span><button class="btn bad" id="delProj">${icon('trash', 12)} Löschen</button><button class="btn pri" id="saveProj">Speichern</button></div></div>
    <div class="card"><h2>Posting-Slots</h2><p class="muted tiny">Einmal festlegen – „Freie Slots füllen“ verteilt neue Shorts aus dem Backlog darauf.</p>
      <div id="slots">${slots.map(s => slotRow(s, accs)).join('')}</div>
      <div class="row"><button class="btn sm" id="addSlot">${icon('plus', 10)} Slot</button><button class="btn sm" id="addWeekdays">Mo–Fr 18:00</button><span class="grow1"></span><button class="btn pri" id="saveSlots">Slots speichern</button></div></div>
    <div class="card"><h2>Befehlsfreigaben</h2><p class="muted tiny">Diese Befehle darf der Agent im Projekt ohne Rückfrage ausführen (Claude-Code-Syntax, eine Regel pro Zeile). Alles andere landet als Freigabe-Karte im Studio. Catch-all-Regeln wie <span class="mono">Bash</span> oder <span class="mono">Bash(*)</span> werden abgelehnt.</p>
      <textarea id="perms" style="min-height:150px">${esc((p.permissions?.allow || []).join('\n'))}</textarea>
      <div class="row end"><button class="btn pri" id="savePerms">Freigaben speichern</button></div></div>`;
  $$('[data-proj]').forEach(b => b.onclick = () => { S.project = b.dataset.proj; localStorage.setItem('rp.project', S.project); render(); });
  $('#saveProj').onclick = async e => {
    const f = readForm(e.target.closest('.card'));
    f.contentDirs = f.contentDirs.split('\n').map(s => s.trim()).filter(Boolean);
    await run(e.target, () => PUT('/projects/' + p.id, f), 'Gespeichert'); await loadState(); render();
  };
  $('#delProj').onclick = async e => { if (!confirm(`Projekt „${p.name}“ löschen? (Dateien im Repo bleiben erhalten)`)) return; await run(e.target, () => DEL('/projects/' + p.id)); await loadState(); render(); };
  $('#addSlot').onclick = () => $('#slots').insertAdjacentHTML('beforeend', slotRow({ weekday: 1, time: '18:00', accountIds: accs.map(a => a.id) }, accs));
  $('#addWeekdays').onclick = () => [1, 2, 3, 4, 5].forEach(d => $('#slots').insertAdjacentHTML('beforeend', slotRow({ weekday: d, time: '18:00', accountIds: accs.map(a => a.id) }, accs)));
  $('#slots').onclick = e => { if (e.target.closest('[data-rm]')) e.target.closest('.slot').remove(); };
  $('#saveSlots').onclick = async e => {
    const slotsOut = $$('.slot').map(r => ({ id: r.dataset.id || undefined, weekday: Number($('[name=wd]', r).value), time: $('[name=tm]', r).value, accountIds: $$('[name=sa]:checked', r).map(x => x.value) }));
    await run(e.target, () => PUT('/projects/' + p.id, { slots: slotsOut }), 'Slots gespeichert'); await loadState(); render();
  };
  $('#savePerms').onclick = async e => {
    const r = await run(e.target, () => PUT('/projects/' + p.id, { permissions: { allow: $('#perms').value.split('\n').map(s => s.trim()).filter(Boolean) } }));
    toast(r.rejected?.length ? `Abgelehnt (Catch-all): ${r.rejected.join(', ')}` : 'Freigaben gespeichert', r.rejected?.length ? 'err' : 'ok'); await loadState(); render();
  };
};
function slotRow(s, accs) {
  return `<div class="slot target" data-id="${esc(s.id || '')}" style="margin-bottom:6px"><select name="wd" style="width:90px">${[1, 2, 3, 4, 5, 6, 0].map(d => `<option value="${d}" ${Number(s.weekday) === d ? 'selected' : ''}>${WD[d]}</option>`).join('')}</select>
    <input type="time" name="tm" value="${esc(s.time)}" style="width:120px">${accs.map(a => `<label class="row" style="gap:2px"><input type="checkbox" name="sa" value="${a.id}" ${(s.accountIds || []).includes(a.id) ? 'checked' : ''}>${platIcon(a.platform)}<span class="tiny">${esc(a.name)}</span></label>`).join('') || '<span class="muted tiny">keine Konten</span>'}
    <span class="grow1"></span><button class="btn sm bad" data-rm>${icon('x', 10)}</button></div>`;
}

// ── SYSTEM / EINSTELLUNGEN ────────────────────────────────────────────
VIEWS.settings = async () => {
  setHeader('System');
  const st = S.state, s = st.settings;
  const [doc, logs, ext] = await Promise.all([GET('/doctor'), GET('/logs'), GET('/ext-token')]);
  const svc = (name, on, key, extra = '') => `<div class="target" style="padding:10px;margin-bottom:8px"><span class="led ${on ? 'on' : 'err'}"></span><b class="grow1">${name}</b>${extra}<button class="btn sm ${on ? 'bad' : 'ok'}" data-svc="${key}" data-act="${on ? 'stop' : 'start'}">${on ? icon('stop', 10) + ' Stop' : icon('play', 10) + ' Start'}</button></div>`;
  view.innerHTML = `<div class="grid2">
    <div class="card raised"><h2>Dienste</h2>
      ${svc('Posting-Worker', st.worker.running, 'worker', `<span class="muted tiny">Tick ${st.worker.lastTick ? ago(st.worker.lastTick) : '–'}</span>`)}
      ${svc('Gateway :' + st.gateway.port, st.gateway.running, 'gateway', '<span class="muted tiny">Medien-Links & OAuth</span>')}
      ${svc('Cloudflare Tunnel', st.tunnel.running, 'tunnel', `<span class="muted tiny">${esc(st.tunnel.publicUrl || (st.tunnel.installed ? st.tunnel.mode : 'cloudflared fehlt'))}</span>`)}
      <p class="muted tiny">Retries nach 1, 5, 15 und 60 Minuten. Autostart beim Login: <span class="mono">npm run autostart:install</span>. Nach Abstürzen startet RetroPost selbst neu.</p>
      ${st.dryRun ? '<p><span class="badge orange">DRY-RUN aktiv</span> <span class="tiny">Es wird nichts wirklich gepostet (RETROPOST_DRY_RUN=1).</span></p>' : ''}</div>
    <div class="card"><h2>Posting</h2>
      <label class="field"><span class="lbl">Toleranz für verpasste Posts (Minuten)</span><input type="number" name="toleranceMin" value="${s.toleranceMin}" min="0"></label>
      <label class="field"><span class="lbl">YouTube vorab hochladen (Tage im Voraus, 0 = aus)</span><input type="number" name="uploadAheadDays" value="${s.uploadAheadDays}" min="0" max="30"></label>
      <label class="row" style="gap:4px;margin-bottom:12px"><input type="checkbox" name="wakeEnabled" ${s.wakeEnabled ? 'checked' : ''}> Rechner zum nächsten Post aufwecken <span class="muted tiny">(pmset / rtcwake via sudo -n, Windows-Aufgabe)</span></label>
      <label class="field"><span class="lbl">Standard-Agent</span><select name="defaultAgent">${['claude', 'codex', 'cursor'].map(a => `<option ${s.defaultAgent === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
      <div class="grid2"><label class="field"><span class="lbl">Theme</span><select name="theme"><option value="console" ${s.theme !== 'handheld' ? 'selected' : ''}>Konsole (dunkel)</option><option value="handheld" ${s.theme === 'handheld' ? 'selected' : ''}>Handheld (hell)</option></select></label>
      <label class="row" style="gap:4px"><input type="checkbox" name="scanlines" ${s.scanlines ? 'checked' : ''}> CRT-Scanlines</label></div>
      <div class="row end"><button class="btn pri" id="saveSet">Speichern</button></div></div>
    <div class="card"><h2>Setup-Check</h2>
      <h3>.env</h3>${Object.entries(doc.env).map(([k, v]) => `<div class="row tiny" style="gap:8px"><span class="led ${v ? 'on' : 'err'}"></span><span class="mono">${k}</span>${v ? '' : '<span class="muted">leer</span>'}</div>`).join('')}
      <h3 style="margin-top:12px">Werkzeuge</h3>${Object.entries(doc.tools).map(([k, v]) => `<div class="row tiny" style="gap:8px"><span class="led ${v ? 'on' : ''}"></span>${k}</div>`).join('')}
      <p class="muted tiny" style="margin-top:10px">Geführtes Setup: <span class="mono">/setup</span> in Claude Code (oder Codex/Cursor bitten, AGENTS.md zu folgen). Secrets trägst du selbst in .env ein.</p></div>
    <div class="card"><h2>Pfade</h2><dl class="kv"><dt>Daten</dt><dd class="mono">${esc(st.dataDir)}</dd><dt>Datenbank</dt><dd class="mono">${esc(st.dbFile)}</dd><dt>Log</dt><dd class="mono">${esc(st.logFile)}</dd><dt>Tokens</dt><dd>verschlüsselt · Schlüssel: ${esc(st.keyBackend)}</dd><dt>Version</dt><dd>${esc(st.version)}</dd></dl>
      <h3 style="margin-top:16px">TikTok-Studio-Extension</h3><p class="muted tiny">Ordner <span class="mono">extension/</span> in chrome://extensions laden (Entwicklermodus → „Entpackte Erweiterung laden“) – in jedem Chrome-Profil, das ein TikTok-Konto nutzt – und diesen Token eintragen:</p>
      <div class="row"><input readonly value="${esc(ext.token)}" class="grow1 mono"><button class="btn sm" onclick="navigator.clipboard.writeText('${esc(ext.token)}');this.textContent='✔'">Kopieren</button></div></div></div>
    <div class="card"><div class="row"><h2 class="grow1" style="margin:0">Log</h2><button class="btn sm" id="reLog">${icon('refresh', 10)}</button></div><pre class="log" id="log">${esc(logs.text)}</pre></div>`;
  const lg = $('#log'); lg.scrollTop = lg.scrollHeight;
  $('#reLog').onclick = () => render();
  $$('[data-svc]').forEach(b => b.onclick = async () => { await run(b, () => POST(`/${b.dataset.svc}/${b.dataset.act}`)); await loadState(); render(); });
  $('#saveSet').onclick = async e => {
    const f = readForm(e.target.closest('.card'));
    await run(e.target, () => PUT('/settings', { ...f, toleranceMin: Number(f.toleranceMin), uploadAheadDays: Number(f.uploadAheadDays) }), 'Gespeichert');
    await loadState(); render();
  };
};

// ── Start ─────────────────────────────────────────────────────────────
(async () => {
  try { await loadState(); render(); }
  catch (e) { view.innerHTML = `<div class="card warn"><h2>Keine Verbindung</h2><p>${esc(e.message)}</p><p>Läuft RetroPost? <span class="mono">npm start</span></p></div>`; }
})();
