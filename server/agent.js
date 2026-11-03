'use strict';
// Studio: lässt deinen KI-Agenten (Claude Code / Codex / Cursor) im Projekt-Repo arbeiten.
// Max. 4 gleichzeitige Sessions. Abgelehnte Befehle → Freigabe-Karte → Session wird fortgesetzt.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const backlog = require('./backlog');
const perms = require('./permissions');
const ai = require('./ai');
const { id, log, which, ROOT, DATA_DIR } = require('./util');

const MAX_RUNNING = 4;
const procs = new Map();      // sessionId -> child
const subs = new Map();       // sessionId -> Set<fn>

function subscribe(sid, fn) { if (!subs.has(sid)) subs.set(sid, new Set()); subs.get(sid).add(fn); return () => subs.get(sid)?.delete(fn); }
function push(s, ev) {
  ev.at = Date.now();
  s.events.push(ev);
  if (s.events.length > 1500) s.events = s.events.slice(-1500);
  store.save();
  for (const fn of subs.get(s.id) || []) try { fn(ev); } catch {}
}
const globalSubs = new Set();
const onSessions = fn => (globalSubs.add(fn), () => globalSubs.delete(fn));
const notify = () => { for (const fn of globalSubs) try { fn(); } catch {} };

const runningCount = () => procs.size;

const PRESETS = {
  brand: {
    label: 'Brand-Setup',
    prompt: `Richte das Branding für dieses Projekt ein:
1. Sammle Logos, Farben, Schriften und Screenshots (frag mich nach fehlenden Dateien oder suche sie im Repo) in den Ordner brand/ (brand/logo/, brand/fonts/, brand/screens/, brand/colors.json).
2. Baue eine wiederverwendbare Render-Vorlage in brand/template/ (z. B. Remotion oder ffmpeg-Skript), die 1080x1920-Shorts mit Intro-Hook, Hauptteil und CTA erzeugt.
3. Rendere ein kurzes Testvideo und lege es als Short im Content-Ordner ab.`,
  },
  demo: { label: 'App-Demo', prompt: 'Erstelle einen App-Demo-Short aus den Bildschirmaufnahmen/Screenshots in brand/screens/ (oder recordings/). Starke Hook-Zeile in den ersten 2 Sekunden, Zoom auf die wichtigen Klicks, Untertitel, CTA am Ende.' },
  explainer: { label: 'Erklärvideo', prompt: 'Erstelle einen animierten Erklär-Short (ohne Screenrecordings) zu folgendem Thema: ' },
  quiz: { label: 'Quiz', prompt: 'Erstelle einen Quiz-Short: Frage mit 3 Antwortoptionen, 3-Sekunden-Countdown, Auflösung, Aufforderung die Antwort zu kommentieren. Thema: ' },
  profile: { label: 'Profil-Kit', prompt: 'Erstelle ein Profil-Kit im Ordner profile-kit/: 5 Bio-Varianten (bios.md, je ≤150 Zeichen), 5 Instagram-Highlight-Cover (1080x1920 PNG, Markenfarben, einfache Icons) und ein YouTube-Banner (2560x1440 PNG, sichere Zone 1546x423 beachten). Ich lade sie selbst hoch.' },
};

function systemPrompt(project, { series, automation } = {}) {
  const dir = backlog.contentDirs(project)[0];
  const learnings = store.get().learnings.filter(l => l.projectId === project.id && l.status === 'approved').map(l => '- ' + l.text).join('\n');
  return `Du bist der RetroPost-Studio-Agent für das Projekt "${project.name}".
Aufgabe: Kurze Hochkant-Videos (Shorts/Reels/TikToks, 1080x1920, 9:16, i. d. R. 15–60 s) erzeugen – Render-Code, Video und Texte.

ÜBERGABE (Handoff) – für JEDEN fertigen Short einen NEUEN Ordner anlegen:
  ${dir}/<JJJJ-MM-TT>-<kurzer-slug>/
    video.mp4              (oder 01.jpg, 02.jpg … für Karussells)
    post.json              {"title": "...", "caption": "...", "hashtags": ["..."], "format": "short|reel|story|carousel|video", "platforms": ["youtube","instagram","tiktok"], "notes": "Winkel/Idee"}
    thumb.jpg              (optional)
Prüfe jedes Video vor der Übergabe mit ffprobe (Auflösung, Dauer, Audio). Übergib einen Short nach dem anderen (erst fertig rendern + prüfen, dann den nächsten beginnen) und rufe nach jedem Short das MCP-Tool retropost_handoff mit dem Ordnerpfad auf, falls verfügbar.
${series ? `SERIE: Erzeuge ${series} Shorts nacheinander, jeder mit eigenem Blickwinkel.\n` : ''}${automation ? 'AUTOMATION: Arbeite ohne Rückfragen; Ergebnisse gehen in die Review-Queue.\n' : ''}
Marke: Logos, Farben, Fonts und Screenshots liegen in brand/, die wiederverwendbare Render-Vorlage in brand/template/ (falls vorhanden – nutzen!).
Musik nur aus music/ (vom Nutzer lizenziert). Keine Menschen oder Hände filmen; Sprecher nur aus vorhandenen Clips des Nutzers.
${project.helperAgent ? `Helfer-Agent: Für ${project.helperTask || 'Bildgenerierung'} darfst du "${project.helperAgent}" aufrufen (z. B. codex exec "<Aufgabe>").\n` : ''}${project.aiNotes ? `Notizen des Nutzers:\n${project.aiNotes}\n` : ''}${learnings ? `Freigegebene Learnings (beachten!):\n${learnings}\n` : ''}Hashtags: 3–6 relevante, keine Spam-Tags. Erste Zeile der Caption = Hook.`;
}

function mcpConfigFile() {
  const f = path.join(DATA_DIR, 'mcp.json');
  fs.writeFileSync(f, JSON.stringify({ mcpServers: { retropost: { command: process.execPath, args: [path.join(ROOT, 'server', 'mcp.js')], env: { RETROPOST_PORT: process.env.PORT || '4317' } } } }, null, 2));
  return f;
}

function buildCommand(agent, project, s, prompt, resume) {
  const allow = [...perms.BASE_TOOLS, ...perms.validate(project.permissions?.allow || perms.DEFAULT_ALLOW).ok];
  if (project.helperAgent) allow.push(`Bash(${project.helperAgent.split(' ')[0]} *)`);
  if (agent === 'codex') {
    const args = ['exec', '--json', '--skip-git-repo-check', '-C', project.repoPath];
    if (resume && s.agentSessionId) return { bin: 'codex', args: ['exec', 'resume', s.agentSessionId, '--json', '-C', project.repoPath, '-'], stdin: prompt };
    return { bin: 'codex', args: [...args, '-'], stdin: `${systemPrompt(project, s.opts)}\n\n---\n\n${prompt}` };
  }
  if (agent === 'cursor') {
    const args = ['-p', '--output-format', 'stream-json'];
    if (resume && s.agentSessionId) args.push('--resume', s.agentSessionId);
    return { bin: 'cursor-agent', args, stdin: resume ? prompt : `${systemPrompt(project, s.opts)}\n\n---\n\n${prompt}` };
  }
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--append-system-prompt', systemPrompt(project, s.opts), '--mcp-config', mcpConfigFile(), '--allowedTools', ...allow];
  if (resume && s.agentSessionId) args.push('--resume', s.agentSessionId);
  return { bin: 'claude', args, stdin: prompt };
}

function create(projectId, { prompt, title, series, preset, automationId, agent } = {}) {
  const project = store.find('projects', projectId);
  if (!project) throw new Error('Projekt nicht gefunden');
  if (!project.repoPath || !fs.existsSync(project.repoPath)) throw new Error('Projekt-Repo existiert nicht: ' + project.repoPath);
  const s = {
    id: id('ses_'), projectId, title: title || (prompt || PRESETS[preset]?.label || 'Neuer Chat').slice(0, 60),
    agent: agent || project.agent || store.get().settings.defaultAgent || 'claude',
    status: 'idle', events: [], approvals: [], handoffs: [], agentSessionId: null, createdAt: Date.now(),
    opts: { series: series ? Number(series) : null, automation: !!automationId }, automationId: automationId || null, cost: 0,
  };
  store.get().sessions.push(s); store.save();
  if (prompt || preset) send(s.id, (PRESETS[preset]?.prompt || '') + (prompt ? (preset ? '\n' : '') + prompt : ''));
  notify();
  return s;
}

function send(sid, text) {
  const s = store.find('sessions', sid);
  if (!s) throw new Error('Session nicht gefunden');
  if (procs.has(sid)) throw new Error('Die Session arbeitet noch');
  if (runningCount() >= MAX_RUNNING) throw new Error(`Maximal ${MAX_RUNNING} Sessions gleichzeitig – warte, bis eine fertig ist.`);
  const project = store.find('projects', s.projectId);
  const resume = !!s.agentSessionId;
  const cmd = buildCommand(s.agent, project, s, text, resume);
  const bin = which(cmd.bin);
  push(s, { type: 'user', text });
  if (!bin) { push(s, { type: 'error', text: `Agent-CLI "${cmd.bin}" nicht gefunden. Installieren und einloggen (z. B. "claude" einmal im Terminal starten).` }); s.status = 'error'; store.save(); notify(); return s; }

  const startedAt = Date.now();
  s.status = 'running'; s.lastRunAt = startedAt; store.save(); notify();
  const child = spawn(bin, cmd.args, { cwd: project.repoPath, env: { ...process.env, RETROPOST_SESSION: s.id, RETROPOST_PROJECT: project.id }, shell: process.platform === 'win32' });
  procs.set(sid, child);
  child.stdin.end(cmd.stdin);
  let buf = '';
  child.stdout.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handleLine(s, line); }
  });
  let errTxt = '';
  child.stderr.on('data', d => { errTxt += d; if (errTxt.length > 4000) errTxt = errTxt.slice(-4000); });
  child.on('error', e => push(s, { type: 'error', text: e.message }));
  child.on('close', code => {
    if (buf.trim()) handleLine(s, buf.trim());
    procs.delete(sid);
    if (code !== 0 && s.status === 'running') push(s, { type: 'error', text: `Agent beendet (Code ${code}). ${errTxt.slice(-600)}` });
    s.status = s.approvals.some(a => a.status === 'pending') ? 'needs_approval' : code === 0 ? 'done' : 'error';
    // Handoffs: neu entstandene Backlog-Ordner dieser Session zuordnen
    const items = backlog.claimNew(project, s.id, startedAt);
    for (const it of items) {
      if (!s.handoffs.includes(it.id)) s.handoffs.push(it.id);
      push(s, { type: 'handoff', text: `Short übergeben: ${it.title}`, backlogId: it.id });
      if (s.automationId) { try { require('./posts').fromBacklog(it.id, { status: 'review', source: 'automation' }); } catch (e) { log('agent', e.message); } }
    }
    store.save(); notify();
    log('agent', `Session ${s.id} beendet (${s.status})`);
  });
  return s;
}

function handleLine(s, line) {
  let j;
  try { j = JSON.parse(line); } catch { push(s, { type: 'text', text: line }); return; }
  // Claude Code / Cursor stream-json
  if (j.type === 'system' && j.session_id) { s.agentSessionId = j.session_id; return; }
  if (j.type === 'assistant' && j.message?.content) {
    for (const c of j.message.content) {
      if (c.type === 'text' && c.text.trim()) push(s, { type: 'assistant', text: c.text });
      else if (c.type === 'tool_use') push(s, { type: 'tool', tool: c.name, text: summarizeTool(c.name, c.input) });
    }
    return;
  }
  if (j.type === 'user' && j.message?.content) {
    for (const c of [].concat(j.message.content)) if (c.type === 'tool_result' && c.is_error) push(s, { type: 'tool_error', text: String(typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).slice(0, 500) });
    return;
  }
  if (j.type === 'result') {
    if (j.session_id) s.agentSessionId = j.session_id;
    if (j.total_cost_usd) s.cost = (s.cost || 0) + j.total_cost_usd;
    for (const d of j.permission_denials || []) {
      const sug = perms.suggestionFor(d);
      if (!s.approvals.some(a => a.status === 'pending' && a.exact === sug.exact))
        s.approvals.push({ id: id('apr_'), tool: d.tool_name, input: d.tool_input, exact: sug.exact, pattern: sug.pattern, status: 'pending', at: Date.now() });
    }
    if (j.permission_denials?.length) push(s, { type: 'approval', text: `${j.permission_denials.length} Befehl(e) brauchen deine Freigabe.` });
    push(s, { type: 'result', text: j.is_error ? `Fehler: ${j.result || j.subtype}` : 'Fertig.' });
    return;
  }
  // Codex --json Events
  if (j.type === 'thread.started' && j.thread_id) { s.agentSessionId = j.thread_id; return; }
  if (j.type === 'item.completed' && j.item) {
    const it = j.item;
    if (it.type === 'agent_message' || it.item_type === 'assistant_message') push(s, { type: 'assistant', text: it.text });
    else if (it.type === 'command_execution') push(s, { type: 'tool', tool: 'shell', text: it.command });
    return;
  }
  if (j.msg?.type === 'agent_message') { push(s, { type: 'assistant', text: j.msg.message }); return; }
}

function summarizeTool(name, input = {}) {
  if (name === 'Bash') return input.command;
  if (['Write', 'Edit', 'Read'].includes(name)) return input.file_path;
  if (name.startsWith('mcp__retropost')) return name.replace('mcp__retropost__', '') + ' ' + JSON.stringify(input).slice(0, 120);
  return JSON.stringify(input).slice(0, 160);
}

// Freigabe: "once" = genau dieser Befehl, "pattern" = Muster dauerhaft ins Projekt, "deny" = ablehnen
function resolveApproval(sid, approvalId, decision) {
  const s = store.find('sessions', sid);
  const a = s.approvals.find(x => x.id === approvalId);
  if (!a) throw new Error('Freigabe nicht gefunden');
  const project = store.find('projects', s.projectId);
  if (decision === 'deny') a.status = 'denied';
  else {
    const rule = decision === 'pattern' && a.pattern ? a.pattern : a.exact;
    if (perms.isCatchAll(rule)) throw new Error('Catch-all-Freigaben sind nicht erlaubt: ' + rule);
    project.permissions = project.permissions || { allow: [...perms.DEFAULT_ALLOW] };
    if (!project.permissions.allow.includes(rule)) project.permissions.allow.push(rule);
    if (decision === 'once') (s.onceRules = s.onceRules || []).push(rule);
    a.status = 'approved'; a.rule = rule;
  }
  store.save();
  if (!s.approvals.some(x => x.status === 'pending')) {
    const ok = s.approvals.filter(x => x.status === 'approved' && !x.resumed);
    const no = s.approvals.filter(x => x.status === 'denied' && !x.resumed);
    ok.concat(no).forEach(x => x.resumed = true);
    const msg = (ok.length ? `Freigegeben: ${ok.map(x => x.rule).join(', ')}. ` : '') + (no.length ? `Abgelehnt: ${no.map(x => x.exact).join(', ')} – finde einen anderen Weg. ` : '') + 'Mach dort weiter, wo du aufgehört hast.';
    s.status = 'idle';
    send(sid, msg);
    // Einmal-Freigaben nach dem Lauf wieder entfernen
    const child = procs.get(sid);
    if (child && s.onceRules?.length) child.on('close', () => {
      project.permissions.allow = project.permissions.allow.filter(r => !s.onceRules.includes(r)); s.onceRules = []; store.save();
    });
  }
  return s;
}

function stopSession(sid) { const c = procs.get(sid); if (c) c.kill(); }
function remove(sid) { stopSession(sid); store.remove('sessions', sid); notify(); }

function list(projectId) {
  return store.get().sessions.filter(s => !projectId || s.projectId === projectId)
    .map(({ events, ...s }) => ({ ...s, last: events[events.length - 1]?.text?.slice(0, 120) || '', running: procs.has(s.id) }))
    .sort((a, b) => (b.lastRunAt || b.createdAt) - (a.lastRunAt || a.createdAt));
}

module.exports = { create, send, list, subscribe, resolveApproval, stopSession, remove, onSessions, runningCount, PRESETS, MAX_RUNNING, systemPrompt, handleLine, available: ai.available };
