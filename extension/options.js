const $ = id => document.getElementById(id);
const msg = t => $('msg').textContent = t;
async function loadAccounts(selected) {
  try {
    const r = await fetch('http://127.0.0.1:4317/ext/accounts', { headers: { 'X-RetroPost-Token': $('token').value.trim() } });
    if (!r.ok) throw new Error((await r.json()).error);
    const list = await r.json();
    $('acc').innerHTML = list.map(a => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${a.name} (${a.mode})</option>`).join('');
    msg(list.length ? '' : 'Keine TikTok-Konten in RetroPost.');
  } catch (e) { msg('RetroPost nicht erreichbar oder Token falsch: ' + e.message); }
}
chrome.storage.local.get(['token', 'accountId']).then(c => { $('token').value = c.token || ''; if (c.token) loadAccounts(c.accountId); });
$('load').onclick = () => loadAccounts();
$('save').onclick = async () => { await chrome.storage.local.set({ token: $('token').value.trim(), accountId: $('acc').value }); msg('Gespeichert ✔ – fällige Posts öffnen sich automatisch.'); };
$('now').onclick = async () => { await chrome.runtime.sendMessage({ type: 'pollNow' }); msg('Geprüft.'); };
