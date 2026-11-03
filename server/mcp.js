#!/usr/bin/env node
'use strict';
// RetroPost MCP-Server (stdio, JSON-RPC 2.0) – gibt deinem Agenten Werkzeuge für Backlog, Planung und Analyse.
// Nutzt die lokale RetroPost-API (http://127.0.0.1:PORT). Einbinden: claude mcp add retropost -- node server/mcp.js
const readline = require('node:readline');

const PORT = process.env.RETROPOST_PORT || process.env.PORT || '4317';
const BASE = `http://127.0.0.1:${PORT}/api`;
const PROJECT = process.env.RETROPOST_PROJECT || '';

async function api(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', 'X-RetroPost-Client': 'mcp' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

const TOOLS = [
  { name: 'retropost_projects', description: 'Listet alle RetroPost-Projekte (id, Name, Repo, Content-Ordner).', inputSchema: { type: 'object', properties: {} },
    run: async () => (await api('GET', '/projects')).map(p => ({ id: p.id, name: p.name, repoPath: p.repoPath, contentDirs: p.contentDirs })) },
  { name: 'retropost_list_backlog', description: 'Listet die Shorts im Backlog eines Projekts (Titel, Caption, Status, Pfad).', inputSchema: { type: 'object', properties: { projectId: { type: 'string' } } },
    run: async ({ projectId }) => (await api('GET', `/backlog?projectId=${projectId || PROJECT}`)).map(i => ({ id: i.id, title: i.title, status: i.status, path: i.path, caption: i.caption.slice(0, 200) })) },
  { name: 'retropost_handoff', description: 'Übergibt einen fertig gerenderten Short-Ordner (mit video.mp4 + post.json) an RetroPost. Ruf das nach jedem fertigen Short auf.', inputSchema: { type: 'object', properties: { folder: { type: 'string', description: 'Absoluter Pfad des Short-Ordners' }, toReview: { type: 'boolean', description: 'Direkt in Queue › Review legen' } }, required: ['folder'] },
    run: async ({ folder, toReview }) => api('POST', '/backlog/handoff', { folder, toReview, sessionId: process.env.RETROPOST_SESSION, projectId: PROJECT }) },
  { name: 'retropost_schedule', description: 'Plant einen Backlog-Short zu einer Zeit (ISO) oder in den nächsten freien Slot; landet in Queue › Review.', inputSchema: { type: 'object', properties: { backlogId: { type: 'string' }, at: { type: 'string', description: 'ISO-Datum, leer = nächster freier Slot' } }, required: ['backlogId'] },
    run: async ({ backlogId, at }) => api('POST', '/posts/from-backlog', { backlogId, scheduledAt: at || null, autoSlot: !at }) },
  { name: 'retropost_queue', description: 'Zeigt geplante Posts der nächsten Tage.', inputSchema: { type: 'object', properties: { projectId: { type: 'string' } } },
    run: async ({ projectId }) => (await api('GET', `/posts?projectId=${projectId || PROJECT}`)).filter(p => p.scheduledAt).map(p => ({ id: p.id, title: p.title, at: p.scheduledAt, status: p.status })) },
  { name: 'retropost_learnings', description: 'Freigegebene Learnings und Performance-Zusammenfassung des Projekts – vor neuen Shorts lesen.', inputSchema: { type: 'object', properties: { projectId: { type: 'string' } } },
    run: async ({ projectId }) => api('GET', `/analytics/summary?projectId=${projectId || PROJECT}`) },
];

function reply(id, result, error) {
  process.stdout.write(JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }) + '\n');
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async line => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return; // Notification
  try {
    if (method === 'initialize') return reply(id, { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'retropost', version: '1.0.0' } });
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: TOOLS.map(({ run, ...t }) => t) });
    if (method === 'tools/call') {
      const t = TOOLS.find(x => x.name === params.name);
      if (!t) return reply(id, null, { code: -32602, message: 'Unbekanntes Tool' });
      try {
        const out = await t.run(params.arguments || {});
        return reply(id, { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] });
      } catch (e) { return reply(id, { content: [{ type: 'text', text: 'Fehler: ' + e.message + ' (läuft RetroPost? npm start)' }], isError: true }); }
    }
    reply(id, null, { code: -32601, message: 'Methode nicht unterstützt' });
  } catch (e) { reply(id, null, { code: -32603, message: e.message }); }
});
