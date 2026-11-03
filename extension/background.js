// Fragt RetroPost regelmäßig nach fälligen TikTok-Studio-Jobs und öffnet dann die Upload-Seite.
const BASE = 'http://127.0.0.1:4317';
const cfg = () => chrome.storage.local.get(['token', 'accountId', 'busyJob']);

async function poll() {
  const { token, accountId, busyJob } = await cfg();
  if (!token || !accountId || busyJob) return;
  try {
    const r = await fetch(`${BASE}/ext/tiktok/next?accountId=${encodeURIComponent(accountId)}`, { headers: { 'X-RetroPost-Token': token } });
    const { job } = await r.json();
    if (!job) return;
    await chrome.storage.local.set({ busyJob: job });
    chrome.tabs.create({ url: 'https://www.tiktok.com/tiktokstudio/upload?from=retropost' });
  } catch (e) { /* RetroPost läuft nicht */ }
}

chrome.alarms.create('retropost-poll', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'retropost-poll') poll(); });
chrome.runtime.onStartup.addListener(poll);

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  (async () => {
    const { token, busyJob } = await cfg();
    if (msg.type === 'getJob') return reply({ job: busyJob || null, token });
    if (msg.type === 'fetchVideo') {
      // Video im Hintergrund laden (localhost) und als Base64 an die Seite geben
      const r = await fetch(busyJob.mediaUrl, { headers: { 'X-RetroPost-Token': token } });
      const buf = new Uint8Array(await r.arrayBuffer());
      let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return reply({ b64: btoa(bin), name: busyJob.file || 'video.mp4' });
    }
    if (msg.type === 'done' || msg.type === 'skip') {
      if (msg.type === 'skip' && busyJob) await fetch(`${BASE}/ext/tiktok/snooze`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RetroPost-Token': token }, body: JSON.stringify({ jobId: busyJob.id }) }).catch(() => {});
      if (msg.type === 'done' && busyJob) await fetch(`${BASE}/ext/tiktok/done`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-RetroPost-Token': token }, body: JSON.stringify({ jobId: busyJob.id, url: msg.url || null }) });
      await chrome.storage.local.remove('busyJob');
      return reply({ ok: true });
    }
    if (msg.type === 'pollNow') { await poll(); return reply({ ok: true }); }
  })();
  return true;
});
