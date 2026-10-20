(function () {
  'use strict';

  var AC = window.AC = {};
  var P = {
    home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
    library: '<path d="M5 4v16M10 4v16M15 4.5v15M20 6.5v11"/>',
    radio: '<circle cx="12" cy="12" r="2.4"/><path d="M7.9 7.9a5.8 5.8 0 0 0 0 8.2M16.1 16.1a5.8 5.8 0 0 0 0-8.2M5 5a9.9 9.9 0 0 0 0 14M19 19a9.9 9.9 0 0 0 0-14"/>',
    download: '<path d="M12 3v11m0 0 4.4-4.4M12 14l-4.4-4.4"/><path d="M4.5 16.5v3h15v-3"/>',
    play: '<path d="M8 5.2v13.6L19 12z"/>',
    pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1"/><rect x="13.9" y="5" width="3.6" height="14" rx="1"/>',
    prev: '<path d="M18.5 5.5v13L9 12z"/><rect x="5" y="5" width="2.4" height="14" rx="1"/>',
    next: '<path d="M5.5 5.5v13L15 12z"/><rect x="16.6" y="5" width="2.4" height="14" rx="1"/>',
    shuffle: '<path d="M3 7h3.2c4.6 0 6.9 10 11.6 10H21M3 17h3.2c1.8 0 3.2-1.5 4.5-3.2M13 7.6C14 6.1 15.3 5 17 5h4M18 3l3 2-3 2M18 15l3 2-3 2"/>',
    repeat: '<path d="M4 9a4 4 0 0 1 4-4h12M20 15a4 4 0 0 1-4 4H4"/><path d="M17 2l3 3-3 3M7 16l-3 3 3 3"/>',
    queue: '<path d="M4 6h11M4 12h11M4 18h7"/><path d="M17 15v5l4-2.5z"/>',
    volume: '<path d="M4 9.5v5h3.4L12 19V5L7.4 9.5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/>',
    mute: '<path d="M4 9.5v5h3.4L12 19V5L7.4 9.5z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    trash: '<path d="M4 7h16M9 7V4.8h6V7M7 7l1 13h8l1-13"/><path d="M10.5 11v5M13.5 11v5"/>',
    sparkles: '<path d="M12 3.5l1.6 4.4 4.4 1.6-4.4 1.6L12 15.5l-1.6-4.4L6 9.5l4.4-1.6z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    check: '<path d="m4.5 12.5 5 5 10-11"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 1 0-6.4-6.4L11.6 6"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 1 0 6.4 6.4l1.4-1.4"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
    device: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 21h8M12 16v5"/>',
    phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 5h4M11 18.5h2"/>',
    wave: '<path d="M4 10v4M8 6v12M12 8v8M16 4v16M20 9v6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>'
  };

  var state = AC.state = {
    view: 'home',
    tracks: [],
    stats: { tracks: 0, artists: 0, duration: 0, avgLufs: null, plays: 0 },
    current: null,
    playing: false,
    queue: [],
    qi: 0,
    shuffle: false,
    shuffleOrder: [],
    repeat: 'off',
    volume: 0.85,
    muted: false,
    radio: false,
    search: { q: '', results: [], loading: false, error: null, ran: false },
    jobs: {},
    panelId: null,
    panelRecs: null,
    panelRecLoading: false,
    discover: null,
    discoverLoading: false,
    sort: 'recent',
    filter: '',
    queueOpen: false,
    sleepMinutes: 0,
    playlists: [],
    playlistId: null,
    settings: null,
    modals: []
  };

  var SETTINGS_KEY = 'acervo:settings';
  AC.getSettings = function () {
    var defaults = { autoSave: false, offlineFallback: false, resume: true };
    try {
      var saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return Object.assign(defaults, saved && typeof saved === 'object' ? saved : {});
    } catch (e) { return defaults; }
  };
  AC.setSetting = function (key, value) {
    var settings = AC.getSettings();
    settings[key] = !!value;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
    state.settings = settings;
    if (key === 'offlineFallback' && window.AcervoAndroid && window.AcervoAndroid.setOfflineFallback) {
      try { window.AcervoAndroid.setOfflineFallback(!!value); } catch (e) {}
    }
    return settings;
  };
  AC.syncNativeSettings = function () {
    if (!window.AcervoAndroid || !window.AcervoAndroid.setOfflineFallback) return;
    try { window.AcervoAndroid.setOfflineFallback(!!AC.getSettings().offlineFallback); } catch (e) {}
  };

  function $(id) { return document.getElementById(id); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  AC.esc = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  AC.fmtTime = function (seconds) {
    var s = Math.max(0, Math.floor(Number(seconds) || 0));
    var m = Math.floor(s / 60);
    var r = s % 60;
    if (m >= 60) {
      var h = Math.floor(m / 60);
      return h + ':' + String(m % 60).padStart(2, '0') + ':' + String(r).padStart(2, '0');
    }
    return m + ':' + String(r).padStart(2, '0');
  };

  AC.fmtDur = function (seconds) {
    var s = Number(seconds) || 0;
    var h = Math.floor(s / 3600);
    var m = Math.round((s % 3600) / 60);
    if (h > 0) return h + 'h ' + m + 'min';
    return m + ' min';
  };

  AC.fmtNum = function (n) {
    var v = Number(n) || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(v >= 10000000 ? 0 : 1).replace('.', ',') + ' mi';
    if (v >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace('.', ',') + ' mil';
    return String(v);
  };

  AC.initials = function (text) {
    var words = String(text || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  };

  AC.hue = function (text) {
    var h = 0;
    var s = String(text || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  };

  AC.icon = function (name, size) {
    var filled = name === 'play' || name === 'pause' || name === 'prev' || name === 'next';
    var attrs = filled
      ? 'fill="currentColor" stroke="none"'
      : 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
    return '<svg viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) + '" aria-hidden="true" ' + attrs + '>' + (P[name] || '') + '</svg>';
  };

  AC.hydrateIcons = function (root) {
    all('[data-ico]', root || document).forEach(function (el) {
      var name = el.getAttribute('data-ico');
      if (!name || el.getAttribute('data-ico-done')) return;
      el.insertAdjacentHTML('afterbegin', AC.icon(name, Number(el.getAttribute('data-size')) || 20));
      el.setAttribute('data-ico-done', '1');
    });
  };

  AC.api = async function (path, options) {
    var opts = Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {});
    var res = await fetch(path, opts);
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      var error = new Error((data && data.error) || ('Erro ' + res.status));
      error.status = res.status;
      throw error;
    }
    return data;
  };

  AC.coverHtml = function (track, eager) {
    if (!track) return '<span class="cover-fallback" style="--hue:160;--hue2:200">?</span>';
    if (track.hasCover) {
      return '<img src="/api/cover/' + encodeURIComponent(track.id) + '" alt=""' + (eager ? '' : ' loading="lazy"') + ' onerror="this.style.display=&quot;none&quot;">';
    }
    if (track.thumbnail) {
      return '<img src="' + AC.esc(track.thumbnail) + '" alt="" referrerpolicy="no-referrer" onerror="this.style.display=&quot;none&quot;">';
    }
    var h = AC.hue(track.title);
    return '<span class="cover-fallback" style="--hue:' + h + ';--hue2:' + ((h + 45) % 360) + '">' + AC.esc(AC.initials(track.title)) + '</span>';
  };

  AC.toast = function (message, type) {
    var wrap = $('toast-wrap');
    if (!wrap) return;
    var el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' is-error' : '');
    el.innerHTML = AC.icon(type === 'error' ? 'close' : 'check', 16) + '<span>' + AC.esc(message) + '</span>';
    wrap.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .25s ease, transform .25s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(function () { el.remove(); }, 260);
    }, type === 'error' ? 5200 : 3200);
  };

  AC.updateStats = function () {
    var s = state.stats || {};
    var tracks = $('stat-tracks');
    if (tracks) tracks.textContent = s.tracks || 0;
    var artists = $('stat-artists');
    if (artists) artists.textContent = s.artists || 0;
    var hours = $('stat-hours');
    if (hours) hours.textContent = (Math.round(((s.duration || 0) / 3600) * 10) / 10).toString().replace('.', ',') + 'h';
    var lufs = $('stat-lufs');
    if (lufs) lufs.textContent = s.avgLufs == null ? '—' : (String(s.avgLufs).replace('.', ',') + '');
  };

  AC.loadLibrary = async function (opts) {
    var authEpoch = state.authEpoch;
    var data = await AC.api('/api/library');
    if (authEpoch !== state.authEpoch) return state.tracks;
    state.tracks = data.tracks || [];
    state.stats = data.stats || state.stats;
    AC.updateStats();
    if (typeof AC.renderSidebar === 'function') AC.renderSidebar();
    if (typeof AC.onLibraryLoaded === 'function') AC.onLibraryLoaded();
    if (!opts || !opts.silent) {
      if (typeof AC.render === 'function') AC.render();
    }
    return state.tracks;
  };

  function buildShuffle(seedId, avoidId) {
    var ids = state.tracks.map(function (t) { return t.id; });
    if (!ids.length) return [];
    var seed = seedId && ids.indexOf(seedId) >= 0 ? seedId : null;
    if (!seed) {
      do { seed = ids[Math.floor(Math.random() * ids.length)]; }
      while (avoidId && ids.length > 1 && seed === avoidId);
    }
    var rest = ids.filter(function (id) { return id !== seed; });
    for (var i = rest.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var swap = rest[i]; rest[i] = rest[j]; rest[j] = swap;
    }
    var artistOf = function (id) { var t = AC.trackById(id); return t ? (t.artist || '').toLowerCase() : ''; };
    var groups = {};
    rest.forEach(function (id) {
      var key = artistOf(id) || '?';
      (groups[key] = groups[key] || []).push(id);
    });
    var keys = Object.keys(groups);
    var previous = artistOf(seed) || '?';
    var ordered = [];
    while (ordered.length < rest.length) {
      var candidates = keys.filter(function (key) { return groups[key].length && key !== previous; });
      if (!candidates.length) candidates = keys.filter(function (key) { return groups[key].length; });
      candidates.sort(function (a, b) { return groups[b].length - groups[a].length; });
      var pick = candidates[0];
      ordered.push(groups[pick].shift());
      previous = pick;
    }
    return [seed].concat(ordered);
  }

  AC.setShuffle = function (enabled) {
    state.shuffle = !!enabled;
    var btn = $('btn-shuffle');
    if (btn) btn.classList.toggle('is-on', state.shuffle);
    if (state.shuffle) {
      state.shuffleOrder = buildShuffle(state.current ? state.current.id : null);
      state.queue = state.shuffleOrder.slice();
      state.qi = state.current ? state.queue.indexOf(state.current.id) : 0;
    } else {
      state.queue = state.tracks.map(function (t) { return t.id; });
      state.qi = state.current ? state.queue.indexOf(state.current.id) : 0;
    }
  };

  AC.trackById = function (id) {
    for (var i = 0; i < state.tracks.length; i++) {
      if (state.tracks[i].id === id) return state.tracks[i];
    }
    return null;
  };

  /* ---------- audio ---------- */
  var audio = $('audio');
  var player = $('player');

  function notifyAndroid() {
    var bridge = window.AcervoAndroid;
    if (!bridge || typeof bridge.nowPlaying !== 'function') return;
    try {
      if (state.current) bridge.nowPlaying(state.current.title || '', state.current.artist || '', !!state.playing, state.current.hasCover ? '/api/cover/' + encodeURIComponent(state.current.id) : '');
    } catch (e) {}
  }

  function setPlayIcon() {
    var btn = $('btn-play');
    if (!btn) return;
    btn.innerHTML = AC.icon(state.playing ? 'pause' : 'play', 16);
    btn.setAttribute('data-ico-done', '1');
    btn.setAttribute('aria-label', state.playing ? 'Pausar' : 'Tocar');
    var eq = $('player-eq');
    if (eq) eq.classList.toggle('is-live', state.playing);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused';
    }
    notifyAndroid();
  }

  function paintPlayer() {
    var t = state.current;
    player.classList.toggle('is-empty', !t);
    var cover = $('player-cover');
    if (cover) cover.innerHTML = t ? AC.coverHtml(t, true) : '<span class="player-cover-fallback"></span>';
    var title = $('player-title');
    if (title) title.textContent = t ? t.title : 'Nada tocando';
    var artist = $('player-artist');
    if (artist) {
      if (!t) artist.textContent = 'Escolha uma faixa do acervo';
      else artist.textContent = t.artist;
      artist.disabled = !t || !t.artist;
      if (t && t.artist) {
        if (typeof artist.setAttribute === 'function') artist.setAttribute('data-artist', t.artist);
      } else if (typeof artist.removeAttribute === 'function') {
        artist.removeAttribute('data-artist');
      }
    }
    setPlayIcon();
    var total = $('time-total');
    if (total) total.textContent = AC.fmtTime(t ? (t.duration || 0) : 0);
  }

  AC.play = function (id, opts) {
    var track = AC.trackById(id);
    if (!track) return;
    if (!(opts && opts.localOnly) && AC.syncCommand && AC.syncCommand('play', { trackId: id, queue: state.queue.indexOf(id) >= 0 ? state.queue.slice() : state.tracks.map(function (t) { return t.id; }) })) return;
    state.playAfterImport = null;
    var options = opts || {};
    if (!options.radio && !options.keepRadio) state.radio = false;
    if (options.radio) {
      state.radio = true;
      state.queue = [id];
      state.qi = 0;
    } else if (state.shuffle) {
      if (state.shuffleOrder.indexOf(id) === -1) state.shuffleOrder = buildShuffle(id);
      state.queue = state.shuffleOrder.slice();
      state.qi = state.queue.indexOf(id);
    } else if (state.queue.indexOf(id) === -1 || state.queue.length === 0) {
      state.queue = state.tracks.map(function (t) { return t.id; });
      state.qi = state.queue.indexOf(id);
    } else {
      state.qi = state.queue.indexOf(id);
    }
    if (state.current && state.current.id === id) {
      if (!state.playing) {
        audio.play().then(function () { state.playing = true; setPlayIcon(); AC.recordListen(track); }).catch(function () {});
      }
      return;
    }
    state.current = track;
    audio.src = '/api/stream/' + encodeURIComponent(id);
    audio.currentTime = 0;
    audio.play().then(function () {
      state.playing = true;
      setPlayIcon();
      AC.recordListen(track);
    }).catch(function () {
      state.playing = false;
      setPlayIcon();
      AC.toast('O navegador bloqueou a reprodução. Clique em play.', 'error');
      if (AC.onPlaybackBlocked) AC.onPlaybackBlocked();
      if (AC.notifyPlayback) AC.notifyPlayback(true);
    });
    paintPlayer();
    if (typeof AC.onTrackChange === 'function') AC.onTrackChange(track);
    if (AC.getSettings().autoSave && window.AcervoAndroid && window.AcervoAndroid.saveOffline && !track.autoSaved) {
      track.autoSaved = true;
      try { window.AcervoAndroid.saveOffline(track.id, track.title, track.artist, Math.round(track.duration || 0)); } catch (e) {}
    }
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album || 'Acervo',
        artwork: track.hasCover ? [{ src: '/api/cover/' + track.id, sizes: '512x512', type: 'image/jpeg' }] : []
      });
      try {
        navigator.mediaSession.setActionHandler('play', function () { if (audio.paused) AC.toggle(); });
        navigator.mediaSession.setActionHandler('pause', function () { if (!audio.paused) AC.toggle(); });
        navigator.mediaSession.setActionHandler('nexttrack', function () { AC.next(false); });
        navigator.mediaSession.setActionHandler('previoustrack', function () { AC.prev(); });
      } catch (err) {}
    }
  };

  AC.recordListen = function (track) {
    // Count only playback that actually started, including ordinary listening.
    if (!track || audio.dataset.listenedSource === audio.src) return;
    audio.dataset.listenedSource = audio.src;
    fetch('/api/track/' + encodeURIComponent(track.id) + '/play', { method: 'POST' })
      .then(function (res) { if (!res.ok) throw new Error('Histórico indisponível'); return res.json(); })
      .then(function () {
        track.lastPlayedAt = new Date().toISOString();
        track.plays = (track.plays || 0) + 1;
        if (typeof AC.onListen === 'function') AC.onListen(track);
      }).catch(function () { audio.dataset.listenedSource = ''; });
  };

  AC.restoreLast = function () {
    if (!AC.getSettings().resume) return false;
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('acervo:resume') || 'null'); } catch (e) {}
    if (!saved || !saved.id || !saved.at || Date.now() - saved.at > 7 * 86400000) return false;
    var track = AC.trackById(saved.id);
    if (!track) return false;
    state.current = track;
    state.queue = state.tracks.map(function (t) { return t.id; });
    state.qi = state.queue.indexOf(track.id);
    audio.src = '/api/stream/' + encodeURIComponent(track.id);
    var position = Math.max(0, Number(saved.position) || 0);
    if (position > 2) {
      audio.addEventListener('loadedmetadata', function () {
        try { audio.currentTime = Math.min(position, audio.duration || position); } catch (e) {}
        paintProgress();
      }, { once: true });
    }
    paintPlayer();
    return true;
  };

  AC.toggle = function () {
    if (AC.syncCommand && AC.syncCommand('toggle', {})) return;
    if (!state.current) {
      if (state.tracks.length) AC.play(state.tracks[0].id);
      return;
    }
    if (audio.paused) {
      audio.play().then(function () { state.playing = true; setPlayIcon(); AC.recordListen(state.current); }).catch(function () { if (AC.onPlaybackBlocked) AC.onPlaybackBlocked(); if (AC.notifyPlayback) AC.notifyPlayback(true); });
    } else {
      audio.pause();
      state.playing = false;
      setPlayIcon();
    }
  };

  AC.next = function (auto) {
    if (!auto && AC.syncCommand && AC.syncCommand('next', {})) return;
    if (!state.queue.length) return;
    if (state.repeat === 'one' && auto) {
      audio.currentTime = 0;
      audio.play().then(function () { AC.recordListen(state.current); }).catch(function () {});
      return;
    }
    var nextIndex = state.qi + 1;
    if (nextIndex >= state.queue.length) {
      if (state.radio && typeof AC.extendRadio === 'function') {
        AC.extendRadio().then(function (added) {
          if (added) {
            AC.play(state.queue[state.qi + 1], { keepRadio: true });
          } else if (state.repeat === 'all') {
            AC.play(state.queue[0], { keepRadio: true });
          } else {
            state.playing = false;
            setPlayIcon();
          }
        });
        return;
      }
      if (state.shuffle) {
        if (state.repeat === 'all') {
          state.shuffleOrder = buildShuffle(null, state.current ? state.current.id : null);
          state.queue = state.shuffleOrder.slice();
          state.qi = 0;
          AC.play(state.queue[0], { keepRadio: true });
        } else {
          state.playing = false;
          audio.pause();
          setPlayIcon();
        }
        return;
      }
      if (state.repeat === 'all') nextIndex = 0;
      else { state.playing = false; audio.pause(); setPlayIcon(); return; }
    }
    AC.play(state.queue[nextIndex], { keepRadio: true });
  };

  AC.prev = function () {
    if (AC.syncCommand && AC.syncCommand('previous', {})) return;
    if (audio.currentTime > 4) {
      audio.currentTime = 0;
      return;
    }
    var index = state.qi - 1;
    if (index < 0) index = state.repeat === 'all' ? state.queue.length - 1 : 0;
    if (state.queue[index]) AC.play(state.queue[index], { keepRadio: true });
  };

  var sleepTimer = null;
  AC.setSleep = function (minutes) {
    if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
    state.sleepMinutes = Number(minutes) || 0;
    var btn = document.querySelector('.player-timer');
    if (btn) {
      btn.classList.toggle('is-on', state.sleepMinutes > 0);
      btn.title = state.sleepMinutes > 0 ? 'Timer: ' + state.sleepMinutes + ' min' : 'Timer de sono';
    }
    if (!state.sleepMinutes) { AC.toast('Timer de sono desligado'); return; }
    sleepTimer = setTimeout(function () {
      sleepTimer = null;
      state.sleepMinutes = 0;
      if (btn) { btn.classList.remove('is-on'); btn.title = 'Timer de sono'; }
      if (!audio.paused) { audio.pause(); state.playing = false; setPlayIcon(); }
      AC.toast('Timer encerrado. Boa noite!');
    }, state.sleepMinutes * 60000);
    AC.toast('O Acervo pausa em ' + state.sleepMinutes + ' minutos');
  };

  AC.seekRatio = function (ratio) {
    if (state.current && AC.syncCommand && AC.syncCommand('seek', { position: Math.max(0, Math.min(1, ratio)) * state.current.duration })) return;
    if (!state.current || !isFinite(audio.duration) || audio.duration <= 0) return;
    var r = Math.max(0, Math.min(1, ratio));
    audio.currentTime = r * audio.duration;
    paintProgress();
    if (AC.notifyPlayback) AC.notifyPlayback(true);
  };

  function paintProgress() {
    var remote = AC.isRemotePlayback && AC.isRemotePlayback();
    var dur = !remote && isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (state.current ? state.current.duration : 0);
    var cur = remote && AC.remotePosition ? AC.remotePosition() : audio.currentTime || 0;
    var ratio = dur ? Math.max(0, Math.min(1, cur / dur)) : 0;
    var fill = $('progress-fill');
    if (fill) fill.style.width = (ratio * 100) + '%';
    var thumb = $('progress-thumb');
    if (thumb) thumb.style.left = (ratio * 100) + '%';
    var bar = $('progress');
    if (bar) bar.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    var current = $('time-current');
    if (current) current.textContent = AC.fmtTime(cur);
    var total = $('time-total');
    if (total) total.textContent = AC.fmtTime(dur);
  }

  var resumeSavedAt = 0;
  function saveResume() {
    if (!state.current || (AC.isRemotePlayback && AC.isRemotePlayback())) return;
    var position = audio.currentTime || 0;
    if (!isFinite(position) || position < 1) return;
    try { localStorage.setItem('acervo:resume', JSON.stringify({ id: state.current.id, position: position, at: Date.now() })); } catch (e) {}
  }
  audio.addEventListener('timeupdate', function () {
    var now = Date.now();
    if (now - resumeSavedAt > 5000) { resumeSavedAt = now; saveResume(); }
  });
  audio.addEventListener('pause', saveResume);
  if (typeof window.addEventListener === 'function') window.addEventListener('pagehide', saveResume);
  audio.addEventListener('timeupdate', paintProgress);
  audio.addEventListener('loadedmetadata', paintProgress);
  audio.addEventListener('play', function () { if (AC.isRemotePlayback && AC.isRemotePlayback()) { audio.pause(); return; } state.playing = true; setPlayIcon(); if (AC.notifyPlayback) AC.notifyPlayback(true); });
  audio.addEventListener('pause', function () { if (AC.isRemotePlayback && AC.isRemotePlayback()) return; state.playing = false; setPlayIcon(); if (AC.notifyPlayback) AC.notifyPlayback(true); });
  audio.addEventListener('ended', function () { if (AC.isRemotePlayback && AC.isRemotePlayback()) return; state.playing = false; audio.dataset.listenedSource = ''; AC.next(true); });
  audio.addEventListener('timeupdate', function () { if (AC.notifyPlayback) AC.notifyPlayback(false); if (AC.paintExpandedPlayer) AC.paintExpandedPlayer(); });
  audio.addEventListener('seeked', function () { if (AC.notifyPlayback) AC.notifyPlayback(true); });
  audio.addEventListener('error', function () {
    if (state.current) AC.toast('Nao foi possivel tocar este arquivo.', 'error');
  });

  /* progress drag */
  (function () {
    var bar = $('progress');
    if (!bar) return;
    var dragging = false;
    function ratioFromEvent(e) {
      var rect = bar.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }
    bar.addEventListener('pointerdown', function (e) {
      dragging = true;
      bar.classList.add('is-dragging');
      bar.setPointerCapture(e.pointerId);
      AC.seekRatio(ratioFromEvent(e));
    });
    bar.addEventListener('pointermove', function (e) {
      if (dragging) AC.seekRatio(ratioFromEvent(e));
    });
    bar.addEventListener('pointerup', function (e) {
      dragging = false;
      bar.classList.remove('is-dragging');
      try { bar.releasePointerCapture(e.pointerId); } catch (err) {}
    });
    bar.addEventListener('keydown', function (e) {
      var dur = state.current ? state.current.duration : 0;
      if (!dur) return;
      var currentTime = AC.isRemotePlayback && AC.isRemotePlayback() ? AC.remotePosition() : audio.currentTime;
      if (e.key === 'ArrowRight') { AC.seekRatio((currentTime + 5) / dur); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { AC.seekRatio((currentTime - 5) / dur); e.preventDefault(); }
    });
  })();

  /* volume */
  (function () {
    var vol = $('volume');
    var savedValue = localStorage.getItem('acervo:volume');
    var saved = Number(savedValue);
    if (savedValue !== null && isFinite(saved) && saved >= 0 && saved <= 1) state.volume = saved;
    if (vol) vol.value = String(state.volume);
    audio.volume = state.volume;
    if (vol) {
      vol.addEventListener('input', function () {
        AC.setVolume(Number(vol.value));
      });
    }
    AC.syncMute = syncMute;
  })();

  function syncMute() {
    var btn = $('btn-mute');
    if (btn) {
      btn.innerHTML = AC.icon(state.muted ? 'mute' : 'volume', 19);
      btn.setAttribute('data-ico-done', '1');
      btn.setAttribute('aria-label', state.muted ? 'Ativar som' : 'Silenciar');
    }
  }

  AC.toggleMute = function () {
    if (AC.syncCommand && AC.syncCommand('volume', { volume: state.muted || state.volume === 0 ? 0.85 : 0 })) return;
    state.muted = !state.muted;
    audio.muted = state.muted;
    if (state.muted) { try { localStorage.setItem('acervo:volume', '0'); } catch (e) {} }
    syncMute();
    if (AC.notifyPlayback) AC.notifyPlayback(true);
  };

  AC.setVolume = function (volume) {
    var value = Math.max(0, Math.min(1, Number(volume) || 0));
    if (AC.syncCommand && AC.syncCommand('volume', { volume: value })) return;
    state.volume = value; state.muted = value === 0;
    audio.volume = value; audio.muted = false;
    var control = $('volume'); if (control) control.value = String(value);
    localStorage.setItem('acervo:volume', String(value));
    syncMute();
    if (AC.notifyPlayback) AC.notifyPlayback(true);
  };

  AC.playbackSnapshot = function () {
    return { trackId: state.current ? state.current.id : null, queue: state.queue.slice(), qi: state.queue.length ? state.qi : -1,
      playing: Boolean(state.current && !audio.paused && !audio.ended), position: audio.currentTime || 0,
      volume: audio.muted ? 0 : state.volume, shuffle: state.shuffle, repeat: state.repeat };
  };
  AC.paintPlayback = function () {
    paintPlayer(); paintProgress(); syncMute();
    var volume = $('volume'); if (volume) volume.value = String(state.volume);
    var shuffle = $('btn-shuffle'); if (shuffle) shuffle.classList.toggle('is-on', state.shuffle);
    var repeat = $('btn-repeat'); if (repeat) repeat.classList.toggle('is-on', state.repeat !== 'off');
    if (AC.paintExpandedPlayer) AC.paintExpandedPlayer();
  };
  AC.applyRemotePlayback = function (snapshot) {
    state.current = AC.trackById(snapshot.trackId);
    state.queue = (snapshot.queue || []).slice(); state.qi = snapshot.qi || 0;
    state.playing = Boolean(snapshot.playing && state.current);
    state.volume = snapshot.volume; state.muted = snapshot.volume === 0;
    state.shuffle = Boolean(snapshot.shuffle); state.repeat = snapshot.repeat || 'off';
    AC.paintPlayback(); AC.renderQueue();
    if (AC.renderSidebar) AC.renderSidebar();
  };
  AC.restorePlayback = async function (snapshot) {
    audio.pause();
    state.current = AC.trackById(snapshot.trackId);
    state.queue = (snapshot.queue || []).slice(); state.qi = snapshot.qi || 0;
    state.shuffle = Boolean(snapshot.shuffle); state.repeat = snapshot.repeat || 'off';
    state.volume = snapshot.volume; state.muted = snapshot.volume === 0;
    audio.volume = state.volume; audio.muted = false; state.playing = false;
    if (!state.current) { audio.removeAttribute('src'); AC.paintPlayback(); return; }
    var track = state.current;
    var target = Math.max(0, Math.min(Number(snapshot.position) || 0, Math.max(0, track.duration - 0.1)));
    audio.src = '/api/stream/' + encodeURIComponent(track.id);
    // A handoff continues the same listening session instead of counting a new play.
    audio.dataset.listenedSource = audio.src;
    var expectedSource = audio.src;
    function seek() { if (audio.src === expectedSource) { try { audio.currentTime = target; } catch (err) {} } }
    audio.addEventListener('loadedmetadata', seek, { once: true });
    seek(); AC.paintPlayback();
    if (AC.onTrackChange) AC.onTrackChange(track);
    if (snapshot.playing) {
      try { await audio.play(); if (AC.isRemotePlayback && AC.isRemotePlayback()) { audio.pause(); return; } state.playing = true; }
      catch (err) { state.playing = false; if (AC.onPlaybackBlocked) AC.onPlaybackBlocked(); }
    }
    AC.paintPlayback(); if (AC.notifyPlayback) AC.notifyPlayback(true);
  };

  /* ---------- modal ---------- */
  AC.openModal = function (html, className) {
    var scrim = $('scrim');
    var root = $('modal-root');
    if (scrim) scrim.hidden = false;
    root.innerHTML = '<div class="modal-wrap"><div class="' + (className || 'modal') + '" role="dialog" aria-modal="true">' + html + '</div></div>';
    AC.hydrateIcons(root);
  };

  AC.closeModals = function () {
    if (AC.onModalClose) AC.onModalClose();
    var root = $('modal-root');
    if (root) root.innerHTML = '';
    var scrim = $('scrim');
    if (scrim) scrim.hidden = true;
    state.panelId = null;
    state.panelRecs = null;
    state.discover = null;
  };

  /* ---------- jobs ---------- */
  AC.loadPlaylists = async function () {
    try {
      var data = await AC.api('/api/playlists');
      state.playlists = Array.isArray(data.playlists) ? data.playlists : [];
    } catch (e) { state.playlists = state.playlists || []; }
    return state.playlists;
  };

  AC.importPlaylist = async function (url) {
    AC.toast('Lendo a playlist…');
    try {
      var result = await AC.api('/api/playlists/import', { method: 'POST', body: JSON.stringify({ url: url }) });
      await AC.loadPlaylists();
      state.view = 'playlist';
      state.playlistId = result.playlist.id;
      if (typeof AC.render === 'function') AC.render();
      AC.toast(result.total + ' músicas na fila. O download continua no computador.');
      return result;
    } catch (error) {
      AC.toast('Playlist: ' + error.message, 'error');
      throw error;
    }
  };

  AC.startImport = async function (payload) {
    // Preserve the exact result the user selected when a later metadata lookup fails.
    // Radio sourceArtist/because describe the seed, so they must not become the song artist.
    if (payload.videoId) {
      var knownResults = (state.search.results || []).concat(
        AC.radioState && AC.radioState.results || [],
        Array.isArray(state.discover) ? state.discover : []
      );
      var selected = knownResults.find(function (item) { return item.videoId === payload.videoId; });
      if (selected) {
        var metadata = {};
        ['title', 'artist', 'channel', 'duration', 'thumbnail'].forEach(function (key) {
          if (selected[key] !== undefined) metadata[key] = selected[key];
        });
        payload = Object.assign({}, payload, { meta: Object.assign(metadata, payload.meta || {}) });
      }
    }
    var key = payload.videoId || payload.url || payload.query;
    try {
      var res = await AC.api('/api/import', { method: 'POST', body: JSON.stringify(payload) });
      state.jobs[key] = { id: res.jobId, videoId: payload.videoId || null, status: 'queued', progress: 1, stage: 'Na fila', message: 'Aguardando' };
      AC.syncJob(key);
      AC.pollJob(res.jobId, key);
      AC.toast('Download iniciado');
      return res.jobId;
    } catch (err) {
      AC.toast(err.message, 'error');
      return null;
    }
  };

  AC.pollJob = function (jobId, key) {
    var started = Date.now();
    async function tick() {
      try {
        var job = await AC.api('/api/jobs/' + encodeURIComponent(jobId));
        if (job.videoId) {
          var oldKey = key;
          key = job.videoId;
          state.jobs[key] = job;
          if (oldKey !== key) { state.jobs[oldKey] = job; AC.syncJob(oldKey); }
        }
        state.jobs[key] = job;
        AC.syncJob(key);
        if (job.status === 'done') {
          await AC.loadLibrary({ silent: true });
          AC.syncJob(key);
          if (state.playAfterImport === job.videoId) {
            state.playAfterImport = null;
            if (state.queue.indexOf(job.trackId) === -1) state.queue.push(job.trackId);
            AC.play(job.trackId, { keepRadio: true });
          }
          if (state.view === 'radio' && typeof AC.paintRadio === 'function') AC.paintRadio();
          else if (typeof AC.render === 'function' && state.view !== 'search') AC.render();
          AC.toast((job.track ? job.track.title : 'Faixa') + ' entrou no acervo');
          return;
        }
        if (job.status === 'error') {
          if (state.playAfterImport === job.videoId) state.playAfterImport = null;
          AC.toast(job.error || 'Falha no download', 'error');
          return;
        }
        if (Date.now() - started > 12 * 60 * 1000) {
          AC.toast('O download demorou demais e foi abandonado.', 'error');
          return;
        }
        setTimeout(tick, 850);
      } catch (err) {
        if (Date.now() - started > 12 * 60 * 1000) return;
        setTimeout(tick, 1600);
      }
    }
    tick();
  };

  AC.jobMarkup = function (key) {
    var job = state.jobs[key];
    if (!job) {
      return '<button class="btn btn-ghost btn-sm" data-action="download" data-video-id="' + AC.esc(key) + '">' + AC.icon('download', 15) + ' Baixar</button>';
    }
    if (job.status === 'done') {
      return '<span class="pill pill-accent">' + AC.icon('check', 12) + ' no acervo</span>' +
        '<button class="btn btn-light btn-sm" data-action="play-track" data-id="' + AC.esc(job.trackId || '') + '">' + AC.icon('play', 13) + ' Tocar</button>';
    }
    if (job.status === 'error') {
      return '<span class="pill pill-ghost" title="' + AC.esc(job.error || '') + '">falhou</span>' +
        '<button class="btn btn-ghost btn-sm" data-action="download" data-video-id="' + AC.esc(key) + '">Tentar de novo</button>';
    }
    var pct = Math.max(2, Math.min(100, Number(job.progress) || 0));
    return '<div class="jobbar"><div class="jobbar-track"><div class="jobbar-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="jobbar-text">' + AC.esc(job.stage || 'Baixando') + ' · ' + pct + '%</div></div>';
  };

  AC.syncJob = function (key) {
    all('[data-job-slot]').forEach(function (el) {
      if (el.getAttribute('data-job-slot') !== key) return;
      el.innerHTML = AC.jobMarkup(key);
    });
  };

  /* ---------- queue ---------- */
  AC.renderQueue = function () {
    var root = $('queue-root');
    if (!root) return;
    if (!state.queueOpen) { root.innerHTML = ''; return; }
    var list = state.queue.map(function (id, i) {
      var t = AC.trackById(id);
      if (!t) return '';
      return '<button class="qitem' + (i === state.qi ? ' is-current' : '') + '" data-action="play-track" data-id="' + AC.esc(id) + '">' +
        '<span class="qitem-cover">' + AC.coverHtml(t) + '</span>' +
        '<span style="min-width:0"><span class="qitem-title">' + AC.esc(t.title) + '</span><span class="qitem-sub">' + AC.esc(t.artist) + '</span></span>' +
        '</button>';
    }).join('');
    root.innerHTML = '<div class="queue-panel"><div class="queue-head">' + AC.icon('queue', 16) +
      '<h3>Fila · ' + state.queue.length + '</h3><button class="icon-btn" style="margin-left:auto" data-action="queue" aria-label="Fechar fila">' + AC.icon('close', 16) + '</button></div>' +
      '<div class="queue-list">' + (list || '<p class="tiny" style="padding:12px">Fila vazia.</p>') + '</div></div>';
  };

  AC.toggleQueue = function () {
    state.queueOpen = !state.queueOpen;
    AC.renderQueue();
  };

  /* ---------- action routing ---------- */
  AC.playerActions = {
    toggle: function () { AC.toggle(); },
    next: function () { AC.next(false); },
    prev: function () { AC.prev(); },
    shuffle: function () {
      if (AC.syncCommand && AC.syncCommand('shuffle', { shuffle: !state.shuffle })) return;
      AC.setShuffle(!state.shuffle);
      AC.toast(state.shuffle ? 'Aleatório inteligente ativado' : 'Aleatório desativado');
      if (AC.notifyPlayback) AC.notifyPlayback(true);
    },
    repeat: function () {
      if (AC.syncCommand && AC.syncCommand('repeat', { repeat: state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off' })) return;
      state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
      var btn = $('btn-repeat');
      if (btn) {
        btn.classList.toggle('is-on', state.repeat !== 'off');
        btn.title = state.repeat === 'one' ? 'Repetir uma' : state.repeat === 'all' ? 'Repetir tudo' : 'Repetir';
      }
      AC.toast(state.repeat === 'one' ? 'Repetir esta faixa' : state.repeat === 'all' ? 'Repetir fila' : 'Repetição desligada');
      if (AC.notifyPlayback) AC.notifyPlayback(true);
    },
    mute: function () { AC.toggleMute(); },
    queue: function () { AC.toggleQueue(); },
    menu: function () { document.body.classList.toggle('nav-open'); },
    'switch-version': function () {
      var target = '/escolher?choose=1';
      if (window.top !== window.self) {
        try { window.top.location.href = target; return; } catch (e) {}
      }
      window.location.href = target;
    },
    'close-modal': function () { AC.closeModals(); }
  };

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) {
      if (e.target.id === 'scrim') AC.closeModals();
      else if (e.target.classList && e.target.classList.contains('modal-wrap')) AC.closeModals();
      return;
    }
    var name = el.getAttribute('data-action');
    if (name === 'nav') {
      e.preventDefault();
      if (typeof AC.go === 'function') AC.go(el.getAttribute('data-view'));
      document.body.classList.remove('nav-open');
      return;
    }
    if (AC.playerActions[name]) {
      e.preventDefault();
      AC.playerActions[name](el, e);
      return;
    }
    if (typeof AC.handleAction === 'function') {
      var handled = AC.handleAction(name, el, e);
      if (handled !== false) e.preventDefault();
    }
  });

  document.addEventListener('keydown', function (e) {
    var focusedAction = document.activeElement;
    if (e.defaultPrevented) return;
    if ((e.key === 'Enter' || e.code === 'Space') && focusedAction && focusedAction.getAttribute('role') === 'button' && focusedAction.hasAttribute('data-action') && focusedAction.tagName !== 'BUTTON') {
      e.preventDefault();
      focusedAction.click();
      return;
    }
    if (e.key === 'Escape') {
      if (state.queueOpen) { state.queueOpen = false; AC.renderQueue(); }
      else AC.closeModals();
      document.body.classList.remove('nav-open');
    }
    var hasModal = document.getElementById('modal-root') && document.getElementById('modal-root').children.length > 0;
    var interactive = focusedAction && (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(focusedAction.tagName) || focusedAction.isContentEditable || focusedAction.getAttribute('role') === 'slider' || focusedAction.getAttribute('role') === 'checkbox');
    if (e.code === 'Space' && !hasModal && !interactive) {
      e.preventDefault();
      AC.toggle();
    }
  });

  paintPlayer();
  syncMute();
})();
