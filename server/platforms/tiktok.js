'use strict';
// TikTok Content Posting API + Login Kit v2.
// Modi pro Konto: "studio" (Extension füllt TikTok Studio aus, du klickst Posten → öffentlich),
// "draft" (Inbox/Entwurf), "private" (Direktpost „Nur ich“; nach bestandenem Audit: öffentlich).
const fs = require('node:fs');
const { env, fetchJson, form, sleep } = require('../util');

const API = 'https://open.tiktokapis.com';
const SCOPES = ['user.info.basic', 'video.publish', 'video.upload', 'video.list'];
const redirectUri = () => `${env('PUBLIC_BASE_URL').replace(/\/$/, '')}/oauth/tiktok/callback`;
const configured = () => !!(env('TIKTOK_CLIENT_KEY') && env('TIKTOK_CLIENT_SECRET') && env('PUBLIC_BASE_URL'));

function authUrl(state) {
  return 'https://www.tiktok.com/v2/auth/authorize/?' + new URLSearchParams({
    client_key: env('TIKTOK_CLIENT_KEY'), response_type: 'code', scope: SCOPES.join(','), redirect_uri: redirectUri(), state,
  });
}

function tok(t, old = {}) {
  if (t.error && t.error !== 'ok') throw new Error(`TikTok OAuth: ${t.error_description || t.error}`);
  return { ...old, access_token: t.access_token, refresh_token: t.refresh_token || old.refresh_token, open_id: t.open_id || old.open_id, expiresAt: Date.now() + (t.expires_in || 86400) * 1000, refreshExpiresAt: Date.now() + (t.refresh_expires_in || 31536000) * 1000 };
}

async function handleCallback(code) {
  const t = await fetchJson(`${API}/v2/oauth/token/`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_key: env('TIKTOK_CLIENT_KEY'), client_secret: env('TIKTOK_CLIENT_SECRET'), code, grant_type: 'authorization_code', redirect_uri: redirectUri() }),
  });
  const tokens = tok(t);
  const me = await fetchJson(`${API}/v2/user/info/?fields=open_id,display_name,avatar_url,username`, { headers: { Authorization: 'Bearer ' + tokens.access_token } });
  const u = me.data?.user || {};
  return { tokens, identity: { remoteUserId: u.open_id || tokens.open_id, handle: u.username || u.display_name, avatar: u.avatar_url } };
}

async function refresh(tokens) {
  const t = await fetchJson(`${API}/v2/oauth/token/`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_key: env('TIKTOK_CLIENT_KEY'), client_secret: env('TIKTOK_CLIENT_SECRET'), grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
  });
  return tok(t, tokens);
}

const H = tokens => ({ Authorization: 'Bearer ' + tokens.access_token, 'Content-Type': 'application/json; charset=UTF-8' });

async function call(tokens, path, body) {
  const j = await fetchJson(API + path, { method: 'POST', headers: H(tokens), body: JSON.stringify(body) });
  if (j.error && j.error.code && j.error.code !== 'ok') throw new Error(`TikTok: ${j.error.code} – ${j.error.message}`);
  return j.data;
}

function chunkPlan(size) {
  const MIN = 5 * 1024 * 1024, MAX = 64 * 1024 * 1024;
  if (size <= MAX) return { chunk: size, count: 1 };
  const chunk = 10 * 1024 * 1024;
  return { chunk, count: Math.floor(size / chunk) }; // letzter Chunk nimmt den Rest auf (≤ 128 MB erlaubt)
}

function captionOf(post) {
  const tags = (post.hashtags || []).map(h => '#' + h.replace(/^#/, ''));
  let c = post.caption || post.title || '';
  const missing = tags.filter(t => !c.includes(t));
  if (missing.length) c += ' ' + missing.join(' ');
  return c.slice(0, 2200);
}

const privacy = () => (env('TIKTOK_AUDITED') === '1' ? 'PUBLIC_TO_EVERYONE' : 'SELF_ONLY');

async function uploadFile(uploadUrl, file, size, plan) {
  const fh = await fs.promises.open(file, 'r');
  try {
    for (let i = 0; i < plan.count; i++) {
      const start = i * plan.chunk;
      const end = i === plan.count - 1 ? size - 1 : start + plan.chunk - 1;
      const buf = Buffer.alloc(end - start + 1);
      await fh.read(buf, 0, buf.length, start);
      const r = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(buf.length), 'Content-Range': `bytes ${start}-${end}/${size}` }, body: buf });
      if (![200, 201, 206].includes(r.status)) throw new Error(`TikTok Upload HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }
  } finally { await fh.close(); }
}

async function waitStatus(tokens, publishId) {
  for (let i = 0; i < 120; i++) {
    const d = await call(tokens, '/v2/post/publish/status/fetch/', { publish_id: publishId });
    if (d.status === 'PUBLISH_COMPLETE') return { done: true, id: d.publicaly_available_post_id?.[0] || d.publicly_available_post_id?.[0] };
    if (d.status === 'SEND_TO_USER_INBOX') return { done: true, inbox: true };
    if (d.status === 'FAILED') throw new Error('TikTok-Veröffentlichung fehlgeschlagen: ' + (d.fail_reason || 'unbekannt'));
    await sleep(5000);
  }
  return { done: false };
}

// ctx: { tokens, account, post, mediaUrl }
async function publish(ctx) {
  const { tokens, account, post } = ctx;
  const mode = account.tiktokMode || 'draft';
  if (post.mediaPath) {
    const size = fs.statSync(post.mediaPath).size;
    const plan = chunkPlan(size);
    const source_info = { source: 'FILE_UPLOAD', video_size: size, chunk_size: plan.chunk, total_chunk_count: plan.count };
    const data = mode === 'draft'
      ? await call(tokens, '/v2/post/publish/inbox/video/init/', { source_info })
      : await call(tokens, '/v2/post/publish/video/init/', { post_info: { title: captionOf(post), privacy_level: privacy(), disable_comment: false, disable_duet: false, disable_stitch: false }, source_info });
    await uploadFile(data.upload_url, post.mediaPath, size, plan);
    const st = await waitStatus(tokens, data.publish_id);
    return { remoteId: st.id || data.publish_id, url: st.id ? `https://www.tiktok.com/@${account.identity?.handle || ''}/video/${st.id}` : null, note: mode === 'draft' || st.inbox ? 'In TikTok-Entwürfen/Inbox – dort finalisieren' : privacy() === 'SELF_ONLY' ? 'Als „Nur ich“ gepostet' : undefined };
  }
  const imgs = (post.images || []).slice(0, 35);
  if (!imgs.length) throw new Error('Kein Medium für TikTok vorhanden');
  const data = await call(tokens, '/v2/post/publish/content/init/', {
    post_info: { title: (post.title || '').slice(0, 90), description: captionOf(post).slice(0, 4000), privacy_level: privacy(), disable_comment: false, auto_add_music: true },
    source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: imgs.map(i => ctx.mediaUrl(i)) },
    post_mode: mode === 'draft' ? 'MEDIA_UPLOAD' : 'DIRECT_POST', media_type: 'PHOTO',
  });
  const st = await waitStatus(tokens, data.publish_id);
  return { remoteId: st.id || data.publish_id, url: null, note: mode === 'draft' ? 'In TikTok-Inbox – dort finalisieren' : undefined };
}

async function stats({ tokens, sinceMs }) {
  const out = [];
  let cursor;
  for (let i = 0; i < 10; i++) {
    const d = await fetchJson(`${API}/v2/video/list/?fields=id,title,video_description,create_time,share_url,view_count,like_count,comment_count,duration`, { method: 'POST', headers: H(tokens), body: JSON.stringify({ max_count: 20, cursor }) });
    const vids = d.data?.videos || [];
    let stop = false;
    for (const v of vids) {
      if (v.create_time * 1000 < sinceMs) { stop = true; break; }
      out.push({ remoteId: v.id, title: v.title || (v.video_description || '').slice(0, 80), caption: v.video_description || '', publishedAt: new Date(v.create_time * 1000).toISOString(), views: v.view_count || 0, likes: v.like_count || 0, comments: v.comment_count || 0, durationSec: v.duration, url: v.share_url, hashtags: (v.video_description || '').match(/#[\p{L}\p{N}_]+/gu) || [] });
    }
    if (stop || !d.data?.has_more) break;
    cursor = d.data.cursor;
  }
  return out;
}

async function comments() { throw new Error('TikTok stellt Kommentare nur über die Research API bereit – hier nicht verfügbar.'); }

module.exports = { name: 'tiktok', label: 'TikTok', configured, authUrl, handleCallback, refresh, publish, stats, comments, redirectUri, chunkPlan, needsTunnel: true, formats: ['short', 'carousel'], MODES: ['studio', 'draft', 'private'] };
