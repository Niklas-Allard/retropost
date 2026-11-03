// Läuft auf der TikTok-Studio-Upload-Seite: setzt Video + Caption ein. Posten klickst du selbst.
(async () => {
  const { job } = await chrome.runtime.sendMessage({ type: 'getJob' });
  if (!job) return;
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;z-index:2147483647;left:16px;bottom:16px;max-width:420px;background:#14122b;color:#f4f1de;font:15px/1.4 monospace;padding:14px 16px;border:4px solid #ff5fa2;box-shadow:6px 6px 0 #000';
  const say = (html) => { bar.innerHTML = `<b style="color:#ffd23f">RETROPOST</b><br>${html}`; };
  document.body.appendChild(bar);
  say(`Lade „${job.title}“ …`);
  const waitFor = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const el = fn(); if (el) return el; await new Promise(r => setTimeout(r, 400)); } return null; };
  try {
    const input = await waitFor(() => document.querySelector('input[type=file][accept*="video"], input[type=file]'));
    if (!input) throw new Error('Upload-Feld nicht gefunden – TikTok hat die Seite evtl. geändert.');
    const { b64, name } = await chrome.runtime.sendMessage({ type: 'fetchVideo' });
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], name, { type: 'video/mp4' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    say('Video eingesetzt, warte auf Caption-Feld …');
    const editor = await waitFor(() => document.querySelector('[contenteditable="true"].public-DraftEditor-content, .caption-editor [contenteditable="true"], [contenteditable="true"]'), 90000);
    if (editor) {
      editor.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, job.caption);
    }
    say(`${editor ? 'Caption eingesetzt.' : '<span style="color:#ff4d6d">Caption-Feld nicht gefunden – bitte manuell einfügen:</span><br><textarea style="width:100%;height:80px">' + job.caption.replace(/</g, '&lt;') + '</textarea>'}<br><br>Prüfe alles und klicke in TikTok auf <b>„Posten“</b>. Danach:<br>
      <button id="rp-done" style="margin-top:8px;background:#3ce08c;border:0;padding:8px 12px;font:bold 13px monospace;cursor:pointer">✔ GEPOSTET</button>
      <button id="rp-skip" style="margin-top:8px;background:#2c2758;color:#f4f1de;border:0;padding:8px 12px;font:13px monospace;cursor:pointer">Später (15 min)</button>`);
    bar.querySelector('#rp-done').onclick = async () => { await chrome.runtime.sendMessage({ type: 'done' }); say('In RetroPost als gepostet markiert ✔'); setTimeout(() => bar.remove(), 2500); };
    bar.querySelector('#rp-skip').onclick = async () => { await chrome.runtime.sendMessage({ type: 'skip' }); bar.remove(); };
  } catch (e) {
    say(`<span style="color:#ff4d6d">${e.message}</span><br><button id="rp-skip" style="margin-top:8px">Schließen</button>`);
    bar.querySelector('#rp-skip').onclick = async () => { await chrome.runtime.sendMessage({ type: 'skip' }); bar.remove(); };
  }
})();
