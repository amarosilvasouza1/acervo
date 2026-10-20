(function () {
  'use strict';

  var AC = window.AC;
  var S = AC.state;
  var esc = AC.esc;
  var cache = Object.create(null);
  var items = Object.create(null);
  var active = null;
  var sequence = 0;
  var CACHE_AGE = 5 * 60 * 1000;
  var sections = {
    recommended: ['Recomendadas', 'Descobertas a partir das suas músicas.'],
    releases: ['Novos lançamentos', 'Discos e faixas com data de lançamento confirmada.'],
    recent: ['Recentes', 'Volte às músicas que passaram pelo seu player.']
  };

  function sectionName(section) { return Object.prototype.hasOwnProperty.call(sections, section) ? section : 'recommended'; }
  function artistName(name) { return String(name || '').trim().slice(0, 120); }
  function identity(kind, key) { return kind + ':' + key; }
  function usable(entry) { return entry && entry.epoch === S.authEpoch; }
  function safeUrl(value) {
    if (typeof value !== 'string' || !/^https:\/\//i.test(value)) return '';
    try {
      var url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch (ignored) { return ''; }
  }
  function image(value, fallback, className) {
    var url = typeof value === 'string' && /^\/api\/cover\/[A-Za-z0-9_-]{6,64}$/.test(value) ? value : safeUrl(value);
    return '<span class="' + className + '">' + (url
      ? '<img src="' + esc(url) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
      : '<span class="catalog-image-fallback" aria-hidden="true">' + AC.icon(fallback, 36) + '</span>') + '</span>';
  }
  function sourceLink(url, label) {
    var target = safeUrl(url);
    return target ? '<a class="catalog-source" href="' + esc(target) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + ' ' + AC.icon('arrow', 12) + '</a>' : '';
  }
  function dateLabel(value) {
    var date = String(value || '');
    if (/^\d{4}$/.test(date)) return date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
    var parsed = new Date(date + 'T12:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return '';
    return parsed.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  function savedTrack(item) {
    if (!item) return null;
    return (S.tracks || []).find(function (track) {
      return (item.id && track.id === item.id) || (item.videoId && track.videoId === item.videoId);
    }) || null;
  }
  function artistButton(name, className) {
    return name ? '<button class="' + (className || 'catalog-artist') + ' artist-link" data-action="open-artist" data-artist="' + esc(name) + '">' + esc(name) + '</button>' : '';
  }
  function queryFor(item) { return [item.artist, item.title].filter(Boolean).join(' '); }
  function playButton(item, key, className) {
    var saved = savedTrack(item);
    var playable = saved || /^[A-Za-z0-9_-]{11}$/.test(item.videoId || '');
    items[key] = { item: item, epoch: S.authEpoch };
    return '<button class="' + (className || 'catalog-play') + '" data-action="' + (playable ? 'explore-play' : 'catalog-search') + '" data-explore-key="' + esc(key) + '" data-query="' + esc(queryFor(item)) + '" aria-label="' + esc((playable ? 'Ouvir ' : 'Buscar para ouvir ') + item.title) + '" title="' + (playable ? 'Ouvir' : 'Buscar para ouvir') + '">' + AC.icon(playable ? 'play' : 'search', 18) + '</button>';
  }
  function catalogCard(item, key, release) {
    var album = item.kind === 'album';
    var playable = savedTrack(item) || /^[A-Za-z0-9_-]{11}$/.test(item.videoId || '');
    var saved = !album && savedTrack(item);
    var date = dateLabel(item.releaseDate);
    var thumb = safeUrl(item.thumbnail);
    var cover = saved && saved.hasCover ? AC.coverHtml(saved) : thumb
      ? '<img src="' + esc(thumb) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
      : '<span class="catalog-image-fallback" aria-hidden="true">' + AC.icon('wave', 40) + '</span>';
    var action = album
      ? '<button class="catalog-play" data-action="catalog-search" data-query="' + esc(queryFor(item)) + '" aria-label="Buscar álbum ' + esc(item.title) + '">' + AC.icon('search', 18) + '</button>'
      : playButton(item, key);
    var details = [album ? 'Álbum' : '', date || (release ? '' : item.duration ? AC.fmtTime(item.duration) : '')].filter(Boolean).join(' · ');
    return '<article class="catalog-card" role="button" tabindex="0" data-action="' + (!album && playable ? 'explore-play' : 'catalog-search') + '" data-explore-key="' + esc(key) + '" data-query="' + esc(queryFor(item)) + '" aria-label="' + esc((!album && playable ? 'Ouvir ' : 'Buscar para ouvir ') + item.title) + '"><div class="catalog-cover">' + cover + action + '</div>' +
      '<h3 class="catalog-title" title="' + esc(item.title) + '">' + esc(item.title) + '</h3>' + artistButton(item.artist) +
      (details ? '<p class="catalog-meta">' + esc(details) + '</p>' : '') +
      (saved ? '<span class="catalog-saved">' + AC.icon('check', 12) + ' No acervo</span>' : '') +
      '<div class="catalog-actions">' + sourceLink(item.sourceUrl || item.url, 'Ver na fonte') + '</div></article>';
  }
  function artistCards(artists) {
    return '<div class="artist-grid">' + artists.filter(function (artist) { return artist && artist.name; }).map(function (artist) {
      return '<button class="artist-card" data-action="open-artist" data-artist="' + esc(artist.name) + '">' +
        image(artist.picture, 'wave', 'artist-picture') + '<span class="artist-name">' + esc(artist.name) + '</span><span class="catalog-meta">Artista</span></button>';
    }).join('') + '</div>';
  }
  function notices(warnings) {
    return (Array.isArray(warnings) ? warnings : []).filter(function (warning) { return typeof warning === 'string' && warning; }).slice(0, 3).map(function (warning) {
      return '<p class="explore-notice" role="status">' + esc(warning) + '</p>';
    }).join('');
  }
  function empty(message) { return '<div class="explore-empty"><span aria-hidden="true">' + AC.icon('wave', 28) + '</span><h2>Ainda não há músicas aqui</h2><p>' + esc(message || 'Ouça e adicione algumas músicas para personalizar esta seleção.') + '</p><button class="btn btn-ghost" data-action="nav" data-view="search">Buscar músicas</button></div>'; }
  function loading() { return '<div class="explore-grid" aria-label="Carregando músicas" aria-busy="true">' + Array(6).fill('<div class="skeleton catalog-skeleton"></div>').join('') + '</div>'; }
  function errorMarkup(error, kind, key) {
    return '<div class="explore-empty" role="status"><h2>Não foi possível carregar</h2><p>' + esc(error || 'Verifique sua conexão e tente novamente.') + '</p><button class="btn btn-ghost" data-action="explore-retry" data-kind="' + kind + '" data-key="' + esc(key) + '">Tentar novamente</button></div>';
  }
  function feedMarkup(data, section) {
    var list = Array.isArray(data.items) ? data.items.filter(Boolean) : [];
    var artists = Array.isArray(data.artists) ? data.artists : [];
    return (data.description ? '<p class="sub explore-description">' + esc(data.description) + '</p>' : '') + notices(data.warnings) +
      (list.length ? '<div class="explore-grid">' + list.map(function (item, index) { return catalogCard(item, 'feed:' + section + ':' + index, section === 'releases'); }).join('') + '</div>' : empty(data.emptyReason)) +
      (artists.length ? '<section class="artist-section"><div class="section-head"><h2>Artistas para explorar</h2></div>' + artistCards(artists) + '</section>' : '');
  }
  function popularMarkup(tracks, prefix) {
    var list = tracks.filter(Boolean).slice(0, 10);
    return '<div class="artist-popular">' + list.map(function (track, index) {
      var saved = savedTrack(track);
      var cover = saved && saved.hasCover ? AC.coverHtml(saved) : image(track.thumbnail, 'wave', 'artist-track-cover');
      return '<div class="artist-track-row"><span class="artist-track-index">' + (index + 1) + '</span><span class="artist-track-art">' + cover + '</span>' +
        '<button class="artist-track-title" data-action="' + (saved ? 'explore-play' : 'catalog-search') + '" data-explore-key="' + esc(prefix + ':' + index) + '" data-query="' + esc(queryFor(track)) + '">' + esc(track.title) + (track.album ? '<small>' + esc(track.album) + '</small>' : '') + '</button>' +
        '<span class="catalog-meta">' + (track.duration ? AC.fmtTime(track.duration) : '') + '</span>' + playButton(track, prefix + ':' + index, 'icon-btn artist-track-play') + '</div>';
    }).join('') + '</div>';
  }
  function artistMarkup(data, name) {
    var local = Array.isArray(data.localTracks) ? data.localTracks : [];
    var popular = Array.isArray(data.topTracks) ? data.topTracks : [];
    var albums = Array.isArray(data.albums) ? data.albums : [];
    var related = Array.isArray(data.relatedArtists) ? data.relatedArtists : [];
    local = local.slice().sort(function (a, b) { return (b.plays || 0) - (a.plays || 0); });
    var label = data.name || name;
    var localCover = local.find(function (track) { return track.hasCover && track.id; });
    var art = '';
    [data.picture, data.banner, localCover ? '/api/cover/' + localCover.id : '',
      popular[0] && popular[0].thumbnail, local[0] && local[0].thumbnail].some(function (candidate) {
      var safe = typeof candidate === 'string' && /^\/api\/cover\/[A-Za-z0-9_-]{6,64}$/.test(candidate) ? candidate : safeUrl(candidate);
      if (!safe) return false;
      art = safe;
      return true;
    });
    var stats = [];
    if (local.length) stats.push(local.length + ' no acervo');
    if (popular.length) stats.push(popular.length + ' no catálogo');
    var playAll = local.length ? '<button class="btn btn-accent" data-action="artist-play-all" data-artist="' + esc(label) + '">' + AC.icon('play', 15) + ' Tocar tudo</button>' : '';
    var followers = typeof data.followers === 'number' && Number.isFinite(data.followers) && data.followers >= 0
      ? '<p class="artist-followers">' + new Intl.NumberFormat('pt-BR').format(data.followers) + ' ' + esc(data.followersLabel || 'seguidores no catálogo') + '</p>' : '';
    var tabs = [['artist-popular-section', 'Músicas'], ['artist-albums-section', 'Discografia'], ['artist-about-section', 'Sobre']].map(function (item) {
      return '<button class="artist-section-link" data-action="artist-section" data-section="' + item[0] + '">' + item[1] + '</button>';
    }).join('');
    var minutes = Math.round(local.reduce(function (sum, track) { return sum + (Number(track.duration) || 0); }, 0) / 60);
    var plays = local.reduce(function (sum, track) { return sum + (Number(track.plays) || 0); }, 0);
    return '<header class="artist-hero artist-hero-editorial">' + (art ? '<div class="artist-hero-backdrop" style="background-image:url(\'' + esc(art).replace(/'/g, '%27') + '\')"></div><div class="artist-hero-shade"></div>' : '') +
      image(art, 'wave', 'artist-hero-picture') +
      '<div class="artist-hero-copy"><p class="eyebrow">' + AC.icon('wave', 16) + ' Artista' + (data.catalogMatched ? ' · perfil do catálogo' : '') + '</p><h1>' + esc(label) + '</h1>' +
      (stats.length ? '<p class="artist-stats">' + esc(stats.join(' · ')) + '</p>' : '') + followers +
      '</div></header><div class="artist-command-bar">' + playAll + '<button class="btn btn-ghost" data-action="catalog-search" data-query="' + esc(label) + '">' + AC.icon('search', 15) + ' Buscar músicas</button>' + sourceLink(data.sourceUrl, 'Ver artista na fonte') + '</div>' +
      '<nav class="artist-section-nav" aria-label="Seções do artista">' + tabs + '</nav>' + notices(data.warnings) +
      '<div class="artist-overview-grid"><section class="artist-section" id="artist-popular-section"><div class="section-head"><h2>' + (popular.length ? 'Populares' : 'Destaques no seu acervo') + '</h2></div>' +
      (popular.length ? '<p class="tiny artist-section-description">Mais ouvidas no catálogo · escolha uma versão para ouvir.</p>' + popularMarkup(popular, 'popular:' + name) : local.length ? popularMarkup(local, 'local:' + name) : '<p class="artist-section-empty">O catálogo ainda não retornou músicas para este perfil. Use Buscar músicas para explorar.</p>') + '</section>' +
      '<aside class="artist-listening-card"><span class="eyebrow">Sua coleção</span><h2>' + local.length + '<small> músicas salvas</small></h2><p>Seu espaço para ouvir ' + esc(label) + '.</p><div class="artist-listening-stats"><span><strong>' + minutes + '</strong> min de música</span><span><strong>' + plays + '</strong> reproduções suas</span></div>' +
      (local[0] ? '<button class="artist-featured-track" data-action="play-track" data-id="' + esc(local[0].id) + '"><span class="artist-featured-cover">' + AC.coverHtml(local[0]) + '</span><span><small>Mais ouvida por você</small><strong>' + esc(local[0].title) + '</strong></span>' + AC.icon('play', 16) + '</button>' : '') + '</aside></div>' +
      (popular.length && local.length ? '<section class="artist-section"><div class="section-head"><h2>No seu acervo</h2><span class="tiny">' + local.length + ' músicas</span></div>' + popularMarkup(local, 'local:' + name) + '</section>' : '') +
      '<section class="artist-section" id="artist-albums-section"><div class="section-head"><h2>Discografia</h2><span class="tiny">Álbuns e lançamentos</span></div>' + (albums.length ? '<div class="album-grid">' + albums.map(function (album, index) {
        return catalogCard(Object.assign({}, album, { kind: 'album', artist: album.artist || label }), 'album:' + name + ':' + index, true);
      }).join('') + '</div>' : '<p class="artist-section-empty">A discografia não está disponível neste catálogo agora.</p>') + '</section>' +
      '<section class="artist-section artist-about-layout" id="artist-about-section">' + image(art, 'wave', 'artist-about-photo') + '<div class="artist-biography"><div class="section-head"><h2>Sobre ' + esc(label) + '</h2></div><p>' + esc(data.biography || 'Ainda não há uma biografia confirmada para este artista. Você pode explorar as músicas e os links disponíveis sem perder sua coleção.') + '</p>' + sourceLink(data.bioSourceUrl || data.sourceUrl, data.bioSourceName || (data.biography ? 'Fonte da biografia' : 'Ver perfil na fonte')) + '</div></section>' +
      (related.length ? '<section class="artist-section"><div class="section-head"><h2>Artistas relacionados</h2></div>' + artistCards(related) + '</section>' : '') +
      (!local.length && !popular.length && !albums.length && !data.biography ? empty(data.catalogMatched === false ? 'Não encontramos um perfil confirmado para este nome. Use a busca para encontrar as músicas.' : 'O catálogo não retornou músicas deste artista agora.') : '');
  }
  function content(kind, key, entry) {
    if (!usable(entry)) return loading();
    if (entry.error) return errorMarkup(entry.error, kind, key);
    return kind === 'artist' ? artistMarkup(entry.data, key) : feedMarkup(entry.data, key);
  }
  AC.exploreView = function (section) {
    section = sectionName(section);
    var tabs = Object.keys(sections).map(function (key) {
      return '<button class="filter-chip' + (key === section ? ' is-active' : '') + '" data-action="explore-section" data-section="' + key + '"' + (key === section ? ' aria-current="page"' : '') + '>' + esc(sections[key][0]) + '</button>';
    }).join('');
    return '<div class="view explore-view"><header class="view-head"><div><h1>' + esc(sections[section][0]) + '</h1><p class="sub">' + esc(sections[section][1]) + '</p></div><button class="btn btn-quiet btn-sm" data-action="explore-retry" data-kind="feed" data-key="' + section + '">' + AC.icon('repeat', 14) + ' Atualizar</button></header><nav class="explore-tabs" aria-label="Explorar músicas">' + tabs + '</nav><div id="explore-content">' + content('feed', section, cache[identity('feed', section)]) + '</div></div>';
  };
  AC.artistView = function () {
    var name = artistName(S.artistName);
    return '<div class="view artist-view"><button class="link artist-back" data-action="nav" data-view="explore">← Explorar</button><div id="artist-content">' + content('artist', name, cache[identity('artist', name)]) + '</div></div>';
  };
  function current(context) {
    if (active !== context || context.epoch !== S.authEpoch) return false;
    return context.kind === 'artist' ? S.view === 'artist' && artistName(S.artistName) === context.key
      : S.view === 'explore' && sectionName(S.exploreSection) === context.key;
  }
  function paint(context, entry) {
    if (!current(context)) return;
    var root = document.getElementById(context.kind === 'artist' ? 'artist-content' : 'explore-content');
    if (!root) return;
    root.innerHTML = content(context.kind, context.key, entry);
    AC.hydrateIcons(root);
  }
  function mount(kind, key, force) {
    var id = identity(kind, key);
    var cached = cache[id];
    if (!force && active && active.kind === kind && active.key === key && current(active)) {
      if (active.loading) return active.promise;
      if (usable(cached) && Date.now() - cached.at < CACHE_AGE) { paint(active, cached); return Promise.resolve(); }
    }
    AC.leaveExplore();
    var context = { id: ++sequence, kind: kind, key: key, epoch: S.authEpoch, loading: true, controller: typeof AbortController === 'function' ? new AbortController() : null };
    active = context;
    if (!force && usable(cached) && Date.now() - cached.at < CACHE_AGE) {
      context.loading = false;
      paint(context, cached);
      return Promise.resolve();
    }
    paint(context, null);
    context.promise = (async function () {
      try {
        var path = kind === 'artist' ? '/api/artist?name=' + encodeURIComponent(key) : '/api/explore?section=' + encodeURIComponent(key);
        var data = await AC.api(path, context.controller ? { signal: context.controller.signal } : undefined);
        if (!current(context)) return;
        var entry = { data: data || {}, epoch: context.epoch, at: Date.now() };
        cache[id] = entry;
        context.loading = false;
        paint(context, entry);
      } catch (error) {
        if (!current(context)) return;
        context.loading = false;
        var failed = { error: error.message || 'O catálogo está indisponível agora.', epoch: context.epoch, at: Date.now() };
        cache[id] = failed;
        paint(context, failed);
      }
    })();
    return context.promise;
  }
  AC.mountExplore = function (section) { return mount('feed', sectionName(section)); };
  AC.mountArtist = function (name) { name = artistName(name); return name ? mount('artist', name) : Promise.resolve(); };
  AC.artistSummary = async function (name) {
    name = artistName(name);
    var epoch = S.authEpoch, id = identity('artist', name), entry = cache[id];
    if (usable(entry) && entry.data && Date.now() - entry.at < CACHE_AGE) return entry.data;
    var data = await AC.api('/api/artist?name=' + encodeURIComponent(name));
    if (epoch !== S.authEpoch) return null;
    cache[id] = { data: data, epoch: epoch, at: Date.now() };
    return data;
  };
  AC.invalidateExplore = function (section) {
    Object.keys(cache).forEach(function (key) {
      if (!section || key === identity('feed', sectionName(section))) delete cache[key];
    });
    if (active && current(active) && (!section || (active.kind === 'feed' && active.key === sectionName(section)))) {
      return mount(active.kind, active.key, true);
    }
    return Promise.resolve();
  };
  AC.leaveExplore = function () {
    if (active && active.controller) active.controller.abort();
    active = null;
    items = Object.create(null);
  };
  AC.openArtist = function (name) {
    name = artistName(name);
    if (!name) return;
    AC.leaveExplore();
    S.artistName = name;
    if (typeof AC.closeModals === 'function') AC.closeModals();
    AC.go('artist');
  };
  AC.playerActions['open-artist'] = function (element) { AC.openArtist(element.getAttribute('data-artist')); };
  AC.playerActions['artist-section'] = function (element) {
    var id = element.getAttribute('data-section');
    if (['artist-popular-section', 'artist-albums-section', 'artist-about-section'].indexOf(id) === -1) return;
    var section = document.getElementById(id);
    if (section && section.scrollIntoView) section.scrollIntoView({ behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };
  AC.playerActions['artist-play-all'] = function (element) {
    var name = element.getAttribute('data-artist');
    var entry = cache[identity('artist', name)];
    var data = entry && entry.data;
    var ids = (data && Array.isArray(data.localTracks) ? data.localTracks : []).map(function (track) { return track.id; }).filter(Boolean);
    if (!ids.length) { AC.toast('Nenhuma música deste artista está no acervo ainda.', 'error'); return; }
    AC.playQueue(ids);
  };
  AC.playerActions['explore-section'] = function (element) {
    AC.leaveExplore();
    S.exploreSection = sectionName(element.getAttribute('data-section'));
    AC.go('explore');
  };
  AC.playerActions['explore-retry'] = function (element) {
    var kind = element.getAttribute('data-kind') === 'artist' ? 'artist' : 'feed';
    var key = kind === 'artist' ? artistName(element.getAttribute('data-key')) : sectionName(element.getAttribute('data-key'));
    return mount(kind, key, true);
  };
  AC.playerActions['catalog-search'] = function (element) {
    var query = String(element.getAttribute('data-query') || '').trim();
    if (query && typeof AC.searchCatalog === 'function') AC.searchCatalog(query);
    else if (query) { AC.go('search'); AC.toast('Pesquise por “' + query + '” para escolher uma versão.'); }
  };
  AC.playerActions['explore-play'] = function (element) {
    var record = items[element.getAttribute('data-explore-key')];
    if (!record || record.epoch !== S.authEpoch) return;
    var saved = savedTrack(record.item);
    if (saved) { AC.play(saved.id); return; }
    var videoId = record.item.videoId;
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) return;
    S.playAfterImport = videoId;
    AC.startImport({ videoId: videoId, meta: { title: record.item.title, artist: record.item.artist, thumbnail: record.item.thumbnail } });
  };
  var previousListen = AC.onListen;
  AC.onListen = function (track) {
    if (typeof previousListen === 'function') previousListen(track);
    AC.invalidateExplore('recent');
    AC.invalidateExplore('recommended');
  };
  var librarySignature = '';
  var previousLibraryLoaded = AC.onLibraryLoaded;
  AC.onLibraryLoaded = function () {
    if (typeof previousLibraryLoaded === 'function') previousLibraryLoaded();
    var signature = JSON.stringify((S.tracks || []).map(function (track) { return [track.id, track.title, track.artist, track.hasCover, track.lastPlayedAt, track.plays]; }));
    if (signature !== librarySignature) { librarySignature = signature; AC.invalidateExplore(); }
  };
})();
