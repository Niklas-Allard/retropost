'use strict';
// Tägliche Shorts: ein Short aus einem Chat dient als Rezept. Zu fester Zeit an gewählten Tagen
// erzeugt der Agent eine feste Anzahl neuer Shorts mit neuem Blickwinkel → Queue › Review.
const store = require('./store');
const backlog = require('./backlog');
const { id, log } = require('./util');

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function create({ projectId, name, recipeBacklogId, recipeSessionId, extraPrompt, days = [1, 2, 3, 4, 5], time = '06:00', count = 1, enabled = true }) {
  if (!store.find('projects', projectId)) throw new Error('Projekt fehlt');
  const a = { id: id('auto_'), projectId, name: name || 'Tägliche Shorts', recipeBacklogId, recipeSessionId, extraPrompt: extraPrompt || '', days: days.map(Number), time, count: Math.max(1, Math.min(10, Number(count) || 1)), enabled, lastRunDate: null, runs: [], createdAt: Date.now() };
  // Ist die Uhrzeit heute schon vorbei, startet der erste Lauf erst am nächsten geplanten Tag
  if (new Date().toTimeString().slice(0, 5) >= a.time) a.lastRunDate = localDate();
  store.get().automations.push(a); store.save();
  return a;
}

function update(aid, patch) {
  const a = store.find('automations', aid);
  for (const k of ['name', 'recipeBacklogId', 'recipeSessionId', 'extraPrompt', 'days', 'time', 'count', 'enabled']) if (patch[k] !== undefined) a[k] = patch[k];
  if (patch.days) a.days = patch.days.map(Number);
  store.save();
  return a;
}

function recipePrompt(a) {
  const project = store.find('projects', a.projectId);
  const items = backlog.scan(project);
  const ref = items.find(i => i.id === a.recipeBacklogId);
  const angles = items.slice(0, 30).map(i => `- ${i.title}${i.notes ? ' (' + i.notes.slice(0, 60) + ')' : ''}`).join('\n');
  const analysis = require('./analytics').summaryText(a.projectId);
  return `AUTOMATISCHER LAUF „${a.name}“ – erzeuge ${a.count} neue(n) Short(s) nach diesem Rezept.
REZEPT (Referenz-Short): ${ref ? `${ref.path} – Titel „${ref.title}“, Caption: ${ref.caption.slice(0, 300)}` : 'siehe vorherigen Chat'}
Nutze dieselbe Render-Vorlage/Machart wie der Referenz-Short, aber wähle für JEDEN neuen Short einen NEUEN Blickwinkel, der noch nicht verwendet wurde.
Bisher verwendete Titel/Blickwinkel:
${angles || '- (noch keine)'}
Aktuelle Performance-Analyse (darauf aufbauen):
${analysis}
${a.extraPrompt ? 'Zusatz: ' + a.extraPrompt : ''}`;
}

function runNow(aid) {
  const a = store.find('automations', aid);
  const agent = require('./agent');
  const today = localDate();
  let s;
  const existing = a.recipeSessionId && store.find('sessions', a.recipeSessionId);
  // Eigene Session pro Lauf (frischer Kontext), mit Rezept aus dem Ursprungs-Chat
  s = agent.create(a.projectId, { title: `⏱ ${a.name} ${today}`, automationId: a.id, series: a.count, agent: existing?.agent });
  agent.send(s.id, recipePrompt(a));
  a.lastRunDate = today; a.lastRunAt = Date.now();
  a.runs = [...(a.runs || []), { at: Date.now(), sessionId: s.id }].slice(-30);
  store.save();
  log('automation', `Lauf gestartet: ${a.name} → ${s.id}`);
  return s;
}

async function tick() {
  const now = new Date();
  const today = localDate(now);
  const hhmm = now.toTimeString().slice(0, 5);
  for (const a of store.get().automations) {
    if (!a.enabled || a.lastRunDate === today || !a.days.includes(now.getDay()) || hhmm < a.time) continue;
    try { runNow(a.id); } catch (e) { a.lastError = e.message; a.lastRunDate = today; store.save(); log('automation', `${a.name}: ${e.message}`); }
  }
}

module.exports = { create, update, runNow, tick, recipePrompt };
