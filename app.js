(() => {
  const STORAGE_KEY = 'tempo-state-v1';
  const empty = { library: [], favorites: [], history: [], queue: [] };
  const YT_HOSTS = ['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be','www.youtu.be','youtube-nocookie.com','www.youtube-nocookie.com'];
  const ID_RE = /^[A-Za-z0-9_-]{11}$/;
  // Embedding refused by the owner (101/150), video missing/private (100), bad request (2),
  // HTML5 playback failure (5). All of them mean "we cannot play this inside Tempo".
  const FATAL_CODES = [2, 5, 100, 101, 150];

  let state = load();
  let tab = 'home';
  let now = null;
  let mountedId = null;     // video currently mounted in the player sheet
  let mountedStage = null;  // 'yt' | 'iframe' | 'fallback' currently in the DOM
  let ytPlayer = null;      // official YT.Player instance
  let ytApi = null;         // promise for the IFrame Player API
  let playbackError = null; // { id, code } when the current track refused to embed
  let apiBroken = false;    // IFrame API could not load; fall back to a plain embed

  function load() {
    let saved;
    try { saved = { ...empty, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }; }
    catch { saved = { ...empty }; }
    // Tracks saved by V0.1 have no url/artist field. Backfill the cheap ones here
    // so every track has the full shape; titles are fetched by backfillMeta().
    saved.library = (saved.library || []).map(t => ({
      artist: '',
      ...t,
      url: t.url || watchUrl(t.id),
      thumb: t.thumb || thumbUrl(t.id)
    }));
    return saved;
  }

  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function esc(v='') { return String(v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m])); }

  function watchUrl(id) { return 'https://www.youtube.com/watch?v=' + id; }
  function thumbUrl(id) { return 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'; }

  function extractVideoId(input='') {
    const value = input.trim();
    if (!value) return null;
    if (ID_RE.test(value)) return value;
    let url;
    try { url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`); }
    catch { return null; }
    const host = url.hostname.toLowerCase();
    if (!YT_HOSTS.includes(host)) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    let candidate = null;
    if (host.includes('youtu.be')) candidate = parts[0] || null;
    else if (['shorts','embed','live','v'].includes(parts[0])) candidate = parts[1] || null;
    else candidate = url.searchParams.get('v');
    return candidate && ID_RE.test(candidate) ? candidate : null;
  }

  function getTrack(id) { return state.library.find(t => t.id === id); }
  function byIds(ids) { return ids.map(getTrack).filter(Boolean); }
  function isFav(id) { return state.favorites.includes(id); }

  /* ---------- metadata: YouTube's public oEmbed endpoint (no API key) ---------- */

  async function fetchMeta(id) {
    const endpoint = 'https://www.youtube.com/oembed?url=' +
      encodeURIComponent(watchUrl(id)) + '&format=json';
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error('oembed ' + res.status);
    const data = await res.json();
    return {
      title: data.title || '',
      artist: data.author_name || '',
      thumb: data.thumbnail_url || thumbUrl(id)
    };
  }

  // Fills in title/artist for a track in place. `now` holds the same object
  // reference, so the open player picks the update up for free.
  async function hydrate(id, { rerender = true } = {}) {
    const track = getTrack(id);
    if (!track || track.meta === 'manual') return;
    try {
      const meta = await fetchMeta(id);
      track.title = meta.title || track.title;
      track.artist = meta.artist || '';
      track.thumb = meta.thumb || track.thumb;
      track.meta = 'ok';
    } catch {
      track.meta = 'failed';
      if (!track.title || track.title === 'Loading…') track.title = 'YouTube • ' + id;
    }
    save();
    if (rerender) render();
  }

  // Backfill tracks saved before V0.2 (they have no artist). Sequential and
  // capped so a large library never floods the network on startup.
  async function backfillMeta() {
    const stale = state.library
      .filter(t => !t.artist && t.meta !== 'manual' && t.meta !== 'failed')
      .slice(0, 30);
    for (const t of stale) {
      await hydrate(t.id, { rerender: false });
      await new Promise(r => setTimeout(r, 120));
    }
    if (stale.length) render();
  }

  /* ---------- official IFrame Player API ---------- */

  function loadYouTubeApi() {
    if (ytApi) return ytApi;
    ytApi = new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) return resolve(window.YT);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (typeof prev === 'function') prev(); resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => reject(new Error('iframe_api failed to load'));
      document.head.appendChild(s);
      setTimeout(() => reject(new Error('iframe_api timeout')), 15000);
    }).catch(err => { apiBroken = true; throw err; });
    return ytApi;
  }

  function onPlayerError(e) {
    if (!now) return;
    if (!FATAL_CODES.includes(e.data)) return;
    playbackError = { id: now.id, code: e.data };
    const track = getTrack(now.id);
    if (track) { track.blocked = true; save(); }
    render();
  }

  function onPlayerStateChange(e) {
    if (e.data === 1) { // PLAYING
      // Reaching PLAYING proves the embed is fine; clear any stale block flag.
      const track = now && getTrack(now.id);
      if (track && track.blocked) { delete track.blocked; save(); render(); }
    }
    if (e.data === 0) playNextFromQueue(); // ENDED
  }

  // The queue is "up next" only — whatever is playing has already been consumed
  // from it by play(), so the head of the queue is always the next track.
  function nextQueuedId() {
    return state.queue.find(getTrack) || null;
  }

  function playNextFromQueue() {
    const nextId = nextQueuedId();
    if (nextId) play(nextId);
  }

  async function mountPlayer(id) {
    const host = document.querySelector('#yt-mount');
    if (!host) return;
    try {
      const YTapi = await loadYouTubeApi();
      if (!now || now.id !== id) return; // user moved on while the API loaded
      if (ytPlayer && ytPlayer.loadVideoById) { ytPlayer.loadVideoById(id); return; }
      ytPlayer = new YTapi.Player(host, {
        videoId: id,
        playerVars: { playsinline: 1, rel: 0, origin: location.origin },
        events: { onStateChange: onPlayerStateChange, onError: onPlayerError }
      });
    } catch {
      renderPlayer(); // API unavailable -> plain embed path
    }
  }

  function destroyPlayer() {
    if (ytPlayer && ytPlayer.destroy) { try { ytPlayer.destroy(); } catch {} }
    ytPlayer = null;
  }

  /* ---------- actions ---------- */

  function play(id) {
    const track = getTrack(id);
    if (!track) return;
    now = track;
    playbackError = null;
    state.queue = state.queue.filter(x => x !== id); // it's playing now, not up next
    state.history = [id, ...state.history.filter(x => x !== id)].slice(0, 50);
    save(); render();
  }

  function toggleFav(id) {
    state.favorites = isFav(id) ? state.favorites.filter(x => x !== id) : [id, ...state.favorites];
    save(); render();
  }

  function queue(id) {
    state.queue = [...state.queue.filter(x => x !== id), id];
    save(); render();
  }

  function unqueue(id) {
    state.queue = state.queue.filter(x => x !== id);
    save(); render();
  }

  function removeTrack(id) {
    state.library = state.library.filter(t => t.id !== id);
    state.favorites = state.favorites.filter(x => x !== id);
    state.queue = state.queue.filter(x => x !== id);
    state.history = state.history.filter(x => x !== id);
    if (now?.id === id) { now = null; destroyPlayer(); }
    save(); render();
  }

  function addTrack() {
    const input = document.querySelector('#youtube-url');
    const titleInput = document.querySelector('#custom-title');
    const error = document.querySelector('#add-error');
    if (!input) return;
    const id = extractVideoId(input.value);
    if (!id) {
      if (error) error.textContent = 'Paste a valid YouTube link or 11-character video ID.';
      return;
    }
    const custom = titleInput.value.trim();
    const track = {
      id,
      title: custom || 'Loading…',
      artist: '',
      source: 'YouTube',
      thumb: thumbUrl(id),
      url: watchUrl(id),
      addedAt: Date.now(),
      meta: custom ? 'manual' : 'pending'
    };
    state.library = [track, ...state.library.filter(t => t.id !== id)];
    state.history = [id, ...state.history.filter(x => x !== id)].slice(0, 50);
    now = track;
    playbackError = null;
    save(); render();
    if (!custom) hydrate(id);
  }

  /* ---------- views ---------- */

  function subtitle(t) {
    return t.artist || (t.meta === 'pending' ? 'Fetching details…' : 'YouTube');
  }

  function section(title, icon, tracks, opts={}) {
    return `<section class="section">
      <div class="section-head"><h3><span>${icon}</span>${esc(title)}</h3><span>${tracks.length}</span></div>
      ${tracks.length ? `<div class="track-list">${tracks.map(t => trackCard(t, opts)).join('')}</div>` : `<div class="empty card">${esc(opts.empty || 'Nothing here yet.')}</div>`}
    </section>`;
  }

  function trackCard(t, opts={}) {
    return `<div class="track card">
      <button class="thumb" data-action="play" data-id="${esc(t.id)}" aria-label="Play ${esc(t.title)}">
        <img src="${esc(t.thumb)}" alt="" loading="lazy"><span class="play-badge">&#9654;</span>
      </button>
      <button class="track-copy" data-action="play" data-id="${esc(t.id)}">
        <strong>${esc(t.title)}</strong>
        <span>${t.blocked ? '<em class="blocked-tag">YouTube only</em> ' : ''}${esc(subtitle(t))}</span>
      </button>
      <div class="track-actions">
        <button data-action="fav" data-id="${esc(t.id)}" class="${isFav(t.id) ? 'active-icon':''}" aria-label="Favorite">${isFav(t.id) ? '&hearts;' : '&#9825;'}</button>
        ${opts.unqueue
          ? `<button data-action="unqueue" data-id="${esc(t.id)}" aria-label="Remove from queue">&#10005;</button>`
          : `<button data-action="queue" data-id="${esc(t.id)}" aria-label="Queue">&#9783;</button>`}
        ${opts.delete ? `<button data-action="delete" data-id="${esc(t.id)}" aria-label="Delete">&#9003;</button>` : ''}
      </div>
    </div>`;
  }

  function body() {
    if (tab === 'home') return `
      <section class="hero card">
        <div><span class="eyebrow">MUSI REPLACEMENT</span><h2>Your player. Your library.</h2><p>Paste a YouTube link and Tempo fills in the title and artist for you, then plays it through YouTube's official player.</p></div>
        <button class="primary" data-tab="add">&#65291; Add music</button>
      </section>
      ${section('Recently played','&#9727;',byIds(state.history).slice(0,6),{empty:'Nothing played yet.'})}
      ${section('Favorites','&hearts;',byIds(state.favorites).slice(0,6),{empty:'Favorite something and it will show here.'})}`;

    if (tab === 'add') return `<section class="card add-card">
      <div class="eyebrow">ADD FROM YOUTUBE</div><h2>Add a song or video</h2>
      <label for="youtube-url">YouTube URL</label>
      <input id="youtube-url" placeholder="https://youtu.be/..." autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="url">
      <label for="custom-title">Custom title <span>(optional &mdash; leave blank to fetch it automatically)</span></label>
      <input id="custom-title" placeholder="Artist &mdash; Song">
      <div id="add-error" class="error"></div>
      <button class="primary wide" id="add-track" data-action="add">&#65291; Add &amp; play</button>
      <p class="fineprint">Tempo looks up the title, artist and artwork from YouTube automatically. Only fill in a custom title if you want to override it.</p>
    </section>`;

    if (tab === 'library') return section('Library','&#9635;',state.library,{delete:true,empty:'Your library is empty. Add a YouTube link first.'});
    if (tab === 'favorites') return section('Favorites','&hearts;',byIds(state.favorites),{empty:'No favorites yet.'});
    if (tab === 'queue') return section('Up next','&#9783;',byIds(state.queue),{unqueue:true,empty:'Queue is empty. Songs you queue play automatically when the current one ends.'});
    return '';
  }

  // Shown instead of YouTube's own error screen when the owner blocks embedding.
  function fallbackMarkup() {
    return `<div class="embed-fallback">
      <img src="${esc(now.thumb)}" alt="" class="fb-art">
      <div class="fb-body">
        <div class="fb-icon">&#9888;</div>
        <div class="fb-title">This video can't play inside Tempo</div>
        <div class="fb-sub">Its owner has turned off embedded playback.</div>
        <a class="fb-btn" href="${esc(now.url || watchUrl(now.id))}" target="_blank" rel="noreferrer">Open in YouTube</a>
      </div>
    </div>`;
  }

  function playerShell() {
    const blocked = playbackError && playbackError.id === now.id;
    const stage = blocked
      ? fallbackMarkup()
      : (apiBroken
          ? `<iframe src="https://www.youtube.com/embed/${esc(now.id)}?playsinline=1&amp;rel=0" title="${esc(now.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
          : `<div id="yt-mount"></div>`);
    return `<div class="player-sheet">
      <button class="close" data-action="close" aria-label="Close player">&times;</button>
      <div class="video-wrap">${stage}</div>
      <div class="player-info">
        <div class="track-title">${esc(now.title)}</div>
        <div class="track-sub">${esc(now.artist || 'YouTube')}</div>
        <div class="player-actions">
          <button data-action="fav" data-id="${esc(now.id)}" class="${isFav(now.id)?'active-icon':''}">${isFav(now.id)?'&hearts;':'&#9825;'} Favorite</button>
          <button data-action="queue" data-id="${esc(now.id)}">&#9783; Queue</button>
          <a href="${esc(now.url || watchUrl(now.id))}" target="_blank" rel="noreferrer">&#8599; YouTube</a>
        </div>
        <div class="up-next">${upNextLabel()}</div>
      </div>
    </div>`;
  }

  function upNextLabel() {
    const t = getTrack(nextQueuedId());
    return t ? `Up next &middot; ${esc(t.title)}` : '';
  }

  function desiredStage() {
    if (playbackError && playbackError.id === now.id) return 'fallback';
    return apiBroken ? 'iframe' : 'yt';
  }

  function patchPlayerInfo(root) {
    const set = (sel, html) => { const el = root.querySelector(sel); if (el) el.innerHTML = html; };
    set('.track-title', esc(now.title));
    set('.track-sub', esc(now.artist || 'YouTube'));
    set('.up-next', upNextLabel());
    const fav = root.querySelector('.player-actions [data-action="fav"]');
    if (fav) {
      fav.innerHTML = `${isFav(now.id) ? '&hearts;' : '&#9825;'} Favorite`;
      fav.classList.toggle('active-icon', isFav(now.id));
    }
    const link = root.querySelector('.player-actions a');
    if (link) link.href = now.url || watchUrl(now.id);
  }

  // Keeps the live YT.Player alive across re-renders. The sheet is only rebuilt
  // when the stage type changes; a new track on the same stage is swapped in via
  // loadVideoById so playback hardware is never torn down.
  function renderPlayer() {
    const root = document.querySelector('#player-root');
    if (!now) { root.innerHTML = ''; mountedId = null; mountedStage = null; destroyPlayer(); return; }

    const stage = desiredStage();
    const sheetExists = !!root.querySelector('.player-sheet');
    const canPatch = sheetExists && stage === mountedStage && (stage === 'yt' || mountedId === now.id);

    if (canPatch) {
      patchPlayerInfo(root);
      if (stage === 'yt' && mountedId !== now.id) mountPlayer(now.id);
      mountedId = now.id;
      return;
    }

    destroyPlayer();
    root.innerHTML = playerShell();
    mountedStage = stage;
    mountedId = now.id;
    if (stage === 'yt') mountPlayer(now.id);
  }

  function render() {
    document.querySelector('#app').innerHTML = `<div class="app-shell">
      <header class="topbar"><div><div class="eyebrow">YOUR MUSIC</div><h1>Tempo</h1></div><div class="pill">V0.2</div></header>
      <main class="content">${body()}</main>
      <nav class="bottom-nav">
        ${nav('home','&#8962;','Home')}${nav('add','&#8981;','Add')}${nav('library','&#9635;','Library')}${nav('favorites','&hearts;','Liked')}${nav('queue','&#9783;','Queue')}
      </nav>
    </div>`;
    renderPlayer();
  }

  function nav(name, icon, label) {
    return `<button data-tab="${name}" class="${tab===name?'nav-active':''}"><span class="nav-icon">${icon}</span><span>${label}</span></button>`;
  }

  // Delegated once, so handlers can never go stale after an innerHTML swap.
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action],[data-tab]');
    if (!el) return;
    if (el.dataset.tab) { tab = el.dataset.tab; render(); return; }
    const id = el.dataset.id;
    switch (el.dataset.action) {
      case 'play': play(id); break;
      case 'fav': toggleFav(id); break;
      case 'queue': queue(id); break;
      case 'unqueue': unqueue(id); break;
      case 'delete': removeTrack(id); break;
      case 'add': addTrack(); break;
      case 'close': now = null; playbackError = null; renderPlayer(); break;
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'youtube-url' || e.target.id === 'custom-title') { e.preventDefault(); addTrack(); }
  });

  // Exposed for the automated QA pass only.
  window.__tempo = {
    extractVideoId, fetchMeta,
    get state() { return state; },
    get now() { return now; },
    get player() { return ytPlayer; },
    get playbackError() { return playbackError; },
    simulateError: code => onPlayerError({ data: code }),
    simulateEnded: () => onPlayerStateChange({ data: 0 })
  };

  render();
  backfillMeta();
})();
