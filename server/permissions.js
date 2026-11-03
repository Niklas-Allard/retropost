'use strict';
// Befehlsfreigaben pro Projekt. Alles außerhalb der Allow-List braucht deine Freigabe.
// Catch-all-Regeln werden grundsätzlich abgelehnt.

const DEFAULT_ALLOW = [
  'Bash(npm run *)',
  'Bash(npx remotion *)',
  'Bash(ffmpeg *)',
  'Bash(ffprobe *)',
  'Bash(mkdir *)',
  'Bash(ls *)',
];

const BASE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'TodoWrite', 'mcp__retropost'];

function isCatchAll(rule) {
  const r = String(rule || '').trim();
  if (!r) return true;
  if (/^(\*|Bash|Bash\(\s*\*?\s*\)|Bash\(\s*:?\*\s*\)|Bash\(\s*\*\s*:?\s*\*?\s*\))$/i.test(r)) return true;
  const m = r.match(/^Bash\((.*)\)$/i);
  if (m) {
    const inner = m[1].trim();
    // nur Wildcards / Shell-Metazeichen ohne konkreten Befehl
    if (!/[a-z0-9]/i.test(inner.replace(/\*/g, ''))) return true;
    if (/^(sh|bash|zsh|sudo|eval|env|xargs)\b/i.test(inner) && /\*/.test(inner)) return true;
  }
  return false;
}

function validate(rules) {
  const ok = [], rejected = [];
  for (const r of rules || []) (isCatchAll(r) ? rejected : ok).push(String(r).trim());
  return { ok: [...new Set(ok)], rejected };
}

function suggestionFor(denial) {
  if (denial.tool_name === 'Bash') {
    const cmd = String(denial.tool_input?.command || '').trim();
    const words = cmd.split(/\s+/).slice(0, 2).join(' ');
    return { exact: `Bash(${cmd})`, pattern: words ? `Bash(${words} *)` : null };
  }
  return { exact: denial.tool_name, pattern: null };
}

module.exports = { DEFAULT_ALLOW, BASE_TOOLS, isCatchAll, validate, suggestionFor };
