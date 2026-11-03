'use strict';
// Backlog = Ordner in den Content-Verzeichnissen eines Projekts.
// Ein Ordner gilt als Short, wenn er ein Video oder Bilder enthält. Metadaten optional in post.json:
// { "title", "caption", "hashtags": [], "format": "short|reel|story|feed|carousel|video", "platforms": [], "notes" }
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./store');
const { VIDEO_EXT, IMAGE_EXT, log } = require('./util');

function contentDirs(project) {
  const dirs = project.contentDirs?.length ? project.contentDirs : ['content/shorts'];
  return dirs.map(d => path.isAbsolute(d) ? d : path.join(project.repoPath || '.', d));
}

const itemId = p => 'b' + crypto.createHash('sha1').update(path.resolve(p)).digest('hex').slice(0, 14);

function readFolder(dir) {
  let files;
  try { files = fs.readdirSync(dir).sort(); } catch { return null; }
  const videos = files.filter(f => VIDEO_EXT.includes(path.extname(f).toLowerCase()));
  const images = files.filter(f => IMAGE_EXT.includes(path.extname(f).toLowerCase()) && !/^(thumb|cover|thumbnail)\./i.test(f));
  if (!videos.length && !images.length) return null;
  let meta = {};
  const metaFile = ['post.json', 'meta.json', 'caption.json'].map(f => path.join(dir, f)).find(f => fs.existsSync(f));
  if (metaFile) { try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (e) { meta = { _error: 'post.json ungültig: ' + e.message }; } }
  if (!meta.caption) {
    const txt = ['caption.txt', 'caption.md'].map(f => path.join(dir, f)).find(f => fs.existsSync(f));
    if (txt) meta.caption = fs.readFileSync(txt, 'utf8').trim();
  }
  const video = videos.find(v => /^(video|final|short|output)/i.test(v)) || videos[0];
  const thumb = files.find(f => /^(thumb|cover|thumbnail)\.(jpe?g|png|webp)$/i.test(f));
  const st = fs.statSync(dir);
  const format = meta.format || (video ? 'short' : images.length > 1 ? 'carousel' : 'feed');
  return {
    path: dir,
    name: path.basename(dir),
    title: meta.title || path.basename(dir).replace(/^\d{4}-\d{2}-\d{2}-?/, '').replace(/[-_]+/g, ' '),
    caption: meta.caption || '',
    hashtags: Array.isArray(meta.hashtags) ? meta.hashtags : [],
    format,
    platforms: meta.platforms || null,
    notes: meta.notes || '',
    error: meta._error,
    video: video ? path.join(dir, video) : null,
    images: video ? [] : images.map(i => path.join(dir, i)),
    thumb: thumb ? path.join(dir, thumb) : null,
    mtime: st.mtimeMs,
  };
}

function scan(project) {
  const db = store.get();
  const items = [];
  for (const root of contentDirs(project)) {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const f = readFolder(path.join(root, e.name));
      if (!f) continue;
      const bid = itemId(f.path);
      let st = db.backlog[bid];
      if (!st) { st = db.backlog[bid] = { status: 'new', firstSeen: Date.now(), projectId: project.id }; store.save(); }
      items.push({ id: bid, projectId: project.id, ...f, status: st.status, sessionId: st.sessionId || null, firstSeen: st.firstSeen, postId: st.postId || null });
    }
  }
  return items.sort((a, b) => b.mtime - a.mtime);
}

function scanAll() {
  return store.get().projects.flatMap(p => scan(p));
}

function findItem(bid) {
  return scanAll().find(i => i.id === bid);
}

function setStatus(bid, patch) {
  const db = store.get();
  db.backlog[bid] = { ...(db.backlog[bid] || { firstSeen: Date.now() }), ...patch };
  store.save();
}

// Ordner, die seit `since` entstanden sind, einer Session zuordnen (Handoff)
function claimNew(project, sessionId, since) {
  const out = [];
  for (const it of scan(project)) {
    const st = store.get().backlog[it.id];
    if (!st.sessionId && it.firstSeen >= since - 1000) { setStatus(it.id, { sessionId }); out.push(it); }
  }
  if (out.length) log('backlog', `${out.length} neue Shorts aus Session ${sessionId}`);
  return out;
}

module.exports = { scan, scanAll, findItem, setStatus, claimNew, contentDirs, readFolder, itemId };
