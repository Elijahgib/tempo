/* Tempo — provider-based music player.
 *
 * Architecture
 *   providers.*        one object per source (audius | local | youtube)
 *   engine             ONE persistent HTMLAudioElement, created once at boot
 *   ytPlayer           the existing YouTube IFrame player, kept as a
 *                      FOREGROUND-ONLY fallback provider
 *   render()           rewrites #app only; media elements live outside it
 */
(() => {
  'use strict';

  const APP_NAME = 'Tempo';
  const AUDIUS = 'https://api.audius.co/v1';
  const JAMENDO = 'https://api.jamendo.com/v3.0';
  const KEY_V2 = 'tempo-state-v2';
  const KEY_V1 = 'tempo-state-v1';
  const HINT_KEY = 'tempo-install-hint-dismissed';
  const YT_NOTICE_KEY = 'tempo-yt-notice-seen';
  // Kept in localStorage, never in the repo — this is a public GitHub Pages site.
  const JAMENDO_KEY = 'tempo-jamendo-client-id';
  const DEBUG_KEY = 'tempo-search-debug';
  const ID_RE = /^[A-Za-z0-9_-]{11}$/;
  const YT_HOSTS = ['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be','www.youtu.be','youtube-nocookie.com','www.youtube-nocookie.com'];
  const FATAL_YT = [2, 5, 100, 101, 150];

  const emptyState = () => ({ tracks: {}, favorites: [], history: [], queue: [], playlists: [] });

  let state = load();
  let tab = 'favorites';
  let view = null;             // { kind:'playlist', id } etc.
  let search = { q: '', mode: 'tracks', results: [], artists: [], loading: false, error: '', ran: false, notes: [], raw: null };
  let now = null;              // uid of the loaded track
  let nowPlaying = false;      // full-screen Now Playing open?
  let shuffle = false;
  let repeat = 'off';          // off | one | all
  let progress = { t: 0, d: 0 };
  let toastMsg = '', toastErr = false, toastTimer = null;

  /* =========================================================================
     Storage + migration
     ========================================================================= */

  function load() {
    const fresh = emptyState();
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY_V2) || 'null'); } catch {}
    if (raw && raw.tracks) return normalizeState({ ...fresh, ...raw });

    // Migrate the V0.1–V0.3 shape: a flat library of YouTube tracks keyed by video id.
    let old = null;
    try { old = JSON.parse(localStorage.getItem(KEY_V1) || 'null'); } catch {}
    if (!old || !Array.isArray(old.library)) return fresh;

    const out = emptyState();
    for (const t of old.library) {
      if (!t || !ID_RE.test(String(t.id || ''))) continue;
      const uid = 'youtube:' + t.id;
      out.tracks[uid] = {
        uid, provider: 'youtube', providerTrackId: t.id,
        title: String(t.title || ('YouTube ' + t.id)).slice(0, 300),
        artist: String(t.artist || '').slice(0, 150),
        artwork: t.thumb || ytThumb(t.id),
        duration: 0,
        url: t.url || ytWatch(t.id),
        addedAt: Number.isFinite(t.addedAt) ? t.addedAt : Date.now(),
        meta: t.meta, blocked: t.blocked === true || undefined
      };
    }
    const keep = ids => (Array.isArray(ids) ? ids : [])
      .map(id => 'youtube:' + id).filter(u => out.tracks[u]);
    out.favorites = keep(old.favorites);
    out.queue = keep(old.queue);
    out.history = keep(old.history);
    out.migratedFrom = 'v1';
    return out;
  }

  function normalizeState(s) {
    s.tracks = s.tracks && typeof s.tracks === 'object' ? s.tracks : {};
    for (const [uid, t] of Object.entries(s.tracks)) {
      if (!t || typeof t !== 'object') { delete s.tracks[uid]; continue; }
      t.uid = uid;
      // The uid prefix is authoritative: it repairs rows written by a build whose
      // provider allow-list was missing a provider (which rewrote them to youtube).
      const fromUid = uid.slice(0, uid.indexOf(':'));
      const known = ['audius','jamendo','local','youtube'];
      t.provider = known.includes(fromUid) ? fromUid
        : (known.includes(t.provider) ? t.provider : 'youtube');
      t.artist = t.artist || '';
      t.duration = Number.isFinite(t.duration) ? t.duration : 0;
    }
    const live = a => (Array.isArray(a) ? a : []).filter(u => s.tracks[u]);
    s.favorites = live(s.favorites); s.queue = live(s.queue); s.history = live(s.history);
    s.playlists = (Array.isArray(s.playlists) ? s.playlists : []).map(p => ({
      id: String(p.id || uuid()),
      name: String(p.name || 'Playlist').slice(0, 80),
      trackUids: live(p.trackUids),
      createdAt: Number.isFinite(p.createdAt) ? p.createdAt : Date.now()
    }));
    return s;
  }

  function save() { try { localStorage.setItem(KEY_V2, JSON.stringify(state)); } catch {} }
  function uuid() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(v = '') { return String(v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }
  function ytThumb(id) { return 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'; }
  function ytWatch(id) { return 'https://www.youtube.com/watch?v=' + id; }
  function track(uid) { return state.tracks[uid]; }
  function isFav(uid) { return state.favorites.includes(uid); }
  function fmt(s) {
    if (!Number.isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m + ':' + String(r).padStart(2, '0');
  }

  /* =========================================================================
     Providers
     ========================================================================= */

  const providers = {
    audius: {
      id: 'audius', label: 'Audius', background: true,
      async search(q) {
        const r = await fetch(`${AUDIUS}/tracks/search?query=${encodeURIComponent(q)}&limit=30&app_name=${APP_NAME}`);
        if (!r.ok) throw new Error('Audius search failed (' + r.status + ')');
        return ((await r.json()).data || []).filter(playableAudius).map(fromAudius);
      },
      async searchArtists(q) {
        const r = await fetch(`${AUDIUS}/users/search?query=${encodeURIComponent(q)}&limit=12&app_name=${APP_NAME}`);
        if (!r.ok) throw new Error('Audius artist search failed');
        return ((await r.json()).data || []).map(u => ({
          id: u.id, name: u.name || u.handle, handle: u.handle,
          artwork: (u.profile_picture && (u.profile_picture['480x480'] || u.profile_picture['150x150'])) || '',
          trackCount: u.track_count || 0
        }));
      },
      async artistTracks(id) {
        const r = await fetch(`${AUDIUS}/users/${encodeURIComponent(id)}/tracks?limit=30&app_name=${APP_NAME}`);
        if (!r.ok) throw new Error('Could not load artist tracks');
        return ((await r.json()).data || []).filter(playableAudius).map(fromAudius);
      },
      async trending() {
        const r = await fetch(`${AUDIUS}/tracks/trending?limit=30&app_name=${APP_NAME}`);
        if (!r.ok) throw new Error('Audius trending failed');
        return ((await r.json()).data || []).filter(playableAudius).map(fromAudius);
      },
      // Resolved at play time on purpose — never persisted.
      streamUrl(t) { return `${AUDIUS}/tracks/${encodeURIComponent(t.providerTrackId)}/stream?app_name=${APP_NAME}`; }
    },

    jamendo: {
      id: 'jamendo', label: 'Jamendo', background: true,
      get clientId() { try { return localStorage.getItem(JAMENDO_KEY) || ''; } catch { return ''; } },
      get enabled() { return !!this.clientId; },
      async _query(q) {
        const u = `${JAMENDO}/tracks/?client_id=${encodeURIComponent(this.clientId)}&format=json&limit=40`
          + `&include=stats&imagesize=300&search=${encodeURIComponent(q)}`;
        const r = await fetch(u);
        if (!r.ok) throw new Error('Jamendo HTTP ' + r.status);
        const j = await r.json();
        const h = j.headers || {};
        if (h.status !== 'success') throw new Error('Jamendo: ' + (h.error_message || 'request failed'));
        return (j.results || []).filter(playableJamendo).map(fromJamendo);
      },
      // Jamendo intermittently answers "success" with an empty result set for
      // queries that do have matches, so an empty reply gets one retry.
      async search(q) {
        if (!this.enabled) return [];
        let out = await this._query(q);
        if (!out.length) {
          await new Promise(r => setTimeout(r, 450));
          out = await this._query(q);
        }
        return out;
      },
      // The audio URL carries an opaque "from" token, so it is resolved on demand
      // and cached for the session only — never written to storage or backups.
      streamUrl(t) { return streamRefs.get(t.uid) || ''; },
      async resolveStream(t) {
        const cached = streamRefs.get(t.uid);
        if (cached) return cached;
        if (!this.enabled) throw new Error('Jamendo is not set up.');
        const u = `${JAMENDO}/tracks/?client_id=${encodeURIComponent(this.clientId)}&format=json&id=${encodeURIComponent(t.providerTrackId)}`;
        // Same intermittent-empty behaviour as search, so retry once.
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt) await new Promise(r => setTimeout(r, 450));
          const r = await fetch(u);
          if (!r.ok) continue;
          const hit = ((await r.json()).results || [])[0];
          if (hit && hit.audio) { streamRefs.set(t.uid, hit.audio); return hit.audio; }
        }
        throw new Error('Jamendo stream unavailable.');
      }
    },

    local: {
      id: 'local', label: 'My Music', background: true,
      streamUrl(t) { return localUrls.get(t.uid) || ''; }
    },

    youtube: {
      id: 'youtube', label: 'YouTube', background: false, // FOREGROUND-ONLY
      async meta(id) {
        const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(ytWatch(id))}&format=json`);
        if (!r.ok) throw new Error('oembed ' + r.status);
        const d = await r.json();
        return { title: d.title || '', artist: d.author_name || '', artwork: d.thumbnail_url || ytThumb(id) };
      }
    }
  };

  // Respect Audius gating: skip deleted, non-streamable, and gated tracks.
  function playableAudius(t) {
    return t && t.is_streamable === true && !t.is_delete && !t.stream_conditions &&
      !(t.access && t.access.stream === false);
  }

  function fromAudius(t) {
    const art = t.artwork || {};
    return {
      uid: 'audius:' + t.id,
      provider: 'audius',
      providerTrackId: t.id,
      title: String(t.title || 'Untitled').slice(0, 300),
      artist: String((t.user && (t.user.name || t.user.handle)) || '').slice(0, 150),
      artwork: art['480x480'] || art['150x150'] || art['1000x1000'] || '',
      duration: Number(t.duration) || 0,
      url: t.permalink ? 'https://audius.co' + t.permalink : 'https://audius.co',
      addedAt: Date.now(),
      playCount: Number(t.play_count) || 0,
      favoriteCount: Number(t.favorite_count) || 0,
      repostCount: Number(t.repost_count) || 0
    };
  }

  function playableJamendo(t) { return t && t.audio && t.name && t.id; }

  function fromJamendo(t) {
    const s = t.stats || {};
    const tr = {
      uid: 'jamendo:' + t.id,
      provider: 'jamendo',
      providerTrackId: String(t.id),
      title: String(t.name || 'Untitled').slice(0, 300),
      artist: String(t.artist_name || '').slice(0, 150),
      artwork: t.image || t.album_image || '',
      duration: Number(t.duration) || 0,
      url: t.shareurl || 'https://www.jamendo.com',
      addedAt: Date.now(),
      playCount: Number(s.rate_listened_total) || 0,
      favoriteCount: Number(s.favorited) || 0,
      repostCount: Number(s.playlisted) || 0
    };
    if (t.audio) streamRefs.set(tr.uid, t.audio);
    return tr;
  }

  const localUrls = new Map();  // uid -> object URL (session only)
  const streamRefs = new Map(); // uid -> resolved stream URL (session only)

  /* ---------- search ranking ----------
     One scorer for every provider. Engagement is converted to a percentile
     *within each provider's own result set*, so a provider with bigger raw
     numbers cannot dominate purely because of scale.                        */

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFKD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function textScore(t, q) {
    const query = norm(q);
    if (!query) return { score: 0, why: 'no query' };
    const title = norm(t.title), artist = norm(t.artist);
    const toks = query.split(' ').filter(Boolean);
    const combo = title + ' ' + artist;

    if (title === query) return { score: 100, why: 'exact title', exact: true };
    if (artist === query) return { score: 92, why: 'exact artist', exact: true };
    if (norm(t.artist + ' ' + t.title) === query || norm(t.title + ' ' + t.artist) === query)
      return { score: 96, why: 'exact artist + title', exact: true };
    if (title.startsWith(query)) return { score: 70, why: 'title prefix' };
    if (artist.startsWith(query)) return { score: 56, why: 'artist prefix' };

    const word = (hay, k) => new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(hay);
    const inTitle = toks.filter(k => word(title, k)).length;
    const inArtist = toks.filter(k => word(artist, k)).length;
    const inCombo = toks.filter(k => combo.includes(k)).length;

    if (inTitle === toks.length) return { score: 48, why: 'all terms in title' };
    if (inTitle + inArtist >= toks.length) return { score: 40, why: 'terms across title + artist' };
    if (inCombo === toks.length) return { score: 30, why: 'all terms (loose)' };
    return { score: Math.round(18 * inCombo / toks.length), why: inCombo + '/' + toks.length + ' terms matched' };
  }

  function engagementPercentiles(list) {
    const raw = list.map(t =>
      Math.log10(1 + (t.playCount || 0)) * 1.0 +
      Math.log10(1 + (t.favoriteCount || 0)) * 1.4 +
      Math.log10(1 + (t.repostCount || 0)) * 1.2);
    const sorted = [...raw].sort((a, b) => a - b);
    return raw.map(v => sorted.length > 1 ? sorted.filter(x => x < v).length / (sorted.length - 1) : 0.5);
  }

  // Almost no engagement AND not an exact match -> buried.
  function isLowEngagement(t) {
    return (t.playCount || 0) < 50 && (t.favoriteCount || 0) < 5 && (t.repostCount || 0) < 3;
  }

  function rankResults(groups, q) {
    const scored = [];
    for (const list of groups) {
      if (!list.length) continue;
      const pct = engagementPercentiles(list);
      list.forEach((t, i) => {
        const ts = textScore(t, q);
        const engPts = pct[i] * 30;
        const low = isLowEngagement(t);
        const penalty = (low && !ts.exact) ? -30 : 0;
        scored.push({
          ...t,
          _score: ts.score + engPts + penalty,
          _dbg: {
            text: ts.score, why: ts.why,
            engPct: Math.round(pct[i] * 100), engPts: Math.round(engPts),
            penalty, plays: t.playCount || 0, favs: t.favoriteCount || 0, reposts: t.repostCount || 0,
            total: Math.round(ts.score + engPts + penalty)
          }
        });
      });
    }
    // Deduplicate obvious title+artist repeats across providers, keeping the best score.
    const seen = new Map();
    for (const t of scored) {
      const key = norm(t.title) + '|' + norm(t.artist);
      const prev = seen.get(key);
      if (!prev) { seen.set(key, t); continue; }
      const win = t._score > prev._score ? t : prev;
      const lose = win === t ? prev : t;
      win._dbg.dupOf = (win._dbg.dupOf || []).concat(lose.provider);
      seen.set(key, win);
    }
    return [...seen.values()].sort((a, b) => b._score - a._score);
  }

  function searchDebugOn() { try { return localStorage.getItem(DEBUG_KEY) === '1'; } catch { return false; } }

  function extractVideoId(input = '') {
    const v = String(input).trim();
    if (!v) return null;
    if (ID_RE.test(v)) return v;
    let url;
    try { url = new URL(/^[a-z]+:\/\//i.test(v) ? v : 'https://' + v); } catch { return null; }
    const host = url.hostname.toLowerCase();
    if (!YT_HOSTS.includes(host)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    let c = null;
    if (host.includes('youtu.be')) c = parts[0] || null;
    else if (['shorts','embed','live','v'].includes(parts[0])) c = parts[1] || null;
    else c = url.searchParams.get('v');
    return c && ID_RE.test(c) ? c : null;
  }

  /* =========================================================================
     Audio engine — ONE element, created once, never re-created by render()
     ========================================================================= */

  const audio = new Audio();
  audio.preload = 'metadata';
  // No crossOrigin: an <audio> element only needs a plain media load, and
  // Jamendo's CDN sends no CORS headers — setting it would break playback there.

  const engine = {
    load(t, autoplay = true) {
      const p = providers[t.provider];
      const src = p.streamUrl ? p.streamUrl(t) : '';
      if (src) {
        if (audio.src !== src) { audio.src = src; audio.load(); }
        if (autoplay) engine.play();
        return;
      }
      if (p.resolveStream) {
        // Resolving costs a round trip, which can outlive the user gesture on
        // iOS. If autoplay is then refused, the toast tells the user to tap play.
        p.resolveStream(t).then(url => {
          if (now !== t.uid) return;
          audio.src = url; audio.load();
          if (autoplay) engine.play();
        }).catch(err => toast(err.message || 'Could not load that track.', true));
        return;
      }
      toast(t.provider === 'local'
        ? 'That local file is no longer available this session.'
        : 'No playable stream for that track.', true);
    },
    play() {
      const p = audio.play();
      if (p && p.catch) p.catch(err => {
        if (err && err.name === 'NotAllowedError') toast('Tap play to start audio.', true);
      });
    },
    pause() { audio.pause(); },
    toggle() { if (audio.paused) engine.play(); else engine.pause(); },
    seek(sec) { if (Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(sec, audio.duration)); },
    get playing() { return !audio.paused && !audio.ended; }
  };

  audio.addEventListener('timeupdate', () => {
    progress = { t: audio.currentTime || 0, d: audio.duration || 0 };
    paintProgress();
    updatePositionState();
  });
  audio.addEventListener('durationchange', () => {
    const t = track(now);
    if (t && Number.isFinite(audio.duration) && audio.duration > 0 && !t.duration) { t.duration = audio.duration; save(); }
  });
  audio.addEventListener('play', () => { paintTransport(); updateMediaSession(); });
  audio.addEventListener('pause', paintTransport);
  audio.addEventListener('ended', () => advance(1, true));
  audio.addEventListener('error', () => {
    const t = track(now);
    if (t && t.provider !== 'youtube') toast('Could not play "' + (t.title || 'track') + '".', true);
  });

  /* =========================================================================
     YouTube — kept intact, foreground-only
     ========================================================================= */

  let ytPlayer = null, ytApi = null, ytMounted = null, ytBroken = false, ytError = null;

  function loadYouTubeApi() {
    if (ytApi) return ytApi;
    ytApi = new Promise((res, rej) => {
      if (window.YT && window.YT.Player) return res(window.YT);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (typeof prev === 'function') prev(); res(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => rej(new Error('iframe_api failed'));
      document.head.appendChild(s);
      setTimeout(() => rej(new Error('iframe_api timeout')), 15000);
    }).catch(e => { ytBroken = true; throw e; });
    return ytApi;
  }

  async function ytMount(t) {
    const host = document.querySelector('#yt-mount');
    if (!host) return;
    try {
      const YTapi = await loadYouTubeApi();
      const cur = track(now);
      if (!cur || cur.uid !== t.uid) return;
      if (ytPlayer && ytPlayer.loadVideoById) { ytPlayer.loadVideoById(t.providerTrackId); ytMounted = t.uid; return; }
      ytPlayer = new YTapi.Player(host, {
        videoId: t.providerTrackId,
        playerVars: { playsinline: 1, rel: 0, origin: location.origin },
        events: {
          onStateChange: e => {
            if (e.data === 1) { const c = track(now); if (c && c.blocked) { delete c.blocked; save(); } paintTransport(); }
            if (e.data === 2) paintTransport();
            if (e.data === 0) advance(1, true);
          },
          onError: e => {
            if (!FATAL_YT.includes(e.data)) return;
            const c = track(now);
            ytError = { uid: c && c.uid, code: e.data };
            if (c) { c.blocked = true; save(); }
            render();
          }
        }
      });
      ytMounted = t.uid;
    } catch { render(); }
  }

  function ytDestroy() {
    if (ytPlayer && ytPlayer.destroy) { try { ytPlayer.destroy(); } catch {} }
    ytPlayer = null; ytMounted = null;
  }

  function ytPlaying() {
    try { return !!ytPlayer && ytPlayer.getPlayerState && ytPlayer.getPlayerState() === 1; } catch { return false; }
  }

  /* =========================================================================
     Playback controller — routes between the audio engine and YouTube
     ========================================================================= */

  function isYT(t) { return t && t.provider === 'youtube'; }
  function current() { return track(now); }
  function transportPlaying() { const t = current(); return isYT(t) ? ytPlaying() : engine.playing; }

  function playTrack(uid, opts = {}) {
    const t = track(uid);
    if (!t) return;
    now = uid;
    ytError = null;
    progress = { t: 0, d: t.duration || 0 };
    state.history = [uid, ...state.history.filter(x => x !== uid)].slice(0, 100);
    state.queue = state.queue.filter(x => x !== uid);
    save();

    if (isYT(t)) {
      engine.pause();
      if (!localStorage.getItem(YT_NOTICE_KEY)) {
        toast('YouTube playback pauses when Tempo is backgrounded.');
        try { localStorage.setItem(YT_NOTICE_KEY, '1'); } catch {}
      }
      if (opts.open !== false) nowPlaying = true;
      render();
    } else {
      ytDestroy();
      engine.load(t, true);
      if (opts.open !== false) nowPlaying = true;
      render();
      updateMediaSession();
    }
  }

  function nextUid() {
    if (repeat === 'one' && now) return now;
    if (state.queue.length) return state.queue[0];
    const list = contextList();
    if (!list.length) return null;
    if (shuffle) {
      const pool = list.filter(u => u !== now);
      if (!pool.length) return repeat === 'all' ? now : null;
      return pool[Math.floor(Math.random() * pool.length)];
    }
    const i = list.indexOf(now);
    if (i === -1) return list[0];
    if (i + 1 < list.length) return list[i + 1];
    return repeat === 'all' ? list[0] : null;
  }

  function prevUid() {
    const list = contextList();
    const i = list.indexOf(now);
    if (i > 0) return list[i - 1];
    return repeat === 'all' && list.length ? list[list.length - 1] : null;
  }

  // What "next" means depends on where playback started from.
  let playContext = null; // array of uids
  function contextList() { return (playContext && playContext.length ? playContext : state.favorites).filter(u => state.tracks[u]); }

  function advance(dir, auto = false) {
    if (dir > 0 && repeat === 'one' && auto) { engine.seek(0); engine.play(); return; }
    const uid = dir > 0 ? nextUid() : prevUid();
    if (!uid) { paintTransport(); return; }
    playTrack(uid, { open: false });
  }

  /* =========================================================================
     Media Session — lock screen / Control Center metadata
     ========================================================================= */

  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const t = current();
    if (!t) return;
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: t.title || 'Tempo',
        artist: t.artist || '',
        album: 'Tempo',
        artwork: t.artwork ? [
          { src: t.artwork, sizes: '512x512', type: 'image/jpeg' },
          { src: t.artwork, sizes: '192x192', type: 'image/jpeg' }
        ] : []
      });
      const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch {} };
      set('play', () => { engine.play(); paintTransport(); });
      set('pause', () => { engine.pause(); paintTransport(); });
      set('nexttrack', () => advance(1));
      set('previoustrack', () => advance(-1));
      set('seekto', d => { if (d && Number.isFinite(d.seekTime)) engine.seek(d.seekTime); });
      set('seekforward', d => engine.seek(audio.currentTime + ((d && d.seekOffset) || 10)));
      set('seekbackward', d => engine.seek(audio.currentTime - ((d && d.seekOffset) || 10)));
    } catch {}
  }

  function updatePositionState() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(audio.currentTime, audio.duration)
      });
    } catch {}
  }

  /* =========================================================================
     Library actions
     ========================================================================= */

  function addTrack(t) {
    // _score/_dbg are per-search ranking artifacts — never persist them.
    const { _score, _dbg, ...clean } = t;
    const existing = state.tracks[t.uid];
    state.tracks[t.uid] = existing ? { ...existing, ...clean, addedAt: existing.addedAt } : clean;
    save();
    return state.tracks[t.uid];
  }

  function toggleFav(uid) {
    if (!state.tracks[uid]) return;
    state.favorites = isFav(uid) ? state.favorites.filter(x => x !== uid) : [uid, ...state.favorites];
    save(); render();
  }

  function enqueue(uid) {
    if (!state.tracks[uid]) return;
    state.queue = [...state.queue.filter(x => x !== uid), uid];
    save(); render();
    toast('Added to queue.');
  }

  function dequeue(uid) { state.queue = state.queue.filter(x => x !== uid); save(); render(); }

  function removeTrack(uid) {
    delete state.tracks[uid];
    state.favorites = state.favorites.filter(x => x !== uid);
    state.queue = state.queue.filter(x => x !== uid);
    state.history = state.history.filter(x => x !== uid);
    state.playlists.forEach(p => { p.trackUids = p.trackUids.filter(x => x !== uid); });
    localUrls.delete(uid);
    if (now === uid) { now = null; engine.pause(); audio.removeAttribute('src'); ytDestroy(); nowPlaying = false; }
    save(); render();
  }

  function createPlaylist(name) {
    const p = { id: uuid(), name: String(name || 'New playlist').slice(0, 80), trackUids: [], createdAt: Date.now() };
    state.playlists = [p, ...state.playlists];
    save(); render();
    return p;
  }

  function addToPlaylist(pid, uid) {
    const p = state.playlists.find(x => x.id === pid);
    if (!p || !state.tracks[uid]) return;
    if (!p.trackUids.includes(uid)) p.trackUids = [...p.trackUids, uid];
    save(); render();
    toast('Added to "' + p.name + '".');
  }

  function shufflePlay(list) {
    const pool = list.filter(u => state.tracks[u]);
    if (!pool.length) return;
    shuffle = true;
    playContext = pool;
    playTrack(pool[Math.floor(Math.random() * pool.length)]);
  }

  function playFrom(list, uid) { playContext = list.slice(); playTrack(uid); }

  /* =========================================================================
     Search
     ========================================================================= */

  let searchSeq = 0;
  async function runSearch(q) {
    const mine = ++searchSeq;
    search.q = q; search.loading = true; search.error = ''; search.ran = true;
    search.notes = []; search.raw = null;
    render();
    try {
      const yt = extractVideoId(q);
      if (yt) {
        const m = await providers.youtube.meta(yt).catch(() => ({ title: 'YouTube ' + yt, artist: '', artwork: ytThumb(yt) }));
        if (mine !== searchSeq) return;
        search.results = [{
          uid: 'youtube:' + yt, provider: 'youtube', providerTrackId: yt,
          title: m.title, artist: m.artist, artwork: m.artwork || ytThumb(yt),
          duration: 0, url: ytWatch(yt), addedAt: Date.now()
        }];
        search.artists = [];
      } else {
        // Both providers in parallel; one failing must not kill the other.
        const [au, jam, artists] = await Promise.all([
          providers.audius.search(q).catch(e => { search.notes.push('Audius: ' + e.message); return []; }),
          providers.jamendo.search(q).catch(e => { search.notes.push('Jamendo: ' + e.message); return []; }),
          providers.audius.searchArtists(q).catch(() => [])
        ]);
        if (mine !== searchSeq) return;
        search.raw = { audius: au.length, jamendo: jam.length };
        search.results = rankResults([au, jam], q);
        search.artists = artists;
        if (!au.length && !jam.length && !search.notes.length) search.notes.push('No results from either provider.');
      }
    } catch (e) {
      if (mine !== searchSeq) return;
      search.results = []; search.artists = [];
      search.error = e.message || 'Search failed.';
    }
    search.loading = false;
    render();
  }

  async function loadTrending() {
    search.loading = true; search.error = ''; search.ran = true; search.q = '';
    render();
    try {
      search.results = await providers.audius.trending();
      search.artists = [];
    } catch (e) { search.error = e.message || 'Could not load trending.'; }
    search.loading = false;
    render();
  }

  /* =========================================================================
     Backup
     ========================================================================= */

  function exportLibrary() {
    const payload = {
      app: 'tempo', schema: 2, exportedAt: new Date().toISOString(),
      tracks: Object.values(state.tracks).filter(t => t.provider !== 'local'),
      favorites: state.favorites, queue: state.queue, history: state.history,
      playlists: state.playlists
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'tempo-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Exported ' + payload.tracks.length + ' tracks.');
  }

  const s300 = (v, m = 300) => (typeof v === 'string' ? v : '').slice(0, m);

  // Everything is rebuilt field by field from primitives. Nothing from the file
  // is executed, spread into state, or trusted for its type.
  function sanitizeImport(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Not a Tempo backup file.');
    if (raw.app !== 'tempo') throw new Error('Not a Tempo backup file.');

    const out = emptyState();
    const legacy = Array.isArray(raw.library) ? raw.library : null;   // schema 1
    const modern = Array.isArray(raw.tracks) ? raw.tracks : null;     // schema 2
    if (!legacy && !modern) throw new Error('Backup is missing its tracks.');

    for (const t of (modern || legacy).slice(0, 5000)) {
      if (!t || typeof t !== 'object') continue;
      let provider, pid;
      if (modern) {
        provider = ['audius','jamendo','youtube'].includes(t.provider) ? t.provider : null;
        pid = s300(t.providerTrackId, 64);
      } else {
        provider = 'youtube'; pid = s300(t.id, 11);
      }
      if (!provider || !pid) continue;
      if (provider === 'youtube' && !ID_RE.test(pid)) continue;
      if (provider === 'audius' && !/^[A-Za-z0-9_-]{1,32}$/.test(pid)) continue;
      if (provider === 'jamendo' && !/^[0-9]{1,16}$/.test(pid)) continue;
      const uid = provider + ':' + pid;
      if (out.tracks[uid]) continue;
      const art = s300(t.artwork || t.thumb, 500);
      out.tracks[uid] = {
        uid, provider, providerTrackId: pid,
        title: s300(t.title) || (provider === 'youtube' ? 'YouTube ' + pid : 'Untitled'),
        artist: s300(t.artist, 150),
        artwork: /^https:\/\//.test(art) ? art : (provider === 'youtube' ? ytThumb(pid) : ''),
        duration: Number.isFinite(t.duration) ? t.duration : 0,
        url: provider === 'youtube' ? ytWatch(pid) : (provider === 'jamendo' ? 'https://www.jamendo.com' : 'https://audius.co'),
        addedAt: Number.isFinite(t.addedAt) ? t.addedAt : Date.now(),
        meta: ['ok','manual','failed','pending'].includes(t.meta) ? t.meta : undefined,
        blocked: t.blocked === true || undefined
      };
    }

    const known = new Set(Object.keys(out.tracks));
    const toUid = v => (Array.isArray(v) ? v : []).map(x => {
      if (typeof x !== 'string') return null;
      return known.has(x) ? x : (known.has('youtube:' + x) ? 'youtube:' + x : null);
    }).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).slice(0, 2000);

    out.favorites = toUid(raw.favorites);
    out.queue = toUid(raw.queue);
    out.history = toUid(raw.history).slice(0, 100);
    out.playlists = (Array.isArray(raw.playlists) ? raw.playlists : []).slice(0, 200).map(p => {
      if (!p || typeof p !== 'object') return null;
      return { id: uuid(), name: s300(p.name, 80) || 'Playlist', trackUids: toUid(p.trackUids), createdAt: Number.isFinite(p.createdAt) ? p.createdAt : Date.now() };
    }).filter(Boolean);
    return out;
  }

  function importLibrary(file) {
    const reader = new FileReader();
    reader.onerror = () => toast('Could not read that file.', true);
    reader.onload = () => {
      let clean;
      try { clean = sanitizeImport(JSON.parse(String(reader.result))); }
      catch (err) { toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message, true); return; }
      if (!Object.keys(clean.tracks).length) { toast('That backup contains no valid tracks.', true); return; }
      state = clean; now = null; nowPlaying = false;
      engine.pause(); audio.removeAttribute('src'); ytDestroy();
      save(); render();
      toast('Imported ' + Object.keys(clean.tracks).length + ' tracks.');
    };
    reader.readAsText(file);
  }

  function addLocalFiles(files) {
    let n = 0;
    for (const f of files) {
      if (!f.type.startsWith('audio/')) continue;
      const uid = 'local:' + f.name.replace(/[^A-Za-z0-9_.-]/g, '_') + ':' + f.size;
      localUrls.set(uid, URL.createObjectURL(f));
      addTrack({
        uid, provider: 'local', providerTrackId: f.name,
        title: f.name.replace(/\.[^.]+$/, '').slice(0, 300),
        artist: 'My Music', artwork: '', duration: 0, url: '', addedAt: Date.now()
      });
      n++;
    }
    render();
    toast(n ? n + ' file' + (n === 1 ? '' : 's') + ' added for this session.' : 'No audio files found.', !n);
  }

  function toast(msg, isErr = false) {
    toastMsg = msg; toastErr = isErr;
    paintToast();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastMsg = ''; paintToast(); }, 4000);
  }

  /* =========================================================================
     Views
     ========================================================================= */

  function art(t, cls = '') {
    const a = t.artwork;
    return a
      ? `<img class="art ${cls}" src="${esc(a)}" alt="" loading="lazy">`
      : `<div class="art ${cls} art-ph">${esc((t.title || '?').slice(0, 1).toUpperCase())}</div>`;
  }

  const PROV_TAG = {
    audius: '<span class="tag tag-audius">AUDIUS</span>',
    jamendo: '<span class="tag tag-jamendo">JAMENDO</span>',
    youtube: '<span class="tag tag-yt">YT</span>',
    local: '<span class="tag tag-local">FILE</span>'
  };
  function badge(t, showSource) {
    if (showSource) return PROV_TAG[t.provider] || '';
    if (t.provider === 'youtube') return '<span class="tag tag-yt">YT</span>';
    if (t.provider === 'local') return '<span class="tag tag-local">FILE</span>';
    return '';
  }

  function plays(n) {
    if (!n) return '';
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M plays';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K plays';
    return n + ' plays';
  }

  function debugLine(t) {
    const d = t._dbg;
    if (!d) return '';
    return `<div class="dbg">#${d.total} = text ${d.text} (${esc(d.why)}) + eng ${d.engPts} (p${d.engPct})`
      + `${d.penalty ? ' ' + d.penalty + ' low-engagement' : ''}`
      + ` · ${d.plays}p/${d.favs}f/${d.reposts}r`
      + `${d.dupOf ? ' · deduped ' + esc(d.dupOf.join(',')) : ''}</div>`;
  }

  function row(uid, opts = {}) {
    const t = track(uid) || opts.track;
    if (!t) return '';
    const on = now === t.uid;
    return `<div class="row${on ? ' row-on' : ''}" data-action="${opts.rowAction || 'play'}" data-uid="${esc(t.uid)}" data-ctx="${esc(opts.ctx || '')}">
      ${art(t)}
      <div class="row-txt">
        <div class="row-title">${esc(t.title)}</div>
        <div class="row-sub">${badge(t, opts.showSource)}${esc(t.artist || providers[t.provider].label)}${t.duration ? ' · ' + fmt(t.duration) : ''}${opts.showSource && t.playCount ? ' · ' + plays(t.playCount) : ''}</div>
        ${opts.debug ? debugLine(t) : ''}
      </div>
      <button class="row-btn" data-action="menu" data-uid="${esc(t.uid)}" aria-label="More">&#8942;</button>
    </div>`;
  }

  function sectionedFavorites() {
    const items = state.favorites.map(track).filter(Boolean);
    if (!items.length) return `<div class="empty">No favorites yet.<br><span>Search for music and tap ♥ to save it here.</span></div>`;
    const groups = {};
    for (const t of items) {
      let k = (t.title || '#').trim().charAt(0).toUpperCase();
      if (!/[A-Z]/.test(k)) k = '#';
      (groups[k] = groups[k] || []).push(t);
    }
    const keys = Object.keys(groups).sort();
    return keys.map(k => `<div class="sec-head" id="sec-${esc(k)}">${esc(k)}</div>` +
      groups[k].map(t => row(t.uid, { ctx: 'favorites' })).join('')).join('') +
      (keys.length > 3 ? `<div class="az-rail">${keys.map(k => `<button data-action="jump" data-k="${esc(k)}">${esc(k)}</button>`).join('')}</div>` : '');
  }

  function viewFavorites() {
    const n = state.favorites.length;
    return `<div class="head">
        <h1>My Favorites</h1>
        <div class="head-sub">${n} ${n === 1 ? 'song' : 'songs'}</div>
      </div>
      ${n ? `<button class="shuffle-btn" data-action="shuffle-favs">&#128256; Shuffle Play</button>` : ''}
      <div class="list">${sectionedFavorites()}</div>`;
  }

  function viewPlaylists() {
    if (view && view.kind === 'playlist') {
      const p = state.playlists.find(x => x.id === view.id);
      if (!p) { view = null; return viewPlaylists(); }
      return `<div class="head">
          <button class="back" data-action="back">&#8592;</button>
          <h1>${esc(p.name)}</h1>
          <div class="head-sub">${p.trackUids.length} ${p.trackUids.length === 1 ? 'song' : 'songs'}</div>
        </div>
        ${p.trackUids.length ? `<button class="shuffle-btn" data-action="shuffle-playlist" data-id="${esc(p.id)}">&#128256; Shuffle Play</button>` : ''}
        <div class="list">${p.trackUids.length ? p.trackUids.map(u => row(u, { ctx: 'playlist:' + p.id })).join('') : '<div class="empty">Empty playlist.<br><span>Use the ⋮ menu on any song to add it here.</span></div>'}</div>
        <button class="danger-btn" data-action="delete-playlist" data-id="${esc(p.id)}">Delete playlist</button>`;
    }

    const recentAdded = Object.values(state.tracks).sort((a, b) => b.addedAt - a.addedAt).slice(0, 12);
    const recentPlayed = state.history.map(track).filter(Boolean).slice(0, 12);
    const mosaic = list => `<div class="mosaic">${list.slice(0, 4).map(t => t.artwork ? `<img src="${esc(t.artwork)}" alt="" loading="lazy">` : '<div class="m-ph"></div>').join('') || '<div class="m-ph"></div>'}</div>`;

    return `<div class="head"><h1>Playlists</h1></div>
      <div class="shelf">
        <div class="shelf-head"><h2>Recently Added</h2><span>${recentAdded.length}</span></div>
        ${recentAdded.length ? `<div class="hscroll">${recentAdded.map(t => `<button class="card-sm" data-action="play" data-uid="${esc(t.uid)}" data-ctx="recent-added">${art(t, 'art-lg')}<span>${esc(t.title)}</span><em>${esc(t.artist)}</em></button>`).join('')}</div>` : '<div class="empty sm">Nothing yet.</div>'}
      </div>
      <div class="shelf">
        <div class="shelf-head"><h2>Recently Played</h2><span>${recentPlayed.length}</span></div>
        ${recentPlayed.length ? `<div class="hscroll">${recentPlayed.map(t => `<button class="card-sm" data-action="play" data-uid="${esc(t.uid)}" data-ctx="history">${art(t, 'art-lg')}<span>${esc(t.title)}</span><em>${esc(t.artist)}</em></button>`).join('')}</div>` : '<div class="empty sm">Nothing played yet.</div>'}
      </div>
      <div class="shelf">
        <div class="shelf-head"><h2>My Playlists</h2><button class="mini-btn" data-action="new-playlist">+ New</button></div>
        ${state.playlists.length ? `<div class="pl-grid">${state.playlists.map(p => {
          const ts = p.trackUids.map(track).filter(Boolean);
          return `<button class="pl-card" data-action="open-playlist" data-id="${esc(p.id)}">${mosaic(ts)}<span>${esc(p.name)}</span><em>${p.trackUids.length} ${p.trackUids.length === 1 ? 'song' : 'songs'}</em></button>`;
        }).join('')}</div>` : '<div class="empty sm">No playlists yet. Tap + New.</div>'}
      </div>`;
  }

  function viewSearch() {
    const res = search.results;
    const dbg = searchDebugOn();
    return `<div class="head"><h1>Search</h1></div>
      <div class="search-wrap">
        <input id="q" class="search-input" type="search" placeholder="Songs, artists, or a YouTube link"
          value="${esc(search.q)}" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
        <button class="mini-btn" data-action="trending">Trending</button>
      </div>
      ${search.loading ? '<div class="empty sm">Searching…</div>' : ''}
      ${search.error ? `<div class="empty sm err">${esc(search.error)}</div>` : ''}
      ${!search.loading && !search.error && search.ran && !res.length ? '<div class="empty sm">No results.</div>' : ''}
      ${search.artists.length ? `<div class="shelf"><div class="shelf-head"><h2>Artists</h2></div>
        <div class="hscroll">${search.artists.map(a => `<button class="card-sm round" data-action="artist" data-id="${esc(a.id)}">${a.artwork ? `<img class="art art-lg" src="${esc(a.artwork)}" alt="" loading="lazy">` : '<div class="art art-lg art-ph">' + esc(a.name.slice(0, 1)) + '</div>'}<span>${esc(a.name)}</span><em>${a.trackCount} tracks</em></button>`).join('')}</div></div>` : ''}
      ${search.notes.length ? `<div class="notes">${search.notes.map(n => esc(n)).join('<br>')}</div>` : ''}
      ${dbg && search.raw ? `<div class="dbg dbg-top">raw: audius ${search.raw.audius} · jamendo ${search.raw.jamendo} → ${res.length} after ranking + dedupe</div>` : ''}
      <div class="list">${res.map(t => {
        addTrackShadow(t);
        return row(t.uid, { track: t, ctx: 'search', showSource: true, debug: dbg });
      }).join('')}</div>`;
  }

  // Search results must be renderable/queueable before they're "in" the library.
  const shadow = new Map();
  function addTrackShadow(t) { if (!state.tracks[t.uid]) shadow.set(t.uid, t); }
  function resolve(uid) { return state.tracks[uid] || shadow.get(uid) || null; }

  function viewMore() {
    return `<div class="head"><h1>More</h1></div>
      <div class="panel">
        <h3>Library backup</h3>
        <p>Your library lives in this browser only. Export before switching devices or clearing Safari data.</p>
        <div class="two">
          <button data-action="export">&#8681; Export</button>
          <button data-action="import">&#8679; Import</button>
        </div>
        <input type="file" id="import-file" accept="application/json,.json" hidden>
      </div>
      <div class="panel">
        <h3>My Music</h3>
        <p>Add audio files from this device. They play with full background support, but are available for this session only — Tempo does not copy your files.</p>
        <button data-action="pick-local">+ Add audio files</button>
        <input type="file" id="local-file" accept="audio/*" multiple hidden>
      </div>
      <div class="panel">
        <h3>Jamendo</h3>
        <p>A second free catalogue. Needs your own free client ID &mdash; it is stored only in this browser, never in the app's public source.</p>
        <ol class="steps">
          <li>Open <b>devportal.jamendo.com</b> and sign up (free)</li>
          <li>Create an app, then copy its <b>Client ID</b></li>
          <li>Paste it below</li>
        </ol>
        <input id="jamendo-id" class="settings-input" type="text" placeholder="Jamendo client ID"
          value="${esc(providers.jamendo.clientId)}" autocapitalize="off" autocorrect="off" spellcheck="false">
        <div class="two">
          <button data-action="save-jamendo">Save</button>
          <button data-action="test-jamendo">Test</button>
        </div>
        <div id="jamendo-status" class="settings-status">${providers.jamendo.enabled ? 'Enabled.' : 'Not set up &mdash; searches use Audius only.'}</div>
      </div>
      <div class="panel">
        <h3>Search debug</h3>
        <p>Shows the ranking breakdown under every search result: text score, engagement percentile, penalties and dedupe.</p>
        <button data-action="toggle-debug">${searchDebugOn() ? 'Turn OFF search debug' : 'Turn ON search debug'}</button>
      </div>
      <div class="panel">
        <h3>Providers</h3>
        <div class="prov"><b>Audius</b><span class="ok">Background playback</span></div>
        <p class="tiny">Free, open music streaming. No account required.</p>
        <div class="prov"><b>Jamendo</b><span class="${providers.jamendo.enabled ? 'ok' : 'warn'}">${providers.jamendo.enabled ? 'Background playback' : 'Needs a client ID'}</span></div>
        <p class="tiny">Creative Commons catalogue. Free client ID required.</p>
        <div class="prov"><b>My Music</b><span class="ok">Background playback</span></div>
        <p class="tiny">Your own audio files, this session only.</p>
        <div class="prov"><b>YouTube</b><span class="warn">Foreground only</span></div>
        <p class="tiny">YouTube's player stops when you lock the phone or switch apps. Tempo does not work around this.</p>
      </div>
      <div class="panel">
        <h3>Install</h3>
        <p>On iPhone: tap Share &#8679; then <b>Add to Home Screen</b> to run Tempo full-screen.</p>
      </div>
      <div class="panel">
        <h3>About</h3>
        <p class="tiny">Tempo ${'0.5.5'} · ${Object.keys(state.tracks).length} tracks · ${state.playlists.length} playlists${state.migratedFrom ? ' · migrated from ' + state.migratedFrom : ''}</p>
      </div>`;
  }

  function body() {
    if (tab === 'favorites') return viewFavorites();
    if (tab === 'playlists') return viewPlaylists();
    if (tab === 'search') return viewSearch();
    return viewMore();
  }

  /* =========================================================================
     Player UI
     ========================================================================= */

  function miniMarkup() {
    const t = current();
    if (!t || nowPlaying) return '';
    return `<div class="mini" data-action="open-np">
      ${art(t, 'art-mini')}
      <div class="mini-txt"><div class="mini-title">${esc(t.title)}</div><div class="mini-sub">${esc(t.artist || providers[t.provider].label)}</div></div>
      <button class="mini-play" data-action="toggle" aria-label="Play/pause">${transportPlaying() ? '&#10073;&#10073;' : '&#9654;'}</button>
    </div>`;
  }

  function npMarkup() {
    const t = current();
    if (!t || !nowPlaying) return '';
    const yt = isYT(t);
    const blocked = ytError && ytError.uid === t.uid;
    const stage = yt
      ? (blocked
        ? `<div class="yt-blocked">${t.artwork ? `<img src="${esc(t.artwork)}" alt="">` : ''}<div><div class="fb-title">This video can't play inside Tempo</div><div class="fb-sub">Its owner has turned off embedded playback.</div><a class="fb-btn" href="${esc(t.url)}" target="_blank" rel="noreferrer">Open in YouTube</a></div></div>`
        : `<div class="yt-stage"><div id="yt-mount"></div></div>`)
      : `<div class="np-art">${t.artwork ? `<img src="${esc(t.artwork)}" alt="">` : `<div class="art-ph big">${esc((t.title || '?').slice(0, 1).toUpperCase())}</div>`}</div>`;

    const d = yt ? 0 : (progress.d || t.duration || 0);
    const pos = yt ? 0 : progress.t;
    const pct = d > 0 ? Math.min(100, (pos / d) * 100) : 0;

    return `<div class="np">
      <div class="np-top">
        <button class="np-close" data-action="close-np" aria-label="Close">&#8964;</button>
        <span>${esc(providers[t.provider].label)}${yt ? ' · foreground only' : ''}</span>
        <button class="np-close" data-action="menu" data-uid="${esc(t.uid)}" aria-label="More">&#8942;</button>
      </div>
      ${stage}
      <div class="np-meta"><div class="np-title">${esc(t.title)}</div><div class="np-artist">${esc(t.artist || providers[t.provider].label)}</div></div>
      ${yt ? '<div class="np-note">YouTube playback pauses when Tempo is backgrounded.</div>' : `
      <div class="seek" data-action="seek">
        <div class="seek-bar"><div class="seek-fill" style="width:${pct}%"></div><div class="seek-knob" style="left:${pct}%"></div></div>
        <div class="seek-times"><span class="t-el">${fmt(pos)}</span><span class="t-re">-${fmt(Math.max(0, d - pos))}</span></div>
      </div>`}
      <div class="np-controls">
        <button data-action="shuffle" class="${shuffle ? 'on' : ''}" aria-label="Shuffle">&#128256;</button>
        <button data-action="prev" aria-label="Previous">&#9198;</button>
        <button class="np-play" data-action="toggle" aria-label="Play/pause">${transportPlaying() ? '&#10073;&#10073;' : '&#9654;'}</button>
        <button data-action="next" aria-label="Next">&#9197;</button>
        <button data-action="repeat" class="${repeat !== 'off' ? 'on' : ''}" aria-label="Repeat">${repeat === 'one' ? '&#128265;' : '&#128257;'}</button>
      </div>
      <div class="np-actions">
        <button data-action="fav" data-uid="${esc(t.uid)}" class="${isFav(t.uid) ? 'on' : ''}">${isFav(t.uid) ? '&hearts;' : '&#9825;'} Favorite</button>
        <button data-action="queue" data-uid="${esc(t.uid)}">&#9783; Queue</button>
        <button data-action="add-pl" data-uid="${esc(t.uid)}">&#43; Playlist</button>
      </div>
      ${state.queue.length ? `<div class="np-queue"><h4>Up next</h4>${state.queue.slice(0, 20).map(u => {
        const q = track(u); if (!q) return '';
        return `<div class="qrow"><span data-action="play" data-uid="${esc(u)}">${esc(q.title)}</span><button data-action="dequeue" data-uid="${esc(u)}" aria-label="Remove">&times;</button></div>`;
      }).join('')}</div>` : ''}
    </div>`;
  }

  /* =========================================================================
     Rendering
     ========================================================================= */

  function navBtn(id, icon, label) {
    return `<button data-tab="${id}" class="${tab === id ? 'on' : ''}"><span>${icon}</span>${label}</button>`;
  }

  function installHint() {
    const ua = navigator.userAgent;
    const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const safari = !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome/.test(ua);
    const standalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    let dismissed = false;
    try { dismissed = localStorage.getItem(HINT_KEY) === '1'; } catch {}
    if (!(iOS && safari && !standalone && !dismissed)) return '';
    return `<div class="hint"><span><b>Install Tempo:</b> Share &#8679; → Add to Home Screen</span><button data-action="dismiss-hint">&times;</button></div>`;
  }

  function render() {
    const scroller = document.querySelector('.content');
    const y = scroller ? scroller.scrollTop : 0;

    document.querySelector('#app').innerHTML = `
      ${installHint()}
      <main class="content">${body()}</main>
      <div class="dock">
        ${miniMarkup()}
        <nav class="nav">
          ${navBtn('favorites', '&hearts;', 'Favorites')}
          ${navBtn('playlists', '&#9776;', 'Playlists')}
          ${navBtn('search', '&#9906;', 'Search')}
          ${navBtn('more', '&#8943;', 'More')}
        </nav>
      </div>`;

    const s2 = document.querySelector('.content');
    if (s2 && keepScroll) s2.scrollTop = y;
    keepScroll = true;

    renderNP();
    paintToast();
  }

  let keepScroll = true;

  function renderNP() {
    const root = document.querySelector('#np-root');
    const t = current();
    const want = !!(t && nowPlaying);
    const yt = isYT(t);
    const blocked = !!(ytError && t && ytError.uid === t.uid);
    const stageKey = !want ? 'none' : (yt ? (blocked ? 'yt-blocked' : 'yt:' + t.uid) : 'audio');

    if (!want) { root.innerHTML = ''; root.dataset.stage = 'none'; if (!yt) ytDestroy(); return; }

    // Re-use the DOM when only text/transport changed, so the YouTube iframe
    // and the audio element are never disturbed.
    if (root.dataset.stage === stageKey && root.dataset.uid === t.uid) {
      paintTransport(); paintProgress(); return;
    }
    if (root.dataset.stage !== stageKey) ytDestroy();
    root.innerHTML = npMarkup();
    root.dataset.stage = stageKey;
    root.dataset.uid = t.uid;
    if (yt && !blocked) ytMount(t);
  }

  function paintTransport() {
    const playing = transportPlaying();
    const glyph = playing ? '▉▉' : '▶';
    document.querySelectorAll('.mini-play, .np-play').forEach(b => { b.textContent = glyph; });
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch {}
    }
  }

  function paintProgress() {
    const t = current();
    if (!t || isYT(t) || !nowPlaying) return;
    const d = progress.d || t.duration || 0, pos = progress.t;
    const pct = d > 0 ? Math.min(100, (pos / d) * 100) : 0;
    const fill = document.querySelector('.seek-fill'), knob = document.querySelector('.seek-knob');
    const el = document.querySelector('.t-el'), re = document.querySelector('.t-re');
    if (fill) fill.style.width = pct + '%';
    if (knob) knob.style.left = pct + '%';
    if (el) el.textContent = fmt(pos);
    if (re) re.textContent = '-' + fmt(Math.max(0, d - pos));
  }

  function paintToast() {
    let el = document.querySelector('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = toastMsg;
    el.className = toastMsg ? ('show' + (toastErr ? ' err' : '')) : '';
  }

  /* =========================================================================
     Events — delegated once
     ========================================================================= */

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-tab],[data-action]');
    if (!el) return;

    if (el.dataset.tab) { tab = el.dataset.tab; view = null; keepScroll = false; render(); return; }

    const uid = el.dataset.uid;
    const a = el.dataset.action;

    switch (a) {
      case 'play': {
        const t = resolve(uid);
        if (!t) return;
        if (!state.tracks[uid]) addTrack(t);
        playFrom(listForCtx(el.dataset.ctx || ''), uid);
        break;
      }
      case 'toggle': {
        const t = current(); if (!t) return;
        if (isYT(t)) { try { ytPlaying() ? ytPlayer.pauseVideo() : ytPlayer.playVideo(); } catch {} setTimeout(paintTransport, 250); }
        else engine.toggle();
        break;
      }
      case 'next': advance(1); break;
      case 'prev': advance(-1); break;
      case 'shuffle': shuffle = !shuffle; renderNP(); toast(shuffle ? 'Shuffle on' : 'Shuffle off'); break;
      case 'repeat': repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'; renderNP(); toast('Repeat: ' + repeat); break;
      case 'fav': toggleFav(uid); break;
      case 'queue': { const t = resolve(uid); if (t && !state.tracks[uid]) addTrack(t); enqueue(uid); break; }
      case 'dequeue': dequeue(uid); break;
      case 'open-np': nowPlaying = true; render(); break;
      case 'close-np': nowPlaying = false; render(); break;
      case 'shuffle-favs': shufflePlay(state.favorites); break;
      case 'shuffle-playlist': { const p = state.playlists.find(x => x.id === el.dataset.id); if (p) shufflePlay(p.trackUids); break; }
      case 'open-playlist': view = { kind: 'playlist', id: el.dataset.id }; keepScroll = false; render(); break;
      case 'back': view = null; keepScroll = false; render(); break;
      case 'new-playlist': {
        const name = prompt('Playlist name:');
        if (name && name.trim()) createPlaylist(name.trim());
        break;
      }
      case 'delete-playlist': {
        const p = state.playlists.find(x => x.id === el.dataset.id);
        if (p && confirm('Delete playlist "' + p.name + '"? Songs stay in your library.')) {
          state.playlists = state.playlists.filter(x => x.id !== p.id);
          view = null; save(); render();
        }
        break;
      }
      case 'add-pl': openPlaylistPicker(uid); break;
      case 'pick-pl': addToPlaylist(el.dataset.id, el.dataset.uid); closeSheet(); break;
      case 'menu': openMenu(uid); break;
      case 'close-sheet': closeSheet(); break;
      case 'remove': removeTrack(uid); closeSheet(); toast('Removed from library.'); break;
      case 'trending': loadTrending(); break;
      case 'artist': loadArtist(el.dataset.id); break;
      case 'jump': {
        const s = document.querySelector('#sec-' + CSS.escape(el.dataset.k));
        if (s) s.scrollIntoView({ block: 'start' });
        break;
      }
      case 'export': exportLibrary(); break;
      case 'import': document.querySelector('#import-file')?.click(); break;
      case 'pick-local': document.querySelector('#local-file')?.click(); break;
      case 'dismiss-hint': try { localStorage.setItem(HINT_KEY, '1'); } catch {} render(); break;
      case 'save-jamendo': {
        const v = (document.querySelector('#jamendo-id')?.value || '').trim();
        try { v ? localStorage.setItem(JAMENDO_KEY, v) : localStorage.removeItem(JAMENDO_KEY); } catch {}
        render();
        toast(v ? 'Jamendo enabled.' : 'Jamendo client ID cleared.');
        break;
      }
      case 'test-jamendo': testJamendo(); break;
      case 'toggle-debug': {
        const on = searchDebugOn();
        try { on ? localStorage.removeItem(DEBUG_KEY) : localStorage.setItem(DEBUG_KEY, '1'); } catch {}
        render();
        toast('Search debug ' + (on ? 'off' : 'on'));
        break;
      }
      case 'seek': {
        const t = current(); if (!t || isYT(t)) return;
        const bar = el.querySelector('.seek-bar') || el;
        const r = bar.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
        const d = progress.d || t.duration || 0;
        if (d > 0) engine.seek(ratio * d);
        break;
      }
    }
  });

  function listForCtx(ctx) {
    if (ctx === 'favorites') return state.favorites.slice();
    if (ctx === 'history') return state.history.slice();
    if (ctx === 'search') return search.results.map(t => t.uid);
    if (ctx === 'recent-added') return Object.values(state.tracks).sort((a, b) => b.addedAt - a.addedAt).map(t => t.uid);
    if (ctx.startsWith('playlist:')) {
      const p = state.playlists.find(x => x.id === ctx.slice(9));
      return p ? p.trackUids.slice() : [];
    }
    return state.favorites.slice();
  }

  document.addEventListener('change', e => {
    if (e.target.id === 'import-file') {
      const f = e.target.files && e.target.files[0];
      if (f) importLibrary(f);
      e.target.value = '';
    }
    if (e.target.id === 'local-file') {
      if (e.target.files && e.target.files.length) addLocalFiles([...e.target.files]);
      e.target.value = '';
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'q') {
      e.preventDefault();
      const v = e.target.value.trim();
      if (v) runSearch(v);
    }
  });

  /* ---- bottom sheet (menu / playlist picker) ---- */

  function sheet(html) {
    let s = document.querySelector('#sheet');
    if (!s) { s = document.createElement('div'); s.id = 'sheet'; document.body.appendChild(s); }
    s.innerHTML = `<div class="sheet-bg" data-action="close-sheet"></div><div class="sheet-body">${html}</div>`;
    s.classList.add('open');
  }
  function closeSheet() { const s = document.querySelector('#sheet'); if (s) { s.classList.remove('open'); s.innerHTML = ''; } }

  function openMenu(uid) {
    const t = resolve(uid); if (!t) return;
    const inLib = !!state.tracks[uid];
    sheet(`<div class="sheet-head">${art(t)}<div><b>${esc(t.title)}</b><em>${esc(t.artist)}</em></div></div>
      <button data-action="fav" data-uid="${esc(uid)}">${isFav(uid) ? '♥ Remove favorite' : '♡ Add to favorites'}</button>
      <button data-action="queue" data-uid="${esc(uid)}">☷ Add to queue</button>
      <button data-action="add-pl" data-uid="${esc(uid)}">+ Add to playlist</button>
      ${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noreferrer">↗ Open on ${esc(providers[t.provider].label)}</a>` : ''}
      ${inLib ? `<button class="danger" data-action="remove" data-uid="${esc(uid)}">Remove from library</button>` : ''}
      <button data-action="close-sheet">Cancel</button>`);
  }

  function openPlaylistPicker(uid) {
    const t = resolve(uid); if (!t) return;
    if (!state.tracks[uid]) addTrack(t);
    if (!state.playlists.length) {
      const name = prompt('Name your first playlist:');
      if (!name || !name.trim()) return;
      const p = createPlaylist(name.trim());
      addToPlaylist(p.id, uid);
      return;
    }
    sheet(`<div class="sheet-title">Add to playlist</div>
      ${state.playlists.map(p => `<button data-action="pick-pl" data-id="${esc(p.id)}" data-uid="${esc(uid)}">${esc(p.name)} <em>${p.trackUids.length}</em></button>`).join('')}
      <button data-action="close-sheet">Cancel</button>`);
  }

  async function testJamendo() {
    const el = document.querySelector('#jamendo-status');
    const v = (document.querySelector('#jamendo-id')?.value || '').trim();
    if (!v) { if (el) el.textContent = 'Enter a client ID first.'; return; }
    try { localStorage.setItem(JAMENDO_KEY, v); } catch {}
    if (el) el.textContent = 'Testing…';
    try {
      const n = (await providers.jamendo.search('piano')).length;
      if (el) el.textContent = n ? `Working — ${n} results for "piano".` : 'Connected, but no results came back.';
    } catch (e) {
      if (el) el.textContent = 'Failed: ' + e.message;
    }
  }

  async function loadArtist(id) {
    search.loading = true; render();
    try {
      search.results = await providers.audius.artistTracks(id);
      search.artists = [];
      search.ran = true;
    } catch (e) { search.error = e.message; }
    search.loading = false;
    render();
  }

  /* =========================================================================
     Boot
     ========================================================================= */

  window.__tempo = {
    get state() { return state; },
    get now() { return now; },
    get audio() { return audio; },
    get engine() { return engine; },
    get providers() { return providers; },
    get search() { return search; },
    get ytPlayer() { return ytPlayer; },
    get ytError() { return ytError; },
    get shuffle() { return shuffle; },
    get repeat() { return repeat; },
    set repeat(v) { repeat = v; },
    setShuffle(v) { shuffle = v; },
    runSearch, loadTrending, playTrack, advance, addTrack, toggleFav, enqueue,
    createPlaylist, addToPlaylist, exportLibrary, sanitizeImport, extractVideoId,
    simulateEnded: () => advance(1, true),
    simulateYtError: code => {
      const c = current(); if (!c) return;
      ytError = { uid: c.uid, code }; c.blocked = true; save(); render();
    },
    setContext: l => { playContext = l; },
    fromAudius, playableAudius,
    render
  };

  save();
  render();
})();
