'use strict';
// Einmal-Aufrufe an deinen KI-Agenten (nutzt den vorhandenen CLI-Login – kein eigener API-Key).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const store = require('./store');
const { extractJson, log, which } = require('./util');

const AGENTS = {
  claude: { bin: 'claude', args: () => ['-p', '--output-format', 'json', '--max-turns', '3'], parse: out => { const j = extractJson(out); return j?.result ?? out; } },
  codex: { bin: 'codex', args: (tmp) => ['exec', '--skip-git-repo-check', '--output-last-message', tmp, '-'], parse: (out, tmp) => { try { return fs.readFileSync(tmp, 'utf8'); } catch { return out; } } },
  cursor: { bin: 'cursor-agent', args: () => ['-p', '--output-format', 'json'], parse: out => { const j = extractJson(out); return j?.result ?? out; } },
};

function available() {
  return Object.fromEntries(Object.entries(AGENTS).map(([k, a]) => [k, !!which(a.bin)]));
}

function agentFor(projectId) {
  const p = projectId && store.find('projects', projectId);
  return p?.agent || store.get().settings.defaultAgent || 'claude';
}

function projectContext(projectId) {
  const p = projectId && store.find('projects', projectId);
  if (!p) return '';
  const learnings = store.get().learnings.filter(l => l.projectId === projectId && l.status === 'approved').map(l => '- ' + l.text);
  let s = `Projekt: ${p.name}\n`;
  if (p.aiNotes) s += `Notizen des Nutzers zum Projekt/Ton:\n${p.aiNotes}\n`;
  if (learnings.length) s += `Freigegebene Learnings aus der Performance-Analyse:\n${learnings.join('\n')}\n`;
  return s;
}

function runText(prompt, { projectId, timeoutMs = 240000 } = {}) {
  const name = agentFor(projectId);
  const a = AGENTS[name] || AGENTS.claude;
  const bin = which(a.bin);
  if (!bin) return Promise.reject(new Error(`Agent-CLI "${a.bin}" nicht gefunden. Installiere sie oder wähle in den Einstellungen einen anderen Agenten.`));
  const tmp = path.join(os.tmpdir(), `retropost-ai-${Date.now()}.txt`);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'retropost-ai-'));
  return new Promise((resolve, reject) => {
    const child = spawn(bin, a.args(tmp), { cwd, env: process.env, shell: process.platform === 'win32' });
    let out = '', err = '';
    const t = setTimeout(() => { child.kill(); reject(new Error('KI-Anfrage: Zeitüberschreitung')); }, timeoutMs);
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', e => { clearTimeout(t); reject(e); });
    child.on('close', code => {
      clearTimeout(t);
      try { fs.rmSync(cwd, { recursive: true, force: true }); } catch {}
      if (code !== 0 && !out) return reject(new Error(`Agent beendet mit Code ${code}: ${err.slice(-400)}`));
      const text = a.parse(out, tmp);
      try { fs.unlinkSync(tmp); } catch {}
      resolve(String(text || '').trim());
    });
    child.stdin.end(prompt);
  });
}

async function runJson(task, { projectId, schemaHint } = {}) {
  const prompt = `${projectContext(projectId)}\n${task}\n\nAntworte AUSSCHLIESSLICH mit gültigem JSON${schemaHint ? ' in dieser Form: ' + schemaHint : ''}. Keine Erklärungen, kein Markdown.`;
  const text = await runText(prompt, { projectId });
  const j = extractJson(text);
  if (j === null) { log('ai', 'Keine JSON-Antwort:', text.slice(0, 300)); throw new Error('Die KI hat kein gültiges JSON geliefert.'); }
  return j;
}

// ── Lokale Heuristik für den Hook-Check (läuft immer, auch ohne Agent) ──
function hookScore(text) {
  const first = String(text || '').split(/\n|(?<=[.!?])\s/)[0].trim();
  const tips = [];
  let score = 50;
  const words = first.split(/\s+/).filter(Boolean).length;
  if (!first) return { hook: '', score: 0, tips: ['Kein Hook vorhanden – die erste Zeile entscheidet.'] };
  if (words <= 12) score += 15; else tips.push(`Hook ist lang (${words} Wörter) – unter 12 Wörter bleiben.`);
  if (/\d/.test(first)) score += 10; else tips.push('Eine konkrete Zahl macht Hooks greifbarer.');
  if (/\?$/.test(first) || /^(warum|wie|was|wieso|why|how|what)\b/i.test(first)) score += 10;
  if (/\b(du|dein|dir|you|your)\b/i.test(first)) score += 10; else tips.push('Sprich die Zuschauer direkt an (du/dein).');
  if (/\b(niemand|nie|stopp|fehler|geheim|never|stop|mistake|secret|hör auf)\b/i.test(first)) score += 10;
  if (/^(hallo|hi|hey|willkommen|in diesem video|heute)/i.test(first)) { score -= 25; tips.push('Kein Begrüßungs-Intro – direkt mit dem Versprechen starten.'); }
  return { hook: first, score: Math.max(0, Math.min(100, score)), tips };
}

module.exports = { runText, runJson, available, hookScore, projectContext, AGENTS, agentFor };
