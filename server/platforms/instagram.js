'use strict';
// Instagram API mit Instagram-Login (Professional-Konto + Meta-Developer-App).
// Medien werden per signiertem Link über deinen eigenen Cloudflare Tunnel abgeholt (1 h gültig).
const { env, fetchJson, form, sleep } = require('../util');

const V = 'v22.0';
const G = `https://graph.instagram.com/${V}`;
const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_comments', 'instagram_business_manage_insights'];
const redirectUri = () => `${env('PUBLIC_BASE_URL').replace(/\/$/, '')}/oauth/instagram/callback`;
const configured = () => !!(env('INSTAGRAM_APP_ID') && env('INSTAGRAM_APP_SECRET') && env('PUBLIC_BASE_URL'));

function authUrl(state) {
  return 'https://www.instagram.com/oauth/authorize?' + new URLSearchParams({
    client_id: env('INSTAGRAM_APP_ID'), redirect_uri: redirectUri(), response_type: 'code', scope: SCOPES.join(','), state,
  });
}

async function handleCallback(code) {
  const short = await fetchJson('https://api.instagram.com/oauth/access_token', {
    method: 'POST', body: form({ client_id: env('INSTAGRAM_APP_ID'), client_secret: env('INSTAGRAM_APP_SECRET'), grant_type: 'authorization_code', redirect_uri: redirectUri(), code: code.replace(/#_$/, '') }),
  });
  const long = await fetchJson(`https://graph.instagram.com/access_token?${new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: env('INSTAGRAM_APP_SECRET'), access_token: short.access_token })}`);
  const tokens = { access_token: long.access_token, expiresAt: Date.now() + (long.expires_in || 5184000) * 1000 };
  const me = await fetchJson(`${G}/me?fields=user_id,username,profile_picture_url,account_type&access_token=${tokens.access_token}`);
  return { tokens, identity: { remoteUserId: me.user_id || me.id, handle: me.username, avatar: me.profile_picture_url, accountType: me.account_type } };
}

async function refresh(tokens) {
  const t = await fetchJson(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${tokens.access_token}`);
  return { access_token: t.access_token, expiresAt: Date.now() + (t.expires_in || 5184000) * 1000 };
}
const refreshWindowMs = 10 * 24 * 3600 * 1000; // lang laufende Tokens 10 Tage vor Ablauf erneuern

async function createContainer(igId, token, params) {
  const r = await fetchJson(`${G}/${igId}/media`, { method: 'POST', body: form({ ...params, access_token: token }) });
  return r.id;
}

async function waitReady(id, token, maxMs = 10 * 60 * 1000) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    const s = await fetchJson(`${G}/${id}?fields=status_code,status&access_token=${token}`);
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram-Verarbeitung fehlgeschlagen: ${s.status || s.status_code}`);
    await sleep(5000);
  }
  throw new Error('Instagram-Verarbeitung dauert zu lange (Timeout)');
}

function captionOf(post) {
  const tags = (post.hashtags || []).map(h => '#' + h.replace(/^#/, ''));
  let c = post.caption || '';
  const missing = tags.filter(t => !c.includes(t));
  if (missing.length) c += '\n\n' + missing.join(' ');
  return c.slice(0, 2200);
}

// ctx: { tokens, account, post, mediaUrl(path) }
async function publish(ctx) {
  const { tokens, account, post } = ctx;
  const igId = account.identity.remoteUserId, tk = tokens.access_token;
  const caption = captionOf(post);
  let creation;
  const fmt = post.format;
  if (fmt === 'story') {
    creation = await createContainer(igId, tk, post.mediaPath ? { media_type: 'STORIES', video_url: ctx.mediaUrl(post.mediaPath) } : { media_type: 'STORIES', image_url: ctx.mediaUrl(post.images[0]) });
  } else if (post.mediaPath) {
    creation = await createContainer(igId, tk, { media_type: 'REELS', video_url: ctx.mediaUrl(post.mediaPath), caption, share_to_feed: 'true' });
  } else if ((post.images || []).length >= 2) {
    const imgs = post.images.slice(0, 20);
    const children = [];
    for (const img of imgs) children.push(await createContainer(igId, tk, { image_url: ctx.mediaUrl(img), is_carousel_item: 'true' }));
    for (const c of children) await waitReady(c, tk, 120000);
    creation = await createContainer(igId, tk, { media_type: 'CAROUSEL', children: children.join(','), caption });
  } else if ((post.images || []).length === 1) {
    creation = await createContainer(igId, tk, { image_url: ctx.mediaUrl(post.images[0]), caption });
  } else throw new Error('Kein Medium für Instagram vorhanden');

  await waitReady(creation, tk);
  const pub = await fetchJson(`${G}/${igId}/media_publish`, { method: 'POST', body: form({ creation_id: creation, access_token: tk }) });
  let url = null;
  try { url = (await fetchJson(`${G}/${pub.id}?fields=permalink&access_token=${tk}`)).permalink; } catch {}
  return { remoteId: pub.id, url };
}

async function stats({ tokens, account, sinceMs }) {
  const tk = tokens.access_token, igId = account.identity.remoteUserId;
  const out = [];
  let url = `${G}/${igId}/media?fields=id,caption,media_type,media_product_type,timestamp,like_count,comments_count,permalink&limit=50&access_token=${tk}`;
  for (let i = 0; i < 6 && url; i++) {
    const j = await fetchJson(url);
    for (const m of j.data || []) {
      if (new Date(m.timestamp).getTime() < sinceMs) { url = null; break; }
      let views = null;
      try {
        const ins = await fetchJson(`${G}/${m.id}/insights?metric=views&access_token=${tk}`);
        views = ins.data?.[0]?.values?.[0]?.value ?? ins.data?.[0]?.total_value?.value ?? null;
      } catch {}
      out.push({
        remoteId: m.id, title: (m.caption || '').split('\n')[0].slice(0, 80), caption: m.caption || '', publishedAt: m.timestamp,
        views: views ?? 0, likes: m.like_count || 0, comments: m.comments_count || 0, url: m.permalink, mediaType: m.media_product_type || m.media_type,
        hashtags: (m.caption || '').match(/#[\p{L}\p{N}_]+/gu) || [],
      });
    }
    if (url) url = j.paging?.next || null;
  }
  return out;
}

async function comments({ tokens, remoteId }) {
  const j = await fetchJson(`${G}/${remoteId}/comments?fields=id,text,username,timestamp&access_token=${tokens.access_token}`);
  return (j.data || []).map(c => ({ id: c.id, author: c.username, text: c.text, at: c.timestamp }));
}

module.exports = { name: 'instagram', label: 'Instagram', configured, authUrl, handleCallback, refresh, refreshWindowMs, publish, stats, comments, redirectUri, needsTunnel: true, formats: ['reel', 'story', 'feed', 'carousel'] };
