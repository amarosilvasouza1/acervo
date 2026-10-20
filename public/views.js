(function () {
  'use strict';

  var AC = window.AC;
  var S = AC.state;
  var esc = AC.esc;
  var icon = AC.icon;
  var NEWS_VERSION = '1.5.9';
  var NEWS = [
    ['Capas sem faixas pretas', 'As bordas horizontais são detectadas e removidas na exibição quando há confiança no recorte, inclusive nas capas offline do Android. As imagens originais são preservadas.'],
    ['Artistas e player com mais conteúdo', 'Foto em destaque, músicas populares, discografia e sua coleção na página do artista. O player reúne capa grande, perfil do artista e próximas músicas.'],
    ['Downloads com menos espera', 'O PC reutiliza metadados do download e preenche as duas vagas da playlist. No Android, fontes compatíveis usam dois leitores por partes, com validação antes de salvar.'],
    ['Conexões reaproveitadas', 'O APK reutiliza conexões seguras ao carregar capas e dados do PC. O encaminhamento também atende mais pedidos simultâneos para reduzir a espera ao abrir a página.'],
    ['Início direto no Android', 'O aplicativo lembra o último modo usado. Depois de conectar ao PC, abre direto no Início; o QR fica em Conexões.'],
    ['Offline com o mesmo estilo', 'As abas, os cartões de músicas, as listas e o player seguem os mesmos padrões do modo conectado. As capas disponíveis também ficam salvas no celular.'],
    ['QR novo a cada convite', 'Cada convite usa aleatoriedade criptográfica, vale cinco minutos e só pode ser usado uma vez. Gerar outro invalida o anterior imediatamente.'],
    ['Conectar pela internet', 'Em Dispositivos no PC, ative o encaminhamento criptografado e confira a verificação do endereço público. O celular usa o APK sem instalar Tailscale.'],
    ['Músicas completas e identificadas', 'Corrigido o corte de áudio perto de 44 segundos no APK conectado ao PC. Título e artista da busca são preservados no download e na sincronização.'],
    ['Somente seu celular', 'O PC e o celular verificam a identidade um do outro. Apenas um telefone fica autorizado; remover esse aparelho no PC encerra o acesso.'],
    ['Chaves ficam nos aparelhos', 'O QR leva um convite de uso único e a identidade pública do PC. A chave privada do telefone fica protegida pelo Android. Compare os dois códigos em Proteção.'],
    ['APK com o mesmo visual', 'Início, busca, biblioteca e rádio em abas inferiores, mini player e player expandido. As músicas e capas salvas continuam disponíveis offline.'],
    ['Conexão criptografada', 'O QR code do PC agora leva a identidade do computador. O APK verifica essa chave para proteger biblioteca, controles, rádio e áudio durante a conexão.'],
    ['Confira a identidade', 'Abra Proteção no APK e compare o código com o QR no PC. Conexões locais antigas por HTTP precisam de um novo pareamento seguro.'],
    ['Web em tela inteira', 'Navegação mais simples, atalhos para ouvir e biblioteca em lista. A versão Web aproveita a tela do seu navegador.'],
    ['Tela desligada', 'No APK 1.3.2 a música continua com a tela apagada: o serviço segura CPU e Wi-Fi e mantém a notificação ativa.'],
    ['Notificação no modo conectado', 'Play, pausa e próxima também aparecem quando o som vem do Acervo no PC, não só no modo independente.'],
    ['Músicas no celular', 'Salve uma faixa ou a biblioteca inteira em MP3 e ouça em Ouvir offline, mesmo sem PC e sem internet.'],
    ['Sincronizar mais rápido', 'Ao sincronizar, o celular copia os MP3 que já estão no PC, sem baixar tudo do YouTube de novo.'],
    ['Notificação com capa', 'O player na notificação ganhou capa da faixa e ícones de play/pause no estilo Spotify.'],
    ['Configurações', 'Escolha baixar ao tocar, abrir as músicas salvas se a conexão cair e continuar de onde parou.'],
    ['Playlists do YouTube', 'Cole um link de playlist: todas as faixas entram na fila de download e a playlist fica salva no app/web.'],
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
    return '<section class="news-banner"><div class="news-copy"><span class="pill pill-accent">Novidades ' + NEWS_VERSION + '</span><strong>Mais música, menos espera</strong><p>Downloads otimizados, páginas de artistas mais completas e um novo contexto no player.</p></div><button class="btn btn-light btn-sm" data-action="whats-new">Ver novidades</button><button class="icon-btn" data-action="dismiss-news" aria-label="Dispensar novidades">' + icon('close', 16) + '</button></section>';
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

  function artistLink(name, className) {
    var artist = String(name || '').trim();
    if (!artist) return '<span class="' + (className || '') + '">Artista desconhecido</span>';
    return '<button class="artist-link ' + (className || '') + '" data-action="open-artist" data-artist="' + esc(artist) + '" title="Ver artista: ' + esc(artist) + '">' + esc(artist) + '</button>';
  }

  function cardHtml(t) {
    return '<article class="card" role="button" tabindex="0" data-action="play-track" data-id="' + esc(t.id) + '" aria-label="Tocar ' + esc(t.title) + '">' +
      '<div class="card-cover">' + AC.coverHtml(t) +
        '<button class="card-play" data-action="play-track" data-id="' + esc(t.id) + '" aria-label="Tocar ' + esc(t.title) + '">' + icon('play', 16) + '</button>' +
      '</div>' +
      '<div>' +
        '<div class="card-heading"><div class="card-title" title="' + esc(t.title) + '">' + esc(t.title) + '</div>' +
          '<button class="icon-btn card-details" data-action="open-track" data-id="' + esc(t.id) + '" aria-label="Detalhes de ' + esc(t.title) + '" title="Detalhes da música">' + icon('more', 16) + '</button></div>' +
        artistLink(t.artist, 'card-artist') +
      '</div>' +
    '</article>';
  }

  function rowHtml(t, index) {
    return '<div class="row" role="button" tabindex="0" data-action="play-track" data-id="' + esc(t.id) + '" aria-label="Tocar ' + esc(t.title) + '">' +
      '<span class="idx">' + (index + 1) + '</span>' +
      '<span class="row-main">' +
        '<span class="row-cover">' + AC.coverHtml(t) + '</span>' +
        '<span style="min-width:0"><span class="row-title">' + esc(t.title) + '</span>' + artistLink(t.artist, 'row-artist') + '</span>' +
      '</span>' +
      '<span class="row-meta row-bpm">' + (bpmOf(t) ? bpmOf(t) + ' BPM' : '—') + '</span>' +
      '<span class="row-meta row-lufs">' + lufsText(t) + '</span>' +
      '<span class="row-end"><span class="row-meta">' + AC.fmtTime(t.duration) + '</span>' +
        '<button class="icon-btn row-actions" data-action="open-track" data-id="' + esc(t.id) + '" aria-label="Detalhes de ' + esc(t.title) + '" title="Detalhes da música">' + icon('more', 16) + '</button>' +
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
    var recent = S.tracks.slice().sort(function (a, b) { return new Date(b.addedAt || 0) - new Date(a.addedAt || 0); }).slice(0, 8);
    var listened = S.tracks.filter(function (t) { return t.lastPlayedAt; }).sort(function (a, b) { return new Date(b.lastPlayedAt) - new Date(a.lastPlayedAt); });
    var picks = (listened.length ? listened.concat(recent.filter(function (t) { return !t.lastPlayedAt; })) : recent).slice(0, 8);
    var hour = new Date().getHours();
    var greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    var filters = '<div class="home-filters"><button class="filter-chip is-active" data-action="nav" data-view="home">Tudo</button><button class="filter-chip" data-action="nav" data-view="recommended">Recomendadas</button><button class="filter-chip" data-action="nav" data-view="releases">Novos lançamentos</button><button class="filter-chip" data-action="nav" data-view="recent">Recentes</button><button class="filter-chip" data-action="nav" data-view="playlists">Playlists</button><button class="filter-chip" data-action="nav" data-view="radio">Rádio</button></div>';
    var shortcuts = picks.map(function (t) {
      return '<button class="quick-shortcut" data-action="play-track" data-id="' + esc(t.id) + '" aria-label="Tocar ' + esc(t.title) + '">' +
        '<span class="quick-shortcut-cover">' + AC.coverHtml(t) + '</span><span class="quick-shortcut-title">' + esc(t.title) + '</span><span class="quick-shortcut-play" aria-hidden="true">' + icon('play', 16) + '</span></button>';
    }).join('');
    var radio = '<section class="radio-promo"><span class="radio-promo-icon" aria-hidden="true">' + icon('radio', 25) + '</span><div><h2>Sua próxima descoberta</h2><p>Uma rádio a partir do que você anda ouvindo.</p></div><button class="btn btn-ghost btn-sm" data-action="nav" data-view="radio">Abrir rádio</button></section>';
    return '<div class="view home-view">' + filters +
      '<header class="hero compact"><h1>' + greeting + '</h1><button class="link" data-action="whats-new">Novidades ' + NEWS_VERSION + '</button></header>' +
      (recent.length ? '<div class="quick-shortcuts">' + shortcuts + '</div>' : emptyHome()) +
      (listened.length ? '<section class="section"><div class="section-head"><h2>Ouvidas recentemente</h2><button class="link" data-action="nav" data-view="recent">Mostrar tudo</button></div><div class="grid track-rail">' + listened.slice(0, 8).map(cardHtml).join('') + '</div></section>' : '') +
      (recent.length ? '<section class="section"><div class="section-head"><h2>Adicionadas recentemente</h2><button class="link" data-action="nav" data-view="library">Mostrar tudo</button></div><div class="grid track-rail">' + recent.map(cardHtml).join('') + '</div></section>' : '') +
      '<section class="section"><div class="section-head"><h2>Descubra algo novo</h2></div><div class="discovery-shortcuts"><button data-action="nav" data-view="recommended">' + icon('sparkles', 28) + '<span><b>Feitas para você</b><small>Recomendadas a partir do seu som</small></span></button><button data-action="nav" data-view="releases">' + icon('wave', 28) + '<span><b>Novos lançamentos</b><small>Álbuns e singles com data de lançamento</small></span></button></div></section>' + radio + '</div>';
  }

  /* ---------------- search ---------------- */
  function searchResult(r) {
    var savedTrack = S.tracks.find(function (t) { return t.videoId === r.videoId; });
    var action = savedTrack
      ? '<span class="pill pill-accent">' + icon('check', 12) + ' no acervo</span>' +
        '<button class="btn btn-light btn-sm" data-action="play-track" data-id="' + esc(savedTrack.id) + '">' + icon('play', 13) + ' Tocar</button>'
      : null;
    return '<div class="result">' +
      '<div class="result-thumb"><img src="' + esc(r.thumbnail) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></div>' +
      '<div class="result-body">' +
        '<div class="result-title">' + esc(r.title) + '</div>' +
        '<div class="result-sub">' + artistLink(r.channel, '') +
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
    var head = '<div class="view-head"><div><h1>' + (s.q ? 'Resultados para “' + esc(s.q) + '”' : 'Buscar') + '</h1>' +
      '<p class="sub">Encontre uma música, um artista ou cole um link no campo de busca.</p></div>' +
      (s.q ? '<div class="head-actions"><button class="btn btn-ghost btn-sm" data-action="open-download">' + icon('link', 15) + ' Usar link</button></div>' : '') +
    '</div>';

    if (!s.ran) {
      return '<div class="view">' + head +
        (recentSearches.length ? '<section class="section search-history"><div class="section-head"><h2>Buscas recentes</h2></div><div class="chips">' + recentSearches.map(function (q) {
          return '<button class="chip" data-action="search-chip" data-q="' + esc(q) + '">' + esc(q) + '</button>';
        }).join('') + '</div></section>' : '') +
        '<section class="section"><div class="section-head"><h2>O que você quer ouvir?</h2></div><div class="search-browse">' +
          '<button class="browse-tile browse-library" data-action="nav" data-view="library"><span>Sua biblioteca</span>' + icon('library', 38) + '</button>' +
          '<button class="browse-tile browse-radio" data-action="nav" data-view="radio"><span>Descobrir na rádio</span>' + icon('radio', 38) + '</button>' +
        '</div></section></div>';
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
    return '<div class="rows library-rows" id="lib-grid">' + (list.length ? list.map(rowHtml).join('') : '<p class="muted">Nenhuma faixa encontrada para “' + esc(S.filter) + '”.</p>') + '</div>';
  }

  function viewLibrary() {
    var head = '<div class="view-head"><div><h1>Seu acervo</h1>' +
      '<p class="sub"><span id="lib-count">' + libraryList().length + '</span> faixas · <span id="lib-duration">' + AC.fmtDur(libraryList().reduce(function (sum, track) { return sum + (Number(track.duration) || 0); }, 0)) + '</span></p></div>' +
      '<div class="head-actions"><button class="btn btn-ghost" data-action="open-download">' + icon('download', 16) + ' Adicionar faixa</button></div></div>';

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
      '<div class="toolbar library-toolbar">' +
        '<button class="btn btn-accent btn-sm" data-action="play-library" aria-label="Reproduzir músicas desta lista">' + icon('play', 16) + ' Reproduzir</button>' +
        '<div class="chips">' + chips + '</div>' +
        '<label class="local-search" style="margin-left:auto">' + icon('search', 15) +
          '<input id="lib-filter" aria-label="Filtrar biblioteca por título ou artista" placeholder="Filtrar por título ou artista" value="' + esc(S.filter) + '">' +
        '</label>' +
      '</div>' +
      '<div class="table-head" aria-hidden="true"><span>#</span><span>Título</span><span class="row-bpm">BPM</span><span class="row-lufs">Loudness</span><span>' + icon('clock', 14) + '</span></div>' +
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
          artistLink(t.artist, 'sheet-artist') +
          '<div class="sheet-badges">' + bits.join('') + '</div>' +
          '<div class="sheet-actions">' +
            '<button class="btn btn-accent" data-action="play-track" data-id="' + esc(t.id) + '">' + icon('play', 15) + ' Tocar</button>' +
            (window.AcervoAndroid && window.AcervoAndroid.saveOffline ? '<button class="btn btn-ghost" data-action="save-offline" data-id="' + esc(t.id) + '">' + icon('phone', 15) + ' Salvar no celular</button>' : '') +
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

  /* ---------------- playlists e configurações ---------------- */
  function isPlaylistUrl(value) {
    return /[?&]list=/.test(value) || /\/playlist(?:[/?]|$)/.test(value) || /\/track(?:[/?]|$)/.test(value) || /^spotify:(?:playlist|track):/i.test(value);
  }

  function trackForEntry(entry) {
    return S.tracks.find(function (t) { return !!((entry.videoId && (t.videoId === entry.videoId || t.id === entry.videoId)) || (entry.trackId && t.id === entry.trackId)); });
  }

  function viewPlaylists() {
    var list = S.playlists || [];
    var head = '<div class="view-head"><div><h1>Playlists</h1><p class="sub">Traga playlists e músicas do Spotify ou YouTube e acompanhe cada download.</p></div>' +
      '<div class="head-actions"><button class="btn btn-accent btn-sm" data-action="open-download">' + icon('link', 15) + ' Importar playlist</button></div></div>';
    if (!list.length) {
      return '<div class="view">' + head +
        '<div class="empty"><div class="empty-mark">' + icon('queue', 24) + '</div><h2>Suas playlists ficam aqui</h2>' +
        '<p>Cole um link público de playlist ou música do Spotify, um link do YouTube, ou importe um arquivo CSV/JSON. Confira antes de começar e veja quais músicas não puderam ser baixadas.</p>' +
        '<div class="playlist-steps"><span>1. Cole o link</span><span>2. O Acervo baixa</span><span>3. Toque quando quiser</span></div>' +
        '<button class="btn btn-accent" data-action="open-download">Importar uma playlist</button></div></div>';
    }
    var cards = list.map(function (p) {
      var done = p.entries.filter(function (entry) { return !!trackForEntry(entry); }).length;
      var first = p.entries.find(function (entry) { return !!entry.thumbnail; });
      var failed = p.entries.filter(function (entry) { return entry.status === 'error'; }).length;
      return '<article class="card playlist-card" role="button" tabindex="0" data-action="open-playlist" data-id="' + esc(p.id) + '">' +
        '<div class="card-cover">' + (first ? '<img src="' + esc(first.thumbnail) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '<span class="card-cover-fallback"></span>') + '</div>' +
        '<div><div class="card-title">' + esc(p.name) + '</div><div class="tiny">' + done + ' de ' + p.entries.length + ' no acervo' + (failed ? ' · ' + failed + ' com falha' : '') + '</div></div></article>';
    }).join('');
    return '<div class="view">' + head + '<div class="grid">' + cards + '</div></div>';
  }

  function viewPlaylist() {
    var p = (S.playlists || []).find(function (item) { return item.id === S.playlistId; });
    if (!p) {
      return '<div class="view"><div class="empty"><h2>Playlist não encontrada</h2><button class="btn btn-ghost" data-action="nav" data-view="playlists">Voltar</button></div></div>';
    }
    var done = p.entries.filter(function (entry) { return !!trackForEntry(entry); }).length;
    var failed = p.entries.filter(function (entry) { return entry.status === 'error' && !trackForEntry(entry); }).length;
    var active = p.entries.filter(function (entry) { return ['queued', 'matching', 'working'].indexOf(entry.status) !== -1; }).length;
    var rows = p.entries.map(function (entry, index) {
      if (S.playlistOnlyFailed && (entry.status !== 'error' || trackForEntry(entry))) return '';
      var track = trackForEntry(entry);
      if (track) return rowHtml(track, index);
      var error = entry.status === 'error';
      var label = error ? 'Não baixada' : entry.status === 'matching' ? 'Procurando versão' : entry.status === 'working'
        ? (entry.stage || 'Baixando') + (entry.progress > 0 ? ' · ' + entry.progress + '%' : '') : entry.status === 'queued' ? 'Na fila' : 'Pendente';
      return '<div class="row"><span class="idx">' + (index + 1) + '</span>' +
        '<span class="row-main"><span class="row-cover">' + (entry.thumbnail ? '<img src="' + esc(entry.thumbnail) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : icon('music', 20)) + '</span>' +
        '<span style="min-width:0"><span class="row-title">' + esc(entry.title) + '</span><span class="row-artist">' + esc(entry.artist || '') + '</span>' +
        (error ? '<span class="playlist-error">' + esc(entry.error || 'Não foi possível baixar esta música.') + '</span>' : '') + '</span></span>' +
        '<span class="row-end"><span class="pill' + (error ? ' playlist-failed' : '') + '">' + esc(label) + '</span>' +
        (error && entry.errorCode !== 'unsupported' ? '<button class="icon-btn" data-action="playlist-search" data-query="' + esc(entry.title + ' ' + entry.artist) + '" aria-label="Buscar outra versão de ' + esc(entry.title) + '">' + icon('search', 16) + '</button>' : '') + '</span></div>';
    }).join('');
    var source = /^https:\/\/open\.spotify\.com\/playlist\/[A-Za-z0-9]{22}$/.test(p.sourceUrl || '')
      ? '<a class="link" href="' + esc(p.sourceUrl) + '" target="_blank" rel="noopener noreferrer">Ver playlist no Spotify ↗</a>' : '';
    var warnings = (p.warnings || []).map(function (message) { return '<p class="playlist-warning">' + esc(message) + '</p>'; }).join('');
    return '<div class="view"><div class="view-head"><div><button class="link" data-action="nav" data-view="playlists">← Playlists</button><h1>' + esc(p.name) + '</h1>' +
      '<p class="sub" role="status">' + done + ' de ' + p.entries.length + ' já no acervo' + (failed ? ' · ' + failed + ' não baixadas' : '') + (active ? ' · importando' : '') + '</p>' + source + '</div>' +
      '<div class="head-actions"><button class="btn btn-accent btn-sm" data-action="playlist-play" data-id="' + esc(p.id) + '">' + icon('play', 14) + ' Tocar tudo</button><button class="btn btn-quiet btn-sm" data-action="playlist-shuffle" data-id="' + esc(p.id) + '">' + icon('shuffle', 14) + ' Embaralhar</button><button class="btn btn-ghost btn-sm" data-action="refresh-playlist">' + icon('repeat', 14) + ' Atualizar</button>' +
      '<button class="btn btn-ghost btn-sm" data-action="playlist-report" data-id="' + esc(p.id) + '">Relatório</button>' +
      '<button class="btn btn-accent btn-sm" data-action="import-playlist-all" data-id="' + esc(p.id) + '">' + icon('download', 14) + ' Tentar pendentes</button></div></div>' +
      warnings + (p.provider === 'spotify' ? '<p class="tiny playlist-source-note">Títulos e artistas vieram do Spotify. O áudio é procurado no YouTube; uma versão diferente pode estar disponível.</p>' : '') +
      '<div class="home-filters playlist-filters"><button class="filter-chip' + (!S.playlistOnlyFailed ? ' is-active' : '') + '" data-action="playlist-filter" data-failed="false">Todas</button>' +
      '<button class="filter-chip' + (S.playlistOnlyFailed ? ' is-active' : '') + '" data-action="playlist-filter" data-failed="true">Não baixadas (' + failed + ')</button></div>' +
      '<div class="rows playlist-rows">' + (rows || '<p class="empty">Nenhuma música com falha nesta playlist.</p>') + '</div></div>';
  }

  function settingRow(key, title, description) {
    var settings = AC.getSettings();
    return '<label class="setting-row"><span><strong>' + esc(title) + '</strong><small>' + esc(description) + '</small></span>' +
      '<input type="checkbox" data-action="toggle-setting" data-setting="' + key + '"' + (settings[key] ? ' checked' : '') + '></label>';
  }

  function viewSettings() {
    var bridge = !!window.AcervoAndroid;
    return '<div class="view"><div class="view-head"><div><h1>Configurações</h1><p class="sub">Escolha como o Acervo baixa, guarda e retoma suas músicas.</p></div></div>' +
      '<div class="settings-grid">' +
        '<section class="panel"><h3>No celular</h3>' +
          settingRow('autoSave', 'Baixar ao tocar', 'Salva uma cópia no celular sempre que uma faixa começar a tocar. Requer o app Android.') +
          settingRow('offlineFallback', 'Abrir músicas salvas se a conexão cair', 'Se o Acervo não carregar, tenta abrir a biblioteca offline automaticamente.') +
          '<button class="btn btn-ghost" data-action="save-all-offline"' + (bridge ? '' : ' disabled') + '>' + icon('download', 15) + ' Salvar biblioteca agora</button>' +
          (bridge ? '<p class="tiny" style="margin-top:10px">Os arquivos ficam na área privada do app e tocam sem PC.</p>' : '<p class="tiny" style="margin-top:10px">Estas opções de armazenamento aparecem quando o app Android está conectado.</p>') +
        '</section>' +
        '<section class="panel"><h3>Reprodução</h3>' +
          settingRow('resume', 'Continuar de onde parou', 'Restaura a última faixa e a posição ao abrir o app.') +
          '<p class="tiny" style="margin-top:10px">O timer de sono e o aleatório inteligente ficam no player.</p>' +
        '</section>' +
        '<section class="panel"><h3>Sobre</h3>' +
          '<p class="tiny">Acervo ' + NEWS_VERSION + ' · player, biblioteca e conexão entre PC e celular.</p>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">' +
            '<button class="btn btn-ghost btn-sm" data-action="whats-new">' + icon('sparkles', 14) + ' Ver novidades</button>' +
            '<button class="btn btn-quiet btn-sm" data-action="open-offline"' + (bridge ? '' : ' disabled') + '>' + icon('phone', 14) + ' Ouvir offline</button>' +
          '</div>' +
        '</section>' +
      '</div></div>';
  }

  /* ---------------- download modal ---------------- */
  function openDownload() {
    AC.openModal(
      '<div class="modal-head"><div><h2>Adicionar músicas</h2><p>Cole uma playlist ou música do Spotify, um link do YouTube ou o nome de uma música.</p></div>' +
      '<button class="icon-btn modal-close" data-action="close-modal" aria-label="Fechar">' + icon('close', 18) + '</button></div>' +
      '<div class="modal-field">' + icon('link', 18) + '<input id="dl-input" aria-label="Link da playlist ou música" placeholder="Link do Spotify, YouTube ou nome da música" autocomplete="off"></div>' +
      '<p class="modal-hint">Playlists e músicas passam por uma prévia. Você acompanha os downloads e as falhas. O link público do Spotify pode mostrar só parte da lista.</p>' +
      (window.AcervoAndroid ? '<button class="btn btn-ghost playlist-file-button" data-action="playlist-file-native">Importar lista completa por arquivo</button>' : '<label class="playlist-file-label">Importar lista completa por arquivo <input id="playlist-file" type="file" accept=".csv,.json,text/csv,application/json"></label>') +
      '<p class="tiny">CSV: colunas Track Name e Artist Name(s), ou Título e Artista. JSON: arquivo de playlists dos seus dados do Spotify. Até 1000 músicas e 1,5 MB.</p>' +
      '<div class="modal-actions"><button class="btn btn-quiet" data-action="close-modal">Cancelar</button><button class="btn btn-accent" data-action="download-submit">' + icon('download', 16) + ' Baixar</button></div>'
    );
    var file = $('playlist-file');
    if (file) file.addEventListener('change', async function () {
      var selected = file.files && file.files[0];
      if (!selected) return;
      if (selected.size > 1500000) { AC.toast('Use um arquivo de até 1,5 MB.', 'error'); return; }
      try { await previewPlaylist({ fileText: await selected.text(), name: selected.name.replace(/\.(csv|json)$/i, '') }); }
      catch (error) { AC.toast(error.message, 'error'); }
    });
    setTimeout(function () { var i = $('dl-input'); if (i) i.focus(); }, 40);
  }

  async function submitDownload() {
    var input = $('dl-input');
    var value = input ? input.value.trim() : '';
    if (!value) return;
    if (isPlaylistUrl(value)) {
      try { await previewPlaylist({ url: value }); } catch (error) { AC.toast(error.message, 'error'); }
      return;
    }
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

  var previewPayload = null;
  var playlistImporting = false;
  async function previewPlaylist(payload) {
    AC.toast('Lendo do Spotify…');
    var data = await AC.api('/api/playlist/resolve', { method: 'POST', body: JSON.stringify(payload) });
    previewPayload = payload;
    if (data.choices) {
      AC.openModal('<div class="modal-head"><h2>Escolha uma playlist</h2><button class="icon-btn" data-action="close-modal" aria-label="Fechar">' + icon('close', 18) + '</button></div>' +
        '<label class="playlist-file-label">Playlist do arquivo<select id="playlist-file-choice">' + data.choices.map(function (item) {
          return '<option value="' + item.index + '">' + esc(item.name) + ' · ' + item.count + ' músicas</option>';
        }).join('') + '</select></label><div class="modal-actions"><button class="btn btn-accent" data-action="playlist-file-choice">Ver prévia</button></div>');
      return;
    }
    S.playlistPreview = data;
    var warnings = (data.warnings || []).map(function (warning) { return '<p class="playlist-warning">' + esc(warning) + '</p>'; }).join('');
    var sample = data.entries.slice(0, 5).map(function (entry) { return '<li><strong>' + esc(entry.title) + '</strong><span>' + esc(entry.artist) + '</span></li>'; }).join('');
    AC.openModal('<div class="modal-head"><div><h2>' + esc(data.title) + '</h2><p>' + data.entries.length + ' entradas lidas' + (data.total !== null && data.total !== undefined ? ' de ' + data.total : '') + '</p></div>' +
      '<button class="icon-btn" data-action="close-modal" aria-label="Fechar">' + icon('close', 18) + '</button></div>' + warnings +
      '<p class="modal-hint">' + (data.provider === 'spotify' ? 'Vamos buscar versões correspondentes no YouTube e manter os títulos e artistas desta lista. ' : '') + 'Cada música terá seu resultado e motivo em caso de falha.</p>' +
      '<ol class="playlist-preview">' + sample + '</ol>' + (data.entries.length > 5 ? '<p class="tiny">E mais ' + (data.entries.length - 5) + ' entradas.</p>' : '') +
      '<div class="modal-actions"><button class="btn btn-quiet" data-action="open-download">Voltar</button><button class="btn btn-accent" data-action="playlist-preview-import">' + (data.entries.length === 1 ? 'Baixar música' : 'Importar ' + data.entries.length + ' entradas') + '</button></div>');
  }

  async function playlistReport(id) {
    try {
      var data = await AC.api('/api/playlists/' + encodeURIComponent(id) + '/report');
      var lines = [data.name, 'Baixadas: ' + data.summary.done + ' · Não baixadas: ' + data.summary.failed + ' · Em andamento: ' + data.summary.active].concat(data.warnings || []);
      data.entries.forEach(function (entry) { lines.push(entry.position + '. ' + entry.title + ' — ' + entry.artist + ' · ' + ({ done: 'No acervo', error: 'Não baixada', pending: 'Pendente', queued: 'Na fila', matching: 'Procurando versão', working: 'Baixando' }[entry.status] || entry.status) + (entry.reason ? '\n   Motivo: ' + entry.reason : '')); });
      AC.openModal('<div class="modal-head"><h2>Relatório da importação</h2><button class="icon-btn" data-action="close-modal" aria-label="Fechar">' + icon('close', 18) + '</button></div>' +
        '<p class="modal-hint">O resultado fica guardado na playlist. Selecione o texto para copiar.</p><textarea id="playlist-report-text" class="playlist-report" readonly aria-label="Resultado de cada música">' + esc(lines.join('\n')) + '</textarea>' +
        '<div class="modal-actions"><button class="btn btn-accent" data-action="playlist-report-select">Selecionar relatório</button></div>');
    } catch (error) { AC.toast(error.message, 'error'); }
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
  var searchGeneration = 0;
  var searchRequest = null;
  AC.searchCatalog = function (query) { return doSearch(query); };

  async function doSearch(q) {
    var query = String(q || '').trim();
    if (!query) return;
    var generation = ++searchGeneration;
    if (searchRequest) searchRequest.abort();
    searchRequest = typeof AbortController === 'function' ? new AbortController() : null;
    var request = searchRequest;
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
      var data = await AC.api('/api/search?q=' + encodeURIComponent(query), request ? { signal: request.signal } : undefined);
      if (generation !== searchGeneration) return;
      S.search.results = data.results || [];
    } catch (err) {
      if (generation !== searchGeneration) return;
      S.search.error = err.message;
    }
    if (generation !== searchGeneration) return;
    searchRequest = null;
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
      case 'open-playlist': S.playlistId = id; S.playlistOnlyFailed = false; S.view = 'playlist'; render(); return;
      case 'playlist-filter': S.playlistOnlyFailed = el.getAttribute('data-failed') === 'true'; render(); return;
      case 'playlist-search': doSearch(el.getAttribute('data-query')); return;
      case 'playlist-report': playlistReport(id); return;
      case 'playlist-file-native':
        if (typeof window.__acervoChoosePlaylistFile !== 'function') { AC.toast('Atualize o APK para importar arquivos ou use o navegador.', 'error'); return; }
        window.__acervoChoosePlaylistFile().then(function (text) { return previewPlaylist({ fileText: text }); }).catch(function (error) { AC.toast(error.message, 'error'); }); return;
      case 'playlist-report-select': { var report = $('playlist-report-text'); if (report) { report.focus(); report.select(); } return; }
      case 'playlist-file-choice':
        previewPlaylist(Object.assign({}, previewPayload, { playlistIndex: Number($('playlist-file-choice').value) })).catch(function (error) { AC.toast(error.message, 'error'); }); return;
      case 'playlist-preview-import':
        if (playlistImporting || !S.playlistPreview) return;
        playlistImporting = true; el.disabled = true;
        AC.importPlaylist({ previewId: S.playlistPreview.previewId }).then(function () { S.playlistPreview = null; AC.closeModals(); })
          .catch(function () {}).finally(function () { playlistImporting = false; el.disabled = false; }); return;
      case 'refresh-playlist':
        (async function () {
          await AC.loadPlaylists();
          try { await AC.loadLibrary({ silent: true }); } catch (e) {}
          render();
        })();
        return;
      case 'import-playlist-all':
        (async function () {
          AC.toast('Enfileirando as faixas da playlist…');
          try {
            var result = await AC.api('/api/playlists/' + encodeURIComponent(id) + '/import', { method: 'POST' });
            await AC.loadPlaylists();
            render();
            AC.toast(result.total + ' músicas na fila.');
          } catch (error) { AC.toast(error.message, 'error'); }
        })();
        return;
      case 'toggle-setting': {
        // The change listener persists the final native checkbox state.
        return false;
      }
      case 'save-offline': {
        var track = AC.trackById(id);
        if (track && window.AcervoAndroid && window.AcervoAndroid.saveOffline) {
          window.AcervoAndroid.saveOffline(track.id, track.title, track.artist, Math.round(track.duration || 0));
          AC.toast('Salvando no celular…');
        }
        return;
      }
      case 'open-offline':
        if (window.AcervoAndroid && window.AcervoAndroid.openOffline) window.AcervoAndroid.openOffline();
        return;
      case 'save-all-offline':
        if (window.AcervoAndroid && window.AcervoAndroid.saveAllOffline && S.tracks.length) {
          var payload = JSON.stringify(S.tracks.map(function (t) {
            return { id: t.id, title: t.title, artist: t.artist, duration: Math.round(t.duration || 0) };
          }));
          window.AcervoAndroid.saveAllOffline(payload);
          AC.toast('Salvando ' + S.tracks.length + ' músicas no celular…');
        }
        return;
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
      case 'play-library': {
        var visible = libraryList();
        if (visible.length) {
          if (S.shuffle) AC.setShuffle(false);
          S.queue = visible.map(function (track) { return track.id; });
          AC.play(visible[0].id);
        }
        return;
      }
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
      var active = el.getAttribute('data-view') === S.view || (el.getAttribute('data-view') === 'recommended' && (S.view === 'explore' || S.view === 'artist'));
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
      return '<div role="button" tabindex="0" class="sidebar-track' + (current ? ' is-current' : '') + '" data-action="play-track" data-id="' + esc(t.id) + '" aria-label="Ouvir ' + esc(t.title) + '"><span class="sidebar-cover">' + AC.coverHtml(t) + '</span><span class="sidebar-track-copy"><span class="sidebar-track-title">' + esc(t.title) + '</span>' + artistLink(t.artist, 'sidebar-track-sub') + '</span>' + (current && S.playing ? icon('wave', 16) : '') + '</div>';
    }).join('') || '<p class="tiny sidebar-empty">As músicas que você adicionar aparecem aqui.</p>';
  };

  var playlistTimer = null;
  var playlistPolling = false;

  function render() { AC.render(); }

  AC.go = function (view) {
    if (['recommended', 'releases', 'recent'].includes(view)) {
      S.exploreSection = view;
      view = 'explore';
    }
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
    if (AC.leaveExplore && ['explore', 'artist'].includes(S.renderedView) && S.view !== S.renderedView) AC.leaveExplore();
    S.renderedView = S.view;
    var html = '';
    if (S.view === 'home') main.setAttribute('aria-label', 'Início');
    else main.setAttribute('aria-label', ({ radio: 'Sua rádio', library: 'Seu acervo', artist: 'Página do artista', explore: 'Explorar músicas', playlists: 'Playlists', settings: 'Configurações' })[S.view] || 'Buscar músicas');
    if (S.view === 'home') html = viewHome();
    else if (S.view === 'search') html = viewSearch();
    else if (S.view === 'library') html = viewLibrary();
    else if (S.view === 'radio') html = viewRadio();
    else if (S.view === 'playlists') html = viewPlaylists();
    else if (S.view === 'playlist') html = viewPlaylist();
    else if (S.view === 'settings') html = viewSettings();
    else if (S.view === 'explore' && AC.exploreView) html = AC.exploreView(S.exploreSection || 'recommended');
    else if (S.view === 'artist' && AC.artistView) html = AC.artistView();
    else html = viewHome();
    main.innerHTML = html;
    AC.hydrateIcons(main);
    updateNav();
    AC.renderSidebar();
    if (S.view === 'radio') AC.bindRadio();
    if (S.view === 'explore' && AC.mountExplore) AC.mountExplore(S.exploreSection || 'recommended');
    if (S.view === 'artist' && AC.mountArtist) AC.mountArtist(S.artistName);
    var activePlaylist = S.view === 'playlist' && (S.playlists || []).find(function (item) { return item.id === S.playlistId; });
    if (activePlaylist && activePlaylist.entries.some(function (entry) { return ['queued', 'matching', 'working'].indexOf(entry.status) !== -1; })) {
      if (!playlistTimer) {
        playlistTimer = setInterval(function () {
          if (playlistPolling || document.visibilityState === 'hidden') return;
          playlistPolling = true;
          AC.loadPlaylists().then(function () { return AC.loadLibrary({ silent: true }); }).then(function () {
            if (S.view === 'playlist') render();
          }).catch(function () {}).finally(function () { playlistPolling = false; });
        }, 4000);
      }
    } else if (playlistTimer) {
      clearInterval(playlistTimer);
      playlistTimer = null;
    }
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
            grid.innerHTML = list.length ? list.map(rowHtml).join('') : '<p class="muted">Nenhuma faixa encontrada.</p>';
            AC.hydrateIcons(grid);
          }
          var count = $('lib-count');
          if (count) count.textContent = String(libraryList().length);
          var duration = $('lib-duration');
          if (duration) duration.textContent = AC.fmtDur(libraryList().reduce(function (sum, track) { return sum + (Number(track.duration) || 0); }, 0));
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
    if (window.AcervoAndroid) {
      var offlineLink = $('offline-link'); if (offlineLink) offlineLink.hidden = false;
      var saveAllLink = $('save-all-link'); if (saveAllLink) saveAllLink.hidden = false;
    }
    var connected = !AC.initConnect || await AC.initConnect();
    if (connected) {
    try {
      var health = await AC.api('/api/health');
      var conn = $('conn-text');
      if (conn) conn.textContent = health.tracks + ' faixas · local';
    } catch (e) {}
    try { await AC.loadLibrary({ silent: true }); } catch (e) { if (e.status !== 401) AC.toast('Servidor indisponível. Inicie com node server.js', 'error'); }
    try { await AC.loadPlaylists(); } catch (e) {}
    }
    AC.syncNativeSettings();
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
    document.addEventListener('change', function (e) {
      var target = e.target;
      if (target && target.getAttribute && target.getAttribute('data-setting')) {
        AC.setSetting(target.getAttribute('data-setting'), target.checked);
      }
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.sidebar') && window.innerWidth <= 900) {
        if (e.target.closest('[data-action="nav"]')) document.body.classList.remove('nav-open');
      }
    });
  }


  function playPlaylist(id, shuffle) {
    var playlist = (S.playlists || []).find(function (item) { return item.id === id; });
    if (!playlist) return;
    var ids = playlist.entries.map(trackForEntry).filter(Boolean).map(function (track) { return track.id; });
    if (!ids.length) { AC.toast('Ainda não há músicas baixadas nesta playlist.', 'error'); return; }
    if (shuffle) ids.sort(function () { return Math.random() - 0.5; });
    AC.playQueue(ids);
  }
  AC.playerActions['playlist-play'] = function (element) { playPlaylist(element.getAttribute('data-id'), false); };
  AC.playerActions['playlist-shuffle'] = function (element) { playPlaylist(element.getAttribute('data-id'), true); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
