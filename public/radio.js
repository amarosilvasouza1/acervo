(function () {
  'use strict';
  var AC = window.AC;
  var S = AC.state;
  var esc = AC.esc;
  var icon = AC.icon;
  var request = null;
  var debounce = null;
  var serial = 0;
  var R = AC.radioState = {
    mode: 'recent', seedId: '', query: '', seeds: [], results: [],
    loading: false, ran: false, paused: false, error: '', warnings: [], status: '', updatedAt: null
  };
  function $(id) { return document.getElementById(id); }

  function resultHtml(item) {
    var track = S.tracks.find(function (t) { return t.videoId === item.videoId; });
    var actions = track
      ? '<button class="btn btn-light btn-sm" data-action="play-track" data-id="' + esc(track.id) + '">' + icon('play', 14) + ' Ouvir</button>'
      : AC.jobMarkup(item.videoId);
    var job = S.jobs[item.videoId];
    var canListen = !track && (!job || job.status === 'error');
    return '<div class="result radio-result">' +
      '<div class="result-thumb"><img src="' + esc(item.thumbnail) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></div>' +
      '<div class="result-body"><div class="result-title">' + esc(item.title) + '</div>' +
      '<div class="result-sub"><span>' + esc(item.channel || item.sourceArtist || '') + '</span>' +
        (item.duration ? '<span>' + AC.fmtTime(item.duration) + '</span>' : '') + '</div>' +
      '<div class="radio-because">' + icon('sparkles', 12) + esc(item.because || 'A partir da sua referência') + '</div></div>' +
      '<div class="result-actions"><span data-job-slot="' + esc(item.videoId) + '">' + actions + '</span>' +
      (canListen ? '<button class="icon-btn" data-action="radio-listen" data-video-id="' + esc(item.videoId) + '" aria-label="Baixar e ouvir ' + esc(item.title) + '" title="Baixar e ouvir">' + icon('play', 18) + '</button>' : '') +
      '<a class="icon-btn" href="https://www.youtube.com/watch?v=' + encodeURIComponent(item.videoId) + '" target="_blank" rel="noopener noreferrer" aria-label="Abrir ' + esc(item.title) + ' no YouTube" title="Abrir no YouTube">' + icon('arrow', 16) + '</a></div></div>';
  }

  function resultsHtml() {
    if (R.results.length) return R.results.map(resultHtml).join('');
    if (R.loading) return '<div class="radio-searching"><span class="radio-search-spinner" aria-hidden="true"></span><h2>Encontrando seu próximo som</h2><p>As músicas aparecem aqui conforme as buscas terminam.</p></div>';
    if (R.error) return '<div class="empty"><div class="empty-mark">' + icon('radio', 25) + '</div><h2>Vamos escolher uma referência</h2><p>' + esc(R.error) + '</p><button class="btn btn-ghost" data-action="radio-refresh">Tentar de novo</button></div>';
    if (R.ran) return '<div class="empty"><h2>Nenhuma descoberta desta vez</h2><p>Tente outra faixa ou artista, ou atualize a busca para procurar novamente.</p></div>';
    return '<div class="empty"><div class="empty-mark">' + icon('sparkles', 25) + '</div><h2>O próximo som tem a sua cara</h2><p>Use o que você ouviu recentemente, escolha uma faixa do acervo ou digite uma música ou artista.</p></div>';
  }

  AC.radioView = function () {
    var seed = (R.mode === 'seed' ? AC.trackById(R.seedId) : null) || R.seeds[0] || null;
    var art = seed && (seed.hasCover || seed.thumbnail) ? AC.coverHtml(seed, true) : icon('radio', 76);
    var modes = [['recent', 'Ouvidas recentemente'], ['seed', 'Uma faixa do acervo'], ['query', 'Música ou artista']].map(function (mode) {
      return '<button class="chip' + (R.mode === mode[0] ? ' is-active' : '') + '" data-action="radio-mode" data-mode="' + mode[0] + '" aria-pressed="' + (R.mode === mode[0]) + '">' + mode[1] + '</button>';
    }).join('');
    var reference = '';
    if (R.mode === 'recent') reference = '<p class="radio-reference-help">Uma seleção que acompanha o que você tem ouvido. Cada nova escuta ajuda a encontrar outras músicas.</p>';
    if (R.mode === 'seed') {
      reference = S.tracks.length
        ? '<label for="radio-seed-select" class="radio-field-label">Começar a partir de</label><select class="seed-select" id="radio-seed-select"><option value="">Escolha uma faixa…</option>' + S.tracks.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === R.seedId ? ' selected' : '') + '>' + esc(t.title + ' — ' + t.artist) + '</option>'; }).join('') + '</select>'
        : '<p class="radio-reference-help">Seu acervo ainda está vazio. Use “Música ou artista” para descobrir músicas agora.</p>';
    }
    if (R.mode === 'query') reference = '<form id="radio-query-form" class="radio-query-form" role="search"><label for="radio-query" class="radio-field-label">Qual som você tem em mente?</label><div class="radio-query-field">' + icon('search', 20) + '<input id="radio-query" type="search" minlength="2" maxlength="160" placeholder="Nome de uma música ou artista…" value="' + esc(R.query) + '" autocomplete="off"><button class="btn btn-light btn-sm" type="submit">Buscar</button></div><p class="radio-reference-help">As sugestões são atualizadas enquanto você digita.</p></form>';
    return '<div class="view radio-page"><section class="radio-masthead"><div class="radio-art" id="radio-art">' + art + '</div><div class="radio-heading"><span class="radio-kicker">DESCOBERTAS PARA VOCÊ</span><h1>Sua rádio, do seu jeito.</h1><p>Comece com um som que você gosta.<br>Encontre outros que combinam com ele.</p><span class="pill pill-accent">' + icon('sparkles', 13) + ' Busca ao vivo no YouTube</span></div></section>' +
      '<section class="radio-controls" aria-label="Referência da rádio"><div class="radio-modes chips">' + modes + '</div><div class="radio-reference">' + reference + '</div>' +
      '<div class="radio-toolbar"><div id="radio-status" role="status" aria-live="polite"><span class="radio-live-dot"></span><span id="radio-status-text"></span></div><div class="radio-toolbar-actions"><button class="btn btn-ghost btn-sm" data-action="radio-refresh">' + icon('shuffle', 14) + ' Atualizar</button><button class="btn btn-quiet btn-sm" id="radio-stop" data-action="radio-stop">Parar busca</button></div></div>' +
      '<div id="radio-seeds" class="radio-seeds"></div></section>' +
      '<section class="section radio-discoveries"><div class="section-head radio-results-head"><h2>Na sua frequência</h2><span id="radio-result-count" class="tiny"></span></div><p class="radio-disclosure">Sugestões por música, artista e referências relacionadas. Baixe uma faixa para ouvir no Acervo ou abra no YouTube.</p><div class="result-list" id="radio-results"></div><p id="radio-warning" class="tiny" role="status"></p></section></div>';
  };

  function paint() {
    if (S.view !== 'radio') return;
    var art = $('radio-art');
    var seed = (R.mode === 'seed' ? AC.trackById(R.seedId) : null) || R.seeds[0];
    if (art) art.innerHTML = seed && (seed.hasCover || seed.thumbnail) ? AC.coverHtml(seed, true) : icon('radio', 76);
    var status = $('radio-status-text');
    if (status) status.textContent = R.status || (R.loading ? 'Buscando músicas relacionadas…' : 'Pronta para descobrir');
    var statusWrap = $('radio-status');
    if (statusWrap) statusWrap.classList.toggle('is-searching', R.loading);
    var count = $('radio-result-count');
    if (count) count.textContent = R.results.length ? R.results.length + ' descobertas' : '';
    var stop = $('radio-stop');
    if (stop) stop.hidden = !R.loading;
    var seeds = $('radio-seeds');
    if (seeds) seeds.innerHTML = R.seeds.map(function (t) {
      return '<span class="radio-seed"><span class="radio-seed-cover">' + AC.coverHtml(t) + '</span><span><b>' + esc(t.title) + '</b><small>' + esc(t.artist) + '</small></span></span>';
    }).join('');
    var results = $('radio-results');
    if (results) { results.innerHTML = resultsHtml(); AC.hydrateIcons(results); }
    var warning = $('radio-warning');
    if (warning) warning.textContent = R.warnings.length ? 'Algumas fontes não responderam. Você pode atualizar para tentar novamente.' : '';
  }
  AC.paintRadio = paint;

  function cancel() {
    clearTimeout(debounce);
    serial++;
    if (request) request.abort();
    request = null;
    R.loading = false;
  }

  AC.searchRadio = async function (append) {
    cancel();
    R.paused = false;
    if (!append) { R.results = []; R.seeds = []; R.error = ''; R.warnings = []; }
    var payload = { limit: 18, excludeIds: append ? R.results.map(function (r) { return r.videoId; }) : [] };
    if (R.mode === 'seed') {
      if (!R.seedId) { R.status = 'Escolha uma faixa para começar.'; paint(); return; }
      payload.seedId = R.seedId;
    } else if (R.mode === 'query') {
      if (R.query.trim().length < 2) { R.status = 'Digite uma música ou artista.'; paint(); return; }
      payload.query = R.query.trim();
    }
    R.error = ''; R.warnings = []; R.loading = true; R.ran = true;
    R.status = 'Procurando músicas que combinam com você…';
    paint();
    var currentSerial = serial;
    var controller = request = new AbortController();
    var finished = false;
    function event(name, data) {
      if (serial !== currentSerial) return;
      if (name === 'start') R.seeds = data.seeds || [];
      if (name === 'status') { R.status = data.message || R.status; if (data.seeds) R.seeds = data.seeds; }
      if (name === 'results') {
        var known = new Set(R.results.map(function (r) { return r.videoId; }));
        (data.items || []).forEach(function (r) { if (r.videoId && !known.has(r.videoId)) { R.results.push(r); known.add(r.videoId); } });
        R.status = 'Novas músicas encontradas. Continuando a busca…';
      }
      if (name === 'error') R.error = data.message || 'Não foi possível buscar agora.';
      if (name === 'done') {
        finished = true; R.loading = false; R.warnings = data.warnings || []; R.updatedAt = Date.now();
        R.status = R.error && !R.results.length ? R.error : R.results.length + ' descobertas · busca atualizada agora';
      }
      paint();
    }
    try {
      var response = await fetch('/api/radio', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(payload), signal: controller.signal });
      if (!response.ok) { var error = await response.json().catch(function () { return {}; }); throw new Error(error.error || 'Não foi possível iniciar a rádio.'); }
      if (!response.body) throw new Error('Seu navegador não oferece busca ao vivo.');
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      while (true) {
        var part = await reader.read();
        buffer = (buffer + decoder.decode(part.value, { stream: !part.done })).replace(/\r\n/g, '\n');
        var boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          var frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          var name = 'message', lines = [];
          frame.split('\n').forEach(function (line) { if (line.indexOf('event:') === 0) name = line.slice(6).trim(); if (line.indexOf('data:') === 0) lines.push(line.slice(5).trimStart()); });
          if (lines.length) event(name, JSON.parse(lines.join('\n')));
        }
        if (part.done) break;
      }
      if (!finished && currentSerial === serial) throw new Error('A conexão da busca foi interrompida. Tente atualizar.');
    } catch (err) {
      if (serial !== currentSerial || err.name === 'AbortError') return;
      R.error = err.message; R.status = R.error;
    } finally {
      if (serial === currentSerial) { R.loading = false; request = null; paint(); }
    }
  };

  AC.bindRadio = function () {
    paint();
    var form = $('radio-query-form');
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); AC.searchRadio(); });
    var query = $('radio-query');
    if (query) query.addEventListener('input', function () {
      R.query = query.value; cancel(); R.results = []; R.error = ''; R.seeds = []; R.ran = false;
      R.status = R.query.trim().length >= 2 ? 'Preparando a busca…' : 'Digite uma música ou artista.';
      paint();
      if (R.query.trim().length >= 2) debounce = setTimeout(function () { AC.searchRadio(); }, 700);
    });
    var seed = $('radio-seed-select');
    if (seed) seed.addEventListener('change', function () { R.seedId = seed.value; AC.searchRadio(); });
    if (!R.ran && !R.paused && (R.mode === 'recent' || (R.mode === 'seed' && R.seedId) || (R.mode === 'query' && R.query.trim().length >= 2))) AC.searchRadio();
  };

  AC.radioMode = function (mode) {
    if (['recent', 'seed', 'query'].indexOf(mode) === -1) return;
    cancel(); R.mode = mode; R.results = []; R.seeds = []; R.error = ''; R.ran = false; R.paused = false; R.status = ''; R.updatedAt = null;
    if (mode === 'seed' && !R.seedId) R.seedId = (S.current && S.current.id) || (S.tracks[0] && S.tracks[0].id) || '';
    AC.render();
    if (mode === 'query') { var input = $('radio-query'); if (input) input.focus(); }
  };

  AC.startLiveRadio = function (id) {
    AC.closeModals();
    if (id) { R.mode = 'seed'; R.seedId = id; }
    else { R.mode = 'recent'; R.seedId = ''; }
    S.view = 'radio'; R.ran = true;
    AC.render(); AC.searchRadio();
  };
  AC.stopRadioSearch = function () { cancel(); R.paused = true; R.status = 'Busca pausada. Suas descobertas continuam aqui.'; paint(); };
  AC.leaveRadio = function () { var interrupted = R.loading; cancel(); if (interrupted) R.ran = false; };
  AC.onListen = function () {
    if (typeof AC.renderSidebar === 'function') AC.renderSidebar();
    if (S.view === 'radio' && R.mode === 'recent' && !R.paused) AC.searchRadio();
  };
  AC.listenDiscovery = async function (videoId) {
    var item = R.results.find(function (r) { return r.videoId === videoId; });
    if (!item) return;
    var track = S.tracks.find(function (t) { return t.videoId === videoId; });
    if (track) { AC.play(track.id); return; }
    var existing = S.jobs[videoId];
    if (existing && existing.status !== 'error' && existing.status !== 'done') { S.playAfterImport = videoId; AC.toast('A faixa vai tocar assim que o download terminar.'); return; }
    S.playAfterImport = videoId;
    var job = await AC.startImport({ videoId: videoId, meta: item });
    if (!job && S.playAfterImport === videoId) S.playAfterImport = null;
    paint();
  };
  setInterval(function () { if (S.view === 'radio' && R.mode === 'recent' && !R.loading && !R.paused && R.updatedAt && Date.now() - R.updatedAt >= 90000) AC.searchRadio(); }, 15000);
})();
