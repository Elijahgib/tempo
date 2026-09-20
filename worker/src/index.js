/* Tempo API Worker — Cloudflare Workers (free tier).
 *
 * Exists for exactly two things the public GitHub Pages frontend cannot do:
 *   1. Sign Audiomack requests with OAuth 1.0a (needs a consumer secret).
 *   2. Fetch a user-supplied PUBLIC Musi playlist (Musi sends no CORS headers).
 *
 * Deliberately NOT here: user accounts, auth, database, analytics, payments,
 * persistent storage, media caching. No audio is proxied or stored — the
 * Audiomack stream URL is handed straight back to the browser.
 *
 * Secrets live as Worker secrets (`wrangler secret put`), never in git.
 */

const ALLOWED_ORIGINS = [
  'https://elijahgib.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];

const AUDIOMACK = 'https://api.audiomack.com/v1';
const MUSI = 'https://feelthemusi.com/api/v4/playlists/fetch/';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors);
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin not allowed' }, 403, cors);

    // Cheap per-IP throttle. Uses the cache API so it needs no extra binding.
    const limited = await rateLimited(request, ctx);
    if (limited) return json({ error: 'rate limited, try again shortly' }, 429, cors);

    try {
      const path = url.pathname.replace(/\/+$/, '');

      if (path === '' || path === '/health') {
        return json({
          ok: true,
          service: 'tempo-api',
          musi: true,
          audiomack: !!(env.AUDIOMACK_KEY && env.AUDIOMACK_SECRET)
        }, 200, cors);
      }

      if (path.startsWith('/musi/')) {
        return await handleMusi(decodeURIComponent(path.slice('/musi/'.length)), cors);
      }

      if (path === '/audiomack/search') {
        return await handleAudiomackSearch(url, env, cors);
      }

      if (path.startsWith('/audiomack/stream/')) {
        return await handleAudiomackStream(decodeURIComponent(path.slice('/audiomack/stream/'.length)), env, cors);
      }

      return json({ error: 'not found' }, 404, cors);
    } catch (err) {
      return json({ error: String((err && err.message) || err) }, 502, cors);
    }
  }
};

/* ---------------- Musi ---------------- */

// Fetches ONE public playlist the user explicitly asked for. No crawling,
// no enumeration, no following of any other link.
async function handleMusi(code, cors) {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(code)) return json({ error: 'bad playlist code' }, 400, cors);
  const r = await fetch(MUSI + encodeURIComponent(code), {
    headers: { 'accept': 'application/json', 'user-agent': 'Tempo/1.0 (personal playlist import)' },
    cf: { cacheTtl: 60, cacheEverything: true }
  });
  if (!r.ok) return json({ error: 'musi responded ' + r.status }, r.status === 404 ? 404 : 502, cors);
  const text = await r.text();
  if (text.length > 4_000_000) return json({ error: 'playlist too large' }, 413, cors);
  let parsed;
  try { parsed = JSON.parse(text); } catch { return json({ error: 'musi returned invalid JSON' }, 502, cors); }
  return json(parsed, 200, cors);
}

/* ---------------- Audiomack ---------------- */

function requireAudiomack(env, cors) {
  if (!env.AUDIOMACK_KEY || !env.AUDIOMACK_SECRET) {
    return json({ error: 'audiomack_not_configured', detail: 'Worker has no AUDIOMACK_KEY/SECRET set.' }, 503, cors);
  }
  return null;
}

async function handleAudiomackSearch(url, env, cors) {
  const missing = requireAudiomack(env, cors); if (missing) return missing;
  const q = (url.searchParams.get('q') || '').slice(0, 200);
  if (!q.trim()) return json({ results: [] }, 200, cors);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 25));

  const target = AUDIOMACK + '/search';
  const params = { q, limit: String(limit), show: 'songs' };
  const signed = await oauthUrl('GET', target, params, env);
  const r = await fetch(signed, { headers: { accept: 'application/json' } });
  if (!r.ok) return json({ error: 'audiomack responded ' + r.status }, 502, cors);
  const body = await r.json();
  return json({ results: normaliseAudiomack(body) }, 200, cors);
}

async function handleAudiomackStream(id, env, cors) {
  const missing = requireAudiomack(env, cors); if (missing) return missing;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json({ error: 'bad id' }, 400, cors);
  // Audiomack stream URLs expire in roughly 10 seconds, so this is requested
  // immediately before playback and never cached or stored.
  const target = `${AUDIOMACK}/music/${encodeURIComponent(id)}/play`;
  const signed = await oauthUrl('GET', target, {}, env);
  const r = await fetch(signed, { headers: { accept: 'application/json' } });
  if (!r.ok) return json({ error: 'audiomack responded ' + r.status }, 502, cors);
  const body = await r.json();
  const streamUrl = body?.results?.streaming_url || body?.streaming_url || body?.results?.url || '';
  if (!streamUrl) return json({ error: 'no stream url returned' }, 502, cors);
  return json({ url: streamUrl, expiresInSeconds: 10 }, 200, cors);
}

// Maps Audiomack's payload onto the shape Tempo's provider adapter expects.
function normaliseAudiomack(body) {
  const list = body?.results || body?.data || [];
  const arr = Array.isArray(list) ? list : (list.songs || []);
  return arr.slice(0, 50).map(s => ({
    id: String(s.id ?? s.music_id ?? ''),
    title: String(s.title ?? s.song_title ?? ''),
    artist: String(s.artist ?? s.uploader?.name ?? ''),
    album: String(s.album ?? ''),
    image: String(s.image ?? s.image_base ?? ''),
    duration: Number(s.duration) || 0,
    plays: Number(s.playlist_plays ?? s.plays_raw ?? s.plays ?? 0) || 0,
    favorites: Number(s.favorites_raw ?? s.favorites ?? 0) || 0,
    reposts: Number(s.reposts_raw ?? s.reposts ?? 0) || 0,
    url: String(s.url ?? ''),
    streamable: s.streaming_disabled ? false : true
  })).filter(s => s.id && s.title);
}

/* ---------------- OAuth 1.0a (two-legged, consumer credentials only) ------- */

async function oauthUrl(method, target, extraParams, env) {
  const oauth = {
    oauth_consumer_key: env.AUDIOMACK_KEY,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0'
  };
  const all = { ...extraParams, ...oauth };
  const normalised = Object.keys(all).sort()
    .map(k => `${pct(k)}=${pct(all[k])}`).join('&');
  const base = [method.toUpperCase(), pct(target), pct(normalised)].join('&');
  // Two-legged: no token secret, but the trailing '&' is still required.
  const signingKey = `${pct(env.AUDIOMACK_SECRET)}&`;
  const signature = await hmacSha1(signingKey, base);
  const qs = normalised + '&oauth_signature=' + pct(signature);
  return `${target}?${qs}`;
}

// RFC 3986 percent-encoding — stricter than encodeURIComponent.
function pct(v) {
  return encodeURIComponent(String(v))
    .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

async function hmacSha1(key, message) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/* ---------------- helpers ---------------- */

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'accept,content-type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cors }
  });
}

// ~60 requests/minute per IP, tracked in the edge cache. Good enough to stop
// accidental hammering without introducing KV or Durable Objects.
async function rateLimited(request, ctx) {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'anon';
    const bucket = Math.floor(Date.now() / 60000);
    const key = new Request(`https://rate.tempo.invalid/${encodeURIComponent(ip)}/${bucket}`);
    const cache = caches.default;
    const hit = await cache.match(key);
    const count = hit ? Number(await hit.text()) || 0 : 0;
    if (count >= 60) return true;
    ctx.waitUntil(cache.put(key, new Response(String(count + 1), {
      headers: { 'cache-control': 'max-age=60' }
    })));
    return false;
  } catch { return false; }
}
