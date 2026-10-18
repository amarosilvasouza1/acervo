(function () {
  'use strict';

  var AC = window.AC;
  var S = AC.state;
  var esc = AC.esc;
  var icon = AC.icon;
  var NEWS_VERSION = '1.3.2';
  var NEWS = [
    ['Tela desligada', 'No APK 1.3.2 a música continua com a tela apagada: o serviço segura CPU e Wi-Fi e mantém a notificação ativa.'],
    ['Notificação no modo conectado', 'Play, pausa e próxima também aparecem quando o som vem do Acervo no PC, não só no modo independente.'],
    ['Aleatório inteligente', 'A fila embaralhada intercala artistas e evita repetir o mesmo nome em sequência.'],
    ['Rádio que já baixa a próxima', 'No modo rádio do celular, a próxima faixa é baixada enquanto a atual toca e emenda sozinha.'],
    ['Conexão salva', 'O APK abre direto no último Acervo conectado, sem repetir o QR code.'],
    ['Continue de onde parou', 'O player lembra a última faixa e a posição; basta tocar em play.'],
    ['Timer de sono', 'Escolha 15, 30, 60 ou 90 minutos e o Acervo pausa sozinho.'],
    ['Buscas recentes', 'Suas últimas buscas ficam salvas para repetir com um toque.']
  ];
  var HISTORY_KEY = 'acervo:searches';

  function searchHistory() {
    try {
      var list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(list) ? list.slice(0, 6) : [];
    } catch (e) { return []; }
  }

  function rememberQuery(query) {
    var list = searchHistory().filter(function (item) { return item.toLowerCase() !== query.toLowerCase(); });
    list.unshift(query);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 6))); } catch (e) {}
  }

  function newsBanner() {
    var unseen = true;
    try { unseen = localStorage.getItem('acervo:newsSeen') !== NEWS_VERSION; } catch (e) {}
    if (!unseen) return '';
    return '<section class="news-banner"><div class="news-copy"><span class="pill pill-accent">Novidades 1.3.2</span><strong>Tela desligada, notificação no modo conectado e aleatório inteligente</strong><p>O player segura CPU e Wi-Fi, os controles aparecem também no modo PC e o shuffle não repete artistas.</p></div><button class="btn btn-light btn-sm" data-action="whats-new">Ver novidades</button><button class="icon-btn" data-action="dismiss-news" aria-label="Dispensar novidades">' + icon('close', 16) + '</button></section>';
  }

  function openNews() {
    var html = '<div class="modal-head"><div><h2>Novidades do Acervo</h2><p>Versão ' + NEWS_VERSION + ' · PC e mobile</p></div><button class="icon-btn modal-close" data-action="close-modal" aria-label="Fechar">' + icon('close', 18) + '</button></div><div class="news-list">';
    NEWS.forEach(function (item) {
      html += '<div class="news-item"><strong>' + esc(item[0]) + '</strong><p>' + esc(item[1]) + '</p></div>';
    });
    html += '</div><div class="modal-actions"><button class="btn btn-accent" data-action="close-modal">Fechar</button></div>';
    AC.openModal(html);
    try { localStorage.setItem('acervo:newsSeen', NEWS_VERSION); } catch (e) {}
    render();
  }

  function openSleep() {
    var options = [15, 30, 60, 90].map(function (minutes) {
      return '<button class="btn btn-ghost" data-action="sleep-option" data-min="' + minutes + '">' + minutes + ' min</button>';
    }).join('');
    AC.openModal('<div class="modal-head"><div><h2>Timer de sono</h2><p>O Acervo pausa sozinho depois do tempo escolhido.</p></div><button class="icon-btn modal-close" data-action="close-modal" aria-label="Fechar">' + icon('close', 18) + '</button></div><div class="sleep-options">' + options + '<button class="btn btn-quiet" data-action="sleep-option" data-min="0">Desligar</button></div>');
  }

  function $(id) { return document.getElementById(id); }
  function qs(sel, root) { return (root || document).querySelector(sel); }

  function cover(t, eager) {
    return '<span class="cover-slot">' + AC.coverHtml(t, eager) + '</span>';
  }

  function bpmOf(t) {
    return t.features && t.features.bpm ? Math.round(t.features.bpm) : 0;
  }

  function lufsText(t) {
    return t.loudness && isFinite(t.loudness.i) ? (String(t.loudness.i).replace('.', ',') + ' LUFS') : 'sem medição';
  }

  function cardHtml(t) {
    return '<article class="card" role="button" tabindex="0" data-action="open-track" data-id="' + esc(t.id) + '">' +
      '<div class="card-cover">' + AC.coverHtml(t) +
        '<button class="card-play" data-action="play-track" data-id="' + esc(t.id) + '" aria-label="Tocar ' + esc(t.title) + '">' + icon('play', 16) + '</button>' +
      '</div>' +
      '<div>' +
        '<div class="card-title">' + esc(t.title) + '</div>' +
        '<div class="card-artist">' + esc(t.artist) + '</div>' +
      '</div>' +
    '</article>';
  }

  function rowHtml(t, index) {
    return '<div class="row" role="button" tabindex="0" data-action="open-track" data-id="' + esc(t.id) + '">' +
      '<span class="idx">' + (index + 1) + '</span>' +
      '<span class="row-main">' +
        '<span class="row-cover">' + AC.coverHtml(t) + '</span>' +
        '<span style="min-width:0"><span class="row-title">' + esc(t.title) + '</span><span class="row-artist">' + esc(t.artist) + '</span></span>' +
      '</span>' +
      '<span class="row-meta">' + (bpmOf(t) ? bpmOf(t) + ' BPM' : '—') + '</span>' +
      '<span class="row-meta">' + lufsText(t) + '</span>' +
      '<span class="row-end"><span class="row-meta">' + AC.fmtTime(t.duration) + '</span>' +
        '<button class="icon-btn row-actions" data-action="play-track" data-id="' + esc(t.id) + '" aria-label="Tocar">' + icon('play', 15) + '</button>' +
      '</span>' +
    '</div>';
  }

  function shuffled(list) {
    var copy = list.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i]; copy[i] = copy[j]; copy[j] = tmp;
    }
    return copy;
  }

  /* ---------------- home ---------------- */
  function emptyHome() {
    return '<div class="empty"><div class="empty-mark">' + icon('wave', 26) + '</div>' +
      '<h2>Sua próxima música favorita começa aqui</h2><p>Busque uma música para começar seu acervo ou descubra novos sons na rádio.</p>' +
      '<div class="empty-actions"><button class="btn btn-accent" data-action="nav" data-view="search">Buscar músicas</button>' +
      '<button class="btn btn-ghost" data-action="nav" data-view="radio">Explorar a rádio</button></div></div>';
  }

  function viewHome() {
    var recent = S.tracks.slice(0, 6);
    var listened = S.tracks.filter(function (t) { return t.lastPlayedAt; }).sort(function (a, b) { return new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt); });
    var picks = (listened.length ? listened.concat(S.tracks.filter(function (t) { return !t.lastPlayedAt; })) : S.tracks).slice(0, 6);
    var filters = '<div class="home-filters"><button class="filter-chip is-active" data-action="nav" data-view="home">Tudo</button><button class="filter-chip" data-action="nav" data-view="library">Músicas</button><button class="filter-chip" data-action="nav" data-view="radio">Rádio</button></div>';
    var quick = picks.length ? '<div class="quick-grid">' + picks.map(function (t) {
      return '<button class="quick-item" data-action="play-track" data-id="' + esc(t.id) + '"><span class="quick-cover">' + AC.coverHtml(t, true) + '</span><span class="quick-title">' + esc(t.title) + '</span><span class="quick-play" aria-hidden="true">' + icon('play', 17) + '</span></button>';
    }).join('') + '</div>' : '';
    var banner = '<section class="radio-banner"><div class="radio-art">' + icon('radio', 55) + '</div><div class="radio-banner-copy"><span class="radio-kicker">FEITA A PARTIR DO SEU SOM</span><h2>O que vem depois?</h2><p>Descubra músicas que combinam com o que você ouve. Sua rádio busca novidades em tempo real.</p><button class="btn btn-light" data-action="nav" data-view="radio">' + icon('radio', 16) + ' Explorar minha rádio</button></div></section>';
    return '<div class="view home-view">' + filters + quick + newsBanner() +
      (recent.length ? '<section class="section"><div class="section-head"><h2>De volta ao seu som</h2><button class="link" data-action="nav" data-view="library">Mostrar tudo</button></div><div class="grid">' + picks.map(cardHtml).join('') + '</div></section>' : emptyHome()) + banner +
      (listened.length ? '<section class="section"><div class="section-head"><h2>Ouvidas recentemente</h2><button class="link" data-action="start-radio">Descobrir parecidas</button></div><div class="grid">' + listened.slice(0, 6).map(cardHtml).join('') + '</div></section>' : '') +
      (recent.length ? '<section class="section"><div class="section-head"><h2>Adicionadas recentemente</h2><button class="link" data-action="nav" data-view="library">Mostrar tudo</button></div><div class="grid">' + recent.map(cardHtml).join('') + '</div></section>' : '') + '</div>';
  }

  /* ---------------- search ---------------- */
  function searchResult(r) {
    var inLib = S.tracks.some(function (t) { return t.videoId === r.videoId; });
    var action = inLib
      ? '<span class="pill pill-accent">' + icon('check', 12) + ' no acervo</span>' +
        '<button class="btn btn-light btn-sm" data-action="play-track" data-id="' + esc(r.videoId) + '">' + icon('play', 13) + ' Tocar</button>'
      : null;
    return '<div class="result">' +
      '<div class="result-thumb"><img src="' + esc(r.thumbnail) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></div>' +
      '<div class="result-body">' +
        '<div class="result-title">' + esc(r.title) + '</div>' +
        '<div class="result-sub"><span>' + esc(r.channel) + '</span>' +
          (r.duration ? '<span>' + AC.fmtTime(r.duration) + '</span>' : '') +
          (r.views ? '<span>' + AC.fmtNum(r.views) + ' views</span>' : '') +
        '</div>' +
      '</div>' +
      '<div class="result-actions" data-job-slot="' + esc(r.videoId) + '">' +
        (action || AC.jobMarkup(r.videoId)) +
      '</div>' +
    '</div>';
  }

  function viewSearch() {
    var s = S.search;
    var recentSearches = searchHistory();
    var head = '<div class="view-head"><div><h1>' + (s.q ? 'Resultados para “' + esc(s.q) + '”' : 'Buscar no YouTube') + '</h1>' +
      '<p class="sub">O áudio baixado vira MP3 normalizado e entra no acervo automaticamente.</p></div>' +
      (s.q ? '<div class="head-actions"><button class="btn btn-ghost btn-sm" data-action="open-download">' + icon('link', 15) + ' Usar link</button></div>' : '') +
    '</div>';

    if (!s.ran) {
      return '<div class="view">' + head +
        '<div class="empty"><div class="empty-mark">' + icon('search', 24) + '</div>' +
        '<h2>O que vamos ouvir hoje?</h2><p>Pesquise por faixa, artista ou cole um link do YouTube. Você também pode começar por uma destas:</p>' +
        (recentSearches.length ? '<div class="search-history"><span class="tiny">Buscas recentes</span><div class="chips" style="justify-content:center;margin-top:8px">' + recentSearches.map(function (q) {
          return '<button class="chip" data-action="search-chip" data-q="' + esc(q) + '">' + esc(q) + '</button>';
        }).join('') + '</div></div>' : '') +
        '<div class="chips" style="justify-content:center">' +
          ['Daft Punk', 'Sade', 'Tame Impala', 'Billie Eilish', 'Charlie Brown Jr.', 'Nirvana'].map(function (q) {
            return '<button class="chip" data-action="search-chip" data-q="' + esc(q) + '">' + esc(q) + '</button>';
          }).join('') +
        '</div></div></div>';
    }

    var body;
    if (s.loading) {
      body = '<div class="result-list">' + Array(6).fill('<div class="skeleton"></div>').join('') + '</div>';
    } else if (s.error) {
      body = '<div class="empty"><h2>Não deu para buscar</h2><p>' + esc(s.error) + '</p><button class="btn btn-ghost" data-action="search-chip" data-q="' + esc(s.q) + '">Tentar de novo</button></div>';
    } else if (!s.results.length) {
      body = '<div class="empty"><h2>Nenhum resultado</h2><p>Tente outro termo ou cole o link direto do vídeo.</p></div>';
    } else {
      body = '<div class="result-list">' + s.results.map(searchResult).join('') + '</div>';
    }

    var local = s.q ? S.tracks.filter(function (t) {
      var hay = (t.title + ' ' + t.artist + ' ' + (t.genre || '')).toLowerCase();
      return hay.indexOf(s.q.toLowerCase()) !== -1;
    }).slice(0, 5) : [];

    return '<div class="view">' + head +
      (recentSearches.length ? '<div class="search-history" style="margin:0 0 14px"><span class="tiny">Buscas recentes</span><div class="chips" style="margin-top:8px">' + recentSearches.map(function (q) {
        return '<button class="chip" data-action="search-chip" data-q="' + esc(q) + '">' + esc(q) + '</button>';
      }).join('') + '</div></div>' : '') +
      body +
      (local.length ? '<section class="section"><div class="section-head"><h2>Já no seu acervo</h2><span class="tiny">' + local.length + ' resultado(s)</span></div><div class="rows">' + local.map(rowHtml).join('') + '</div></section>' : '') +
    '</div>';
  }

  /* ---------------- library ---------------- */
  function libraryList() {
    var list = S.tracks.slice();
    if (S.filter) {
      var f = S.filter.toLowerCase();
      list = list.filter(function (t) {
        return (t.title + ' ' + t.artist + ' ' + (t.genre || '')).toLowerCase().indexOf(f) !== -1;
      });
    }
    if (S.sort === 'plays') list.sort(function (a, b) { return (b.plays || 0) - (a.plays || 0); });
    else if (S.sort === 'bpm') list.sort(function (a, b) { return (bpmOf(b) || 0) - (bpmOf(a) || 0); });
    else if (S.sort === 'artist') list.sort(function (a, b) { return String(a.artist).localeCompare(String(b.artist)); });
    else list.sort(function (a, b) { return new Date(b.addedAt || 0) - new Date(a.addedAt || 0); });
    return list;
  }

  function libraryGrid() {
    var list = libraryList();
    return '<div class="grid" id="lib-grid">' + (list.length ? list.map(cardHtml).join('') : '<p class="muted" style="grid-column:1/-1">Nenhuma faixa encontrada para “' + esc(S.filter) + '”.</p>') + '</div>';
  }

  function viewLibrary() {
    var head = '<div class="view-head"><div><h1>Seu acervo</h1>' +
      '<p class="sub"><span id="lib-count">' + S.tracks.length + '</span> faixas · ' + AC.fmtDur(S.stats.duration) + ' · tudo normalizado em −14 LUFS</p></div>' +
      '<div class="head-actions"><button class="btn btn-accent" data-action="open-download">' + icon('download', 16) + ' Adicionar faixa</button></div></div>';

    if (!S.tracks.length) {
      return '<div class="view">' + head +
        '<div class="empty"><div class="empty-mark">' + icon('library', 24) + '</div>' +
        '<h2>O acervo está vazio</h2><p>Baixe sua primeira faixa para começar a coleção.</p>' +
        '<div class="empty-actions"><button class="btn btn-accent" data-action="open-download">Baixar do YouTube</button><button class="btn btn-ghost" data-action="nav" data-view="search">Buscar</button></div></div></div>';
    }

    var chips = [['recent', 'Recentes'], ['plays', 'Mais tocadas'], ['bpm', 'Mais rápidas'], ['artist', 'Artista']].map(function (c) {
      return '<button class="chip' + (S.sort === c[0] ? ' is-active' : '') + '" data-action="sort" data-sort="' + c[0] + '">' + c[1] + '</button>';
    }).join('');

    return '<div class="view">' + head +
      '<div class="toolbar">' +
        '<div class="chips">' + chips + '</div>' +
        '<label class="local-search" style="margin-left:auto">' + icon('search', 15) +
          '<input id="lib-filter" placeholder="Filtrar por título ou artista" value="' + esc(S.filter) + '">' +
        '</label>' +
      '</div>' +
      libraryGrid() +
    '</div>';
  }

  /* ---------------- radio ---------------- */
  function viewRadio() {
    return AC.radioView();
  }

  /* ---------------- track sheet ---------------- */
  function specRow(label, value, ratio, extra) {
    return '<div class="spec"><span class="spec-label">' + label + '</span>' +
      '<span class="spec-value">' + value +
      (typeof ratio === 'number' ? '<span class="spec-bar"><i style="width:' + Math.max(2, Math.min(100, Math.round(ratio * 100))) + '%"></i></span>' : '') +
      (extra || '') + '</span></div>';
  }

  function sheetHtml(t) {
    var f = t.features || {};
    var l = t.loudness || {};
    var bits = [];
    if (t.genre) bits.push('<span class="pill">' + esc(t.genre) + '</span>');
    if (t.year) bits.push('<span class="pill pill-ghost">' + esc(t.year) + '</span>');
    if (bpmOf(t)) bits.push('<span class="pill">' + bpmOf(t) + ' BPM</span>');
    bits.push('<span class="pill pill-ghost">' + lufsText(t) + '</span>');
    bits.push('<span class="pill pill-ghost">' + AC.fmtTime(t.duration) + '</span>');

    return '<button class="icon-btn sheet-close" data-action="close-modal" aria-label="Fechar">' + icon('close', 18) + '</button>' +
      '<div class="sheet-top">' +
        '<div class="sheet-cover">' + AC.coverHtml(t, true) + '</div>' +
        '<div class="sheet-info">' +
          '<div class="eyebrow">' + (t.album ? esc(t.album) : 'faixa do acervo') + '</div>' +
          '<h2 class="sheet-title">' + esc(t.title) + '</h2>' +
          '<div class="sheet-artist">' + esc(t.artist) + '</div>' +
          '<div class="sheet-badges">' + bits.join('') + '</div>' +
          '<div class="sheet-actions">' +
            '<button class="btn btn-accent" data-action="play-track" data-id="' + esc(t.id) + '">' + icon('play', 15) + ' Tocar</button>' +
            '<button class="btn btn-ghost" data-action="start-radio" data-id="' + esc(t.id) + '">' + icon('radio', 15) + ' Rádio</button>' +
            '<a class="btn btn-quiet" href="' + esc(t.sourceUrl) + '" target="_blank" rel="noopener noreferrer">YouTube ' + icon('arrow', 14) + '</a>' +
            '<button class="icon-btn" data-action="delete-track" data-id="' + esc(t.id) + '" aria-label="Remover do acervo" title="Remover do acervo">' + icon('trash', 17) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="sheet-grid">' +
        '<section class="panel"><h3>Análise sonora</h3><div class="spec-list">' +
          specRow('Andamento', bpmOf(t) ? bpmOf(t) + ' BPM' : 'não detectado', bpmOf(t) ? bpmOf(t) / 200 : 0) +
          specRow('Energia', Math.round((f.energy || 0) * 100) + '%', f.energy || 0) +
          specRow('Brilho', Math.round((f.centroid || 0) * 100) + '%', f.centroid || 0) +
          specRow('Loudness', lufsText(t), isFinite(l.i) ? Math.max(0, Math.min(1, (l.i + 30) / 30)) : 0) +
          specRow('Faixa dinâmica', l.lra != null ? l.lra + ' LU' : '—', null) +
          specRow('Formato', 'MP3 · ' + Math.round((t.bitrate || 0) / 1000) + ' kbps · 44,1 kHz', null) +
          (l.measured != null ? specRow('Original', l.measured + ' LUFS → −14 LUFS', null) : '') +
        '</div></section>' +
        '<section class="panel"><h3>Parecidas no acervo</h3>' +
          '<div id="recs" class="rec-list"><div class="skeleton" style="height:44px"></div><div class="skeleton" style="height:44px;margin-top:6px"></div><div class="skeleton" style="height:44px;margin-top:6px"></div></div>' +
          '<div style="margin-top:14px;display:flex;align-items:center;gap:10px">' +
            '<button class="btn btn-ghost btn-sm" data-action="discover" data-id="' + esc(t.id) + '">' + icon('sparkles', 15) + ' Descobrir no YouTube</button>' +
            '<span class="tiny">artistas relacionados</span>' +
          '</div>' +
          '<div id="discover" style="margin-top:12px"></div>' +
        '</section>' +
      '</div>';
  }

  function recsMarkup(items) {
    if (!items.length) return '<p class="tiny">Ainda não há outras faixas para comparar. Baixe mais uma.</p>';
    return items.map(function (item) {
      var t = item.track;
      return '<button class="rec" data-action="play-track" data-id="' + esc(t.id) + '">' +
        '<span class="rec-cover">' + AC.coverHtml(t) + '</span>' +
        '<span style="min-width:0"><span class="rec-title">' + esc(t.title) + '</span>' +
          '<span class="rec-sub">' + esc(t.artist) + (item.reasons && item.reasons.length ? ' · ' + esc(item.reasons.join(', ')) : '') + '</span></span>' +
        '<span class="rec-score">' + item.score + '%</span>' +
      '</button>';
    }).join('');
  }

  function discoverMarkup(items) {
    if (!items.length) return '<p class="tiny">Nada novo encontrado agora. Tente de novo em instantes.</p>';
    return '<div class="rec-list">' + items.map(function (r) {
      var inLib = S.tracks.some(function (t) { return t.videoId === r.videoId; });
      return '<div class="rec" style="grid-template-columns:38px minmax(0,1fr) auto">' +
        '<span class="rec-cover"><img src="' + esc(r.thumbnail) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></span>' +
        '<span style="min-width:0"><span class="rec-title">' + esc(r.title) + '</span><span class="rec-sub">' + esc(r.because || r.channel) + '</span></span>' +
        '<span data-job-slot="' + esc(r.videoId) + '">' + (inLib ? '<span class="pill pill-accent">no acervo</span>' : AC.jobMarkup(r.videoId)) + '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  function loadRecs(id) {
    AC.api('/api/recommend/' + encodeURIComponent(id)).then(function (data) {
      if (S.panelId !== id) return;
      var el = $('recs');
      if (el) { el.innerHTML = recsMarkup(data.items || []); AC.hydrateIcons(el); }
    }).catch(function () {
      var el = $('recs');
      if (el) el.innerHTML = '<p class="tiny">Não foi possível calcular as parecidas.</p>';
    });
  }

  function openTrack(id) {
    var t = AC.trackById(id);
    if (!t) return;
    S.panelId = id;
    S.panelRecs = null;
    S.discover = null;
    AC.openModal(sheetHtml(t), 'sheet');
    loadRecs(id);
  }

  /* ---------------- download modal ---------------- */
  function openDownload() {
    AC.openModal(
      '<div class="modal-head"><div><h2>Baixar do YouTube</h2><p>Cole o link do vídeo ou digite o nome da música. O áudio vira MP3, entra no acervo com capa e é normalizado em −14 LUFS.</p></div>' +
      '<button class="icon-btn modal-close" data-action="close-modal" aria-label="Fechar">' + icon('close', 18) + '</button></div>' +
      '<div class="modal-field">' + icon('link', 18) + '<input id="dl-input" placeholder="https://youtube.com/watch?v=... ou nome da música" autocomplete="off"></div>' +
      '<p class="modal-hint">Dica: você pode colar vários links? Envie um por vez — a fila processa na ordem. Use apenas conteúdo que você tem direito de baixar.</p>' +
      '<div class="modal-actions"><button class="btn btn-quiet" data-action="close-modal">Cancelar</button><button class="btn btn-accent" data-action="download-submit">' + icon('download', 16) + ' Baixar</button></div>'
    );
    setTimeout(function () { var i = $('dl-input'); if (i) i.focus(); }, 40);
  }

  async function submitDownload() {
    var input = $('dl-input');
    var value = input ? input.value.trim() : '';
    if (!value) return;
    var isLink = /youtu\.?be|youtube\.com/i.test(value);
    AC.closeModals();
    if (isLink) {
      S.view = 'home';
      render();
      AC.startImport({ url: value });
    } else {
      await doSearch(value);
    }
  }

  /* ---------------- delete ---------------- */
  function confirmDelete(id) {
    var t = AC.trackById(id);
    if (!t) return;
    AC.openModal(
      '<div class="modal-head"><div><h2>Remover do acervo?</h2><p>“' + esc(t.title) + '” sai da biblioteca. O arquivo fica guardado na lixeira local do projeto.</p></div></div>' +
      '<div class="modal-actions"><button class="btn btn-quiet" data-action="close-modal">Cancelar</button>' +
      '<button class="btn btn-accent" style="background:#ff6b6b;color:#1a0404" data-action="confirm-delete" data-id="' + esc(id) + '">Remover</button></div>'
    );
  }

  async function doDelete(id) {
    try {
      await AC.api('/api/track/' + encodeURIComponent(id), { method: 'DELETE' });
      AC.closeModals();
      await AC.loadLibrary({ silent: true });
      AC.toast('Faixa removida do acervo');
      if (S.current && S.current.id === id) { S.current = null; S.playing = false; }
      render();
    } catch (err) { AC.toast(err.message, 'error'); }
  }

  /* ---------------- search flow ---------------- */
  async function doSearch(q) {
    var query = String(q || '').trim();
    if (!query) return;
    rememberQuery(query);
    S.view = 'search';
    S.search.q = query;
    S.search.loading = true;
    S.search.ran = true;
    S.search.error = null;
    S.search.results = [];
    updateNav();
    render();
    var input = $('search-input');
    if (input) input.value = query;
    try {
      var data = await AC.api('/api/search?q=' + encodeURIComponent(query));
      S.search.results = data.results || [];
    } catch (err) {
      S.search.error = err.message;
    }
    S.search.loading = false;
    if (S.view === 'search') render();
  }

  /* ---------------- radio flow ---------------- */
  AC.extendRadio = async function () {
    if (!S.current) return 0;
    if (S._extending) return 0;
    S._extending = true;
    try {
      var data = await AC.api('/api/recommend/' + encodeURIComponent(S.current.id) + '?limit=6');
      var added = 0;
      (data.items || []).forEach(function (item) {
        if (S.queue.indexOf(item.track.id) === -1) { S.queue.push(item.track.id); added++; }
      });
      S._extending = false;
      AC.renderQueue();
      return added;
    } catch (err) {
      S._extending = false;
      return 0;
    }
  };

  function startRadio(id) {
    AC.startLiveRadio(id);
  }

  /* ---------------- actions ---------------- */
  AC.handleAction = function (name, el) {
    var id = el.getAttribute('data-id');
    switch (name) {
      case 'open-download': openDownload(); return;
      case 'download-submit': submitDownload(); return;
      case 'download': {
        var vid = el.getAttribute('data-video-id');
        AC.startImport({ videoId: vid });
        return;
      }
      case 'open-track': openTrack(id); return;
      case 'play-track': AC.play(id); return;
      case 'start-radio': startRadio(id); return;
      case 'radio-current': if (S.current) startRadio(S.current.id); return;
      case 'radio-mode': AC.radioMode(el.getAttribute('data-mode')); return;
      case 'radio-refresh': AC.searchRadio(); return;
      case 'radio-stop': AC.stopRadioSearch(); return;
      case 'radio-listen': AC.listenDiscovery(el.getAttribute('data-video-id')); return;
      case 'discover': return loadDiscover(id);
      case 'delete-track': confirmDelete(id); return;
      case 'confirm-delete': doDelete(id); return;
      case 'search-chip': doSearch(el.getAttribute('data-q')); return;
      case 'sort': S.sort = el.getAttribute('data-sort'); render(); return;
      case 'play-all': if (S.tracks.length) AC.play(S.tracks[0].id); return;
      case 'shuffle-play': if (S.tracks.length) { AC.setShuffle(true); var pick = S.shuffleOrder.filter(function (id) { return !S.current || id !== S.current.id; })[0] || S.shuffleOrder[0]; AC.play(pick); } return;
      case 'clear-filter': S.filter = ''; render(); return;
      case 'whats-new': openNews(); return;
      case 'dismiss-news': try { localStorage.setItem('acervo:newsSeen', NEWS_VERSION); } catch (e) {} render(); return;
      case 'sleep': openSleep(); return;
      case 'sleep-option': AC.setSleep(Number(el.getAttribute('data-min'))); AC.closeModals(); return;
      default: return false;
    }
  };

  function loadDiscover(id) {
    var box = $('discover');
    if (!box) return;
    box.innerHTML = '<div class="skeleton" style="height:40px"></div><div class="skeleton" style="height:40px;margin-top:6px"></div><p class="tiny" style="margin-top:8px">Buscando artistas relacionados…</p>';
    AC.api('/api/discover/' + encodeURIComponent(id)).then(function (data) {
      if (S.panelId !== id) return;
      box.innerHTML = discoverMarkup(data.items || []);
      AC.hydrateIcons(box);
    }).catch(function (err) {
      box.innerHTML = '<p class="tiny">Não consegui buscar agora: ' + esc(err.message) + '</p>';
    });
  }

  /* ---------------- render ---------------- */
  function updateNav() {
    Array.prototype.forEach.call(document.querySelectorAll('.nav-item, .home-button, .mobile-nav [data-view]'), function (el) {
      var active = el.getAttribute('data-view') === S.view;
      el.classList.toggle('is-active', active);
      if (active) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  }

  AC.renderSidebar = function () {
    var root = $('sidebar-tracks');
    if (!root) return;
    var tracks = S.tracks.slice().sort(function (a, b) { return new Date(b.lastPlayedAt || b.addedAt || 0) - new Date(a.lastPlayedAt || a.addedAt || 0); });
    root.innerHTML = tracks.slice(0, 16).map(function (t) {
      var current = S.current && S.current.id === t.id;
      return '<button class="sidebar-track' + (current ? ' is-current' : '') + '" data-action="play-track" data-id="' + esc(t.id) + '" aria-label="Ouvir ' + esc(t.title) + '"><span class="sidebar-cover">' + AC.coverHtml(t) + '</span><span class="sidebar-track-copy"><span class="sidebar-track-title">' + esc(t.title) + '</span><span class="sidebar-track-sub">' + esc(t.artist) + '</span></span>' + (current && S.playing ? icon('wave', 16) : '') + '</button>';
    }).join('') || '<p class="tiny sidebar-empty">As músicas que você adicionar aparecem aqui.</p>';
  };

  function render() { AC.render(); }

  AC.go = function (view) {
    S.view = view;
    updateNav();
    render();
    var main = $('view');
    if (main) main.scrollTop = 0;
    var content = document.querySelector('.main');
    if (content) content.scrollTop = 0;
  };

  AC.render = function () {
    var main = $('view');
    if (!main) return;
    if (S.renderedView === 'radio' && S.view !== 'radio') AC.leaveRadio();
    S.renderedView = S.view;
    var html = '';
    if (S.view === 'home') main.setAttribute('aria-label', 'Início');
    else main.setAttribute('aria-label', S.view === 'radio' ? 'Sua rádio' : S.view === 'library' ? 'Seu acervo' : 'Buscar músicas');
    if (S.view === 'home') html = viewHome();
    else if (S.view === 'search') html = viewSearch();
    else if (S.view === 'library') html = viewLibrary();
    else if (S.view === 'radio') html = viewRadio();
    else html = viewHome();
    main.innerHTML = html;
    AC.hydrateIcons(main);
    updateNav();
    AC.renderSidebar();
    if (S.view === 'radio') AC.bindRadio();
    var conn = $('conn-text');
    if (conn) conn.textContent = (S.stats.tracks || 0) + ' faixas · local';
    var input = $('search-input');
    if (input && S.view === 'search' && document.activeElement !== input) input.value = S.search.q || '';

    if (S.view === 'library') {
      var filter = $('lib-filter');
      if (filter) {
        filter.addEventListener('input', function () {
          S.filter = filter.value;
          var grid = $('lib-grid');
          if (grid) {
            var list = libraryList();
            grid.innerHTML = list.length ? list.map(cardHtml).join('') : '<p class="muted" style="grid-column:1/-1">Nenhuma faixa encontrada.</p>';
            AC.hydrateIcons(grid);
          }
          var count = $('lib-count');
          if (count) count.textContent = String(libraryList().length);
        });
      }
    }
  };

  AC.onTrackChange = function () {
    AC.renderSidebar();
    AC.renderQueue();
  };

  /* ---------------- boot ---------------- */
  async function boot() {
    AC.hydrateIcons(document);
    var connected = !AC.initConnect || await AC.initConnect();
    if (connected) {
    try {
      var health = await AC.api('/api/health');
      var conn = $('conn-text');
      if (conn) conn.textContent = health.tracks + ' faixas · local';
    } catch (e) {}
    try { await AC.loadLibrary({ silent: true }); } catch (e) { if (e.status !== 401) AC.toast('Servidor indisponível. Inicie com node server.js', 'error'); }
    }
    var restored = false;
    try { restored = AC.restoreLast && AC.restoreLast(); } catch (e) {}
    render();
    if (restored) AC.toast('Retome de onde parou — toque em play.');

    var form = $('search-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = $('search-input');
        doSearch(input ? input.value : '');
      });
    }
    var scrim = $('scrim');
    if (scrim) scrim.addEventListener('click', function () { AC.closeModals(); });
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.sidebar') && window.innerWidth <= 900) {
        if (e.target.closest('[data-action="nav"]')) document.body.classList.remove('nav-open');
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
