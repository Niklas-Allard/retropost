'use strict';
// YouTube Data API v3 – OAuth, resumable Upload in 8-MB-Chunks (mit Wiederaufnahme), geplantes Veröffentlichen.
const fs = require('node:fs');
const { env, fetchJson, form, log } = require('../util');

const CHUNK = 8 * 1024 * 1024;
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.force-ssl'];
const redirectUri = () => `http://localhost:${env('PORT', '4317')}/oauth/youtube/callback`;

const configured = () => !!(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET'));

function authUrl(state) {
  const p = new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: redirectUri(), response_type: 'code',
    scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
}

function withExpiry(t, old = {}) {
  return { ...old, ...t, refresh_token: t.refresh_token || old.refresh_token, expiresAt: Date.now() + (t.expires_in || 3600) * 1000 };
}

async function handleCallback(code) {
  const t = await fetchJson('https://oauth2.googleapis.com/token', {
    method: 'POST', body: form({ code, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), redirect_uri: redirectUri(), grant_type: 'authorization_code' }),
  });
  const tokens = withExpiry(t);
  const ch = await fetchJson('https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true', { headers: { Authorization: 'Bearer ' + tokens.access_token } });
  const c = ch.items?.[0];
  if (!c) throw new Error('Zu diesem Google-Konto gibt es keinen YouTube-Kanal.');
  return { tokens, identity: { remoteUserId: c.id, handle: c.snippet.customUrl || c.snippet.title, avatar: c.snippet.thumbnails?.default?.url, uploadsPlaylist: c.contentDetails?.relatedPlaylists?.uploads } };
}

async function refresh(tokens) {
  if (!tokens.refresh_token) throw new Error('Kein Refresh-Token – bitte Konto neu verbinden.');
  try {
    const t = await fetchJson('https://oauth2.googleapis.com/token', {
      method: 'POST', body: form({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }),
    });
    return withExpiry(t, tokens);
  } catch (e) {
    if (/invalid_grant/i.test(e.message) || e.body?.error === 'invalid_grant')
      throw new Error('Google-Anmeldung abgelaufen (Testmodus: 7 Tage). Konto neu verbinden oder OAuth-App auf "In Produktion" stellen.');
    throw e;
  }
}

const H = tokens => ({ Authorization: 'Bearer ' + tokens.access_token });

function buildMeta(post, publishAt) {
  const tags = (post.hashtags || []).map(h => h.replace(/^#/, '')).filter(Boolean).slice(0, 30);
  let description = post.caption || '';
  const tagLine = (post.hashtags || []).map(h => '#' + h.replace(/^#/, '')).join(' ');
  if (tagLine && !description.includes(tagLine)) description += '\n\n' + tagLine;
  if (post.format !== 'video' && !/#shorts/i.test(description)) description += ' #Shorts';
  return {
    snippet: { title: (post.title || post.caption || 'Short').slice(0, 100), description: description.slice(0, 5000), tags, categoryId: post.ytCategory || '22' },
    status: { privacyStatus: publishAt ? 'private' : 'public', publishAt: publishAt || undefined, selfDeclaredMadeForKids: false },
  };
}

// ctx: { tokens, post, target, saveTarget(patch), publishAt? }
async function publish(ctx) {
  const { tokens, post, target } = ctx;
  const file = post.mediaPath;
  if (!file || !fs.existsSync(file)) throw new Error('Videodatei fehlt: ' + file);
  const size = fs.statSync(file).size;
  let uploadUrl = target.upload?.url;
  let offset = 0;

  if (uploadUrl) {
    // Wiederaufnahme: Status abfragen
    const r = await fetch(uploadUrl, { method: 'PUT', headers: { ...H(tokens), 'Content-Length': '0', 'Content-Range': `bytes */${size}` } });
    if (r.status === 200 || r.status === 201) { const j = await r.json(); return done(j); }
    if (r.status === 308) { const range = r.headers.get('range'); offset = range ? Number(range.split('-')[1]) + 1 : 0; log('youtube', `Upload wird bei ${offset}/${size} fortgesetzt`); }
    else { uploadUrl = null; }
  }
  if (!uploadUrl) {
    const res = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: { ...H(tokens), 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/*' },
      body: JSON.stringify(buildMeta(post, ctx.publishAt)),
    });
    if (!res.ok) throw new Error(`YouTube Upload-Init HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    uploadUrl = res.headers.get('location');
    offset = 0;
    ctx.saveTarget({ upload: { url: uploadUrl, size, startedAt: Date.now() } });
  }

  const fh = await fs.promises.open(file, 'r');
  try {
    while (offset < size) {
      const len = Math.min(CHUNK, size - offset);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, offset);
      const r = await fetch(uploadUrl, { method: 'PUT', headers: { ...H(tokens), 'Content-Length': String(len), 'Content-Range': `bytes ${offset}-${offset + len - 1}/${size}` }, body: buf });
      if (r.status === 308) {
        const range = r.headers.get('range');
        offset = range ? Number(range.split('-')[1]) + 1 : offset + len;
        ctx.saveTarget({ upload: { url: uploadUrl, size, offset } });
        ctx.progress?.(offset / size);
        continue;
      }
      if (r.status === 200 || r.status === 201) return done(await r.json());
      throw new Error(`YouTube Chunk-Upload HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    }
  } finally { await fh.close(); }
  throw new Error('Upload endete ohne Antwort von YouTube');

  function done(j) {
    return { remoteId: j.id, url: `https://youtube.com/shorts/${j.id}`, scheduledRemote: !!ctx.publishAt };
  }
}

async function reschedule({ tokens, remoteId, publishAt }) {
  return fetchJson('https://www.googleapis.com/youtube/v3/videos?part=status', {
    method: 'PUT', headers: { ...H(tokens), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: remoteId, status: { privacyStatus: 'private', publishAt, selfDeclaredMadeForKids: false } }),
  });
}

async function stats({ tokens, account, sinceMs }) {
  let playlist = account.identity?.uploadsPlaylist;
  if (!playlist) {
    const ch = await fetchJson('https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true', { headers: H(tokens) });
    playlist = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  }
  if (!playlist) return [];
  const ids = [];
  let page = '';
  outer: for (let i = 0; i < 10; i++) {
    const pl = await fetchJson(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId=${playlist}${page ? '&pageToken=' + page : ''}`, { headers: H(tokens) });
    for (const it of pl.items || []) {
      if (new Date(it.contentDetails.videoPublishedAt || 0).getTime() < sinceMs) break outer;
      ids.push(it.contentDetails.videoId);
    }
    page = pl.nextPageToken; if (!page) break;
  }
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const v = await fetchJson(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${ids.slice(i, i + 50).join(',')}`, { headers: H(tokens) });
    for (const x of v.items || []) out.push({
      remoteId: x.id, title: x.snippet.title, caption: x.snippet.description, publishedAt: x.snippet.publishedAt,
      views: +x.statistics.viewCount || 0, likes: +x.statistics.likeCount || 0, comments: +x.statistics.commentCount || 0,
      durationSec: isoDur(x.contentDetails.duration), url: `https://youtube.com/shorts/${x.id}`, hashtags: x.snippet.tags || [],
    });
  }
  return out;
}

function isoDur(d) {
  const m = String(d || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : null;
}

async function comments({ tokens, remoteId }) {
  const j = await fetchJson(`https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&maxResults=20&order=time&videoId=${remoteId}`, { headers: H(tokens) });
  return (j.items || []).map(c => ({ id: c.id, author: c.snippet.topLevelComment.snippet.authorDisplayName, text: c.snippet.topLevelComment.snippet.textOriginal, at: c.snippet.topLevelComment.snippet.publishedAt }));
}

module.exports = { name: 'youtube', label: 'YouTube', configured, authUrl, handleCallback, refresh, publish, reschedule, stats, comments, redirectUri, CHUNK, buildMeta, formats: ['short', 'video'] };
