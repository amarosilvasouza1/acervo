(function () {
  'use strict';
  var AC = window.AC;
  var S = AC.state;
  var audio = document.getElementById('audio');
  var esc = AC.esc;
  var icon = AC.icon;
  var C = AC.connect = {
    ready: false, connected: false, local: false, admin: false, cloud: false, configured: false, security: null, deviceId: null, devices: [], playback: null,
    receivedAt: 0, applying: false, dialog: null, pairing: null, candidate: 0, needsGesture: false
  };
  var events = null;
  var initialized = null;
  var lastPublished = 0;
  var sending = false;
  var pendingPublish = false;
  var seenCommands = new Set();
  var refreshingLibrary = null;
  var commandQueue = Promise.resolve();
  var restoring = Promise.resolve();
  function $(id) { return document.getElementById(id); }
  function kind() { return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '') ? 'mobile' : 'desktop'; }
  function deviceName() { return kind() === 'mobile' ? 'Meu celular' : 'Meu computador'; }
  function device(id) { return C.devices.find(function (item) { return item.id === id; }); }
  function activeName() { var active = C.playback && device(C.playback.activeDeviceId); return active ? active.name : 'um dispositivo'; }
  function activeHere() { return C.ready && C.playback && C.playback.activeDeviceId === C.deviceId; }
  function canManage() { return C.local || C.admin; }
  function connectionPrompt() { return C.cloud ? 'Entre com a senha do seu Acervo ou use um código criado em um dispositivo já conectado.' : 'No computador, abra Dispositivos e escaneie o QR code com a câmera do celular.'; }

  async function api(path, body, method) {
    var headers = { 'Content-Type': 'application/json' };
    if (C.local && C.deviceId) headers['X-Acervo-Device'] = C.deviceId;
    var response = await fetch(path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: headers,
      credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) { var err = new Error(data.error || 'Não foi possível conectar agora.'); err.status = response.status; throw err; }
    return data;
  }

  AC.isRemotePlayback = function () { return Boolean(C.ready && C.playback && C.playback.activeDeviceId !== C.deviceId); };
  AC.remotePosition = function () {
    if (!C.playback) return 0;
    var progress = C.playback.position || 0;
    if (C.playback.playing) progress += Math.max(0, Date.now() - C.receivedAt) / 1000;
    return Math.min(S.current ? S.current.duration : progress, progress);
  };
  AC.syncCommand = function (type, args) {
    if (C.applying || !C.ready || !C.playback || C.playback.activeDeviceId === C.deviceId) return false;
    if (!C.connected) { AC.toast(C.cloud ? 'A conexão com seu Acervo caiu. Aguarde a reconexão.' : 'A conexão com o computador caiu. Aguarde a reconexão.', 'error'); return true; }
    if (!C.playback.activeDeviceId) { AC.toast('Escolha onde ouvir em Dispositivos.'); AC.openDevices(); return true; }
    api('/api/connect/command', { type: type, args: args || {} }).catch(function (err) { AC.toast(err.message, 'error'); });
    return true;
  };

  AC.notifyPlayback = function (force) {
    if (!activeHere() || C.applying) return;
    if (!force && Date.now() - lastPublished < 1500) return;
    if (sending) { pendingPublish = true; return; }
    sending = true; lastPublished = Date.now();
    var snapshot = AC.playbackSnapshot();
    api('/api/connect/state', snapshot).then(function (data) {
      if (data.playback) acceptPlayback(data.playback);
    }).catch(function (err) {
      if (err.status === 409 || err.status === 403) refreshInfo();
    }).finally(function () {
      sending = false;
      if (pendingPublish) { pendingPublish = false; AC.notifyPlayback(true); }
    });
  };

  function acceptPlayback(playback) {
    if (!playback || (C.playback && Number(playback.revision) < Number(C.playback.revision))) return;
    var previous = C.playback && C.playback.activeDeviceId;
    var wasHere = previous === C.deviceId;
    var isHere = playback.activeDeviceId === C.deviceId;
    C.playback = playback; C.receivedAt = Date.now();
    if (wasHere && !isHere) { audio.pause(); C.needsGesture = false; }
    if (!isHere) {
      AC.applyRemotePlayback(playback);
    } else if (previous !== C.deviceId && playback.trackId) {
      C.applying = true;
      restoring = Promise.resolve(ensureTrack(playback.trackId)).then(function () { if (activeHere()) return AC.restorePlayback(playback); })
        .catch(function (err) { AC.toast(err.message, 'error'); })
        .finally(function () { C.applying = false; AC.notifyPlayback(true); });
    }
    paintConnection();
  }

  async function ensureTrack(trackId) {
    if (trackId && !AC.trackById(trackId)) await refreshLibrary();
  }
  function refreshLibrary() {
    if (refreshingLibrary) return refreshingLibrary;
    refreshingLibrary = AC.loadLibrary({ silent: true }).then(function () {
      if (!C.ready) return;
      if (AC.isRemotePlayback()) AC.applyRemotePlayback(C.playback);
      if (S.view === 'library' || S.view === 'home') AC.render();
    }).finally(function () { refreshingLibrary = null; });
    return refreshingLibrary;
  }
  AC.onLibraryLoaded = function () {
    if (AC.isRemotePlayback()) AC.applyRemotePlayback(C.playback);
  };

  async function applyCommand(command) {
    if (!command || command.targetDeviceId !== C.deviceId || seenCommands.has(command.id)) return;
    seenCommands.add(command.id);
    if (seenCommands.size > 250) seenCommands.delete(seenCommands.values().next().value);
    // The preceding state event owns a handoff. Do not restart it a second time.
    if (command.type === 'transfer' || !activeHere()) return;
    await restoring;
    if (!activeHere()) return;
    C.applying = true;
    try {
      var args = command.args || {};
      if (command.type === 'play') {
        await ensureTrack(args.trackId);
        if (args.queue) S.queue = args.queue.slice();
        if (args.trackId) AC.play(args.trackId, { localOnly: true });
        else if (!S.playing) AC.toggle();
      } else if (command.type === 'pause') { audio.pause(); S.playing = false; }
      else if (command.type === 'toggle') AC.toggle();
      else if (command.type === 'next') AC.next(false);
      else if (command.type === 'previous') AC.prev();
      else if (command.type === 'seek' && S.current) AC.seekRatio(args.position / S.current.duration);
      else if (command.type === 'volume') AC.setVolume(args.volume);
      else if (command.type === 'shuffle') { S.shuffle = args.shuffle; }
      else if (command.type === 'repeat') { S.repeat = args.repeat; }
      AC.paintPlayback();
    } finally { C.applying = false; AC.notifyPlayback(true); }
  }

  function acceptSnapshot(snapshot) {
    var previousIds = new Set(C.devices.map(function (item) { return item.id; }));
    if (C.pairing && (snapshot.devices || []).some(function (item) { return !item.local && !previousIds.has(item.id); })) C.pairing = null;
    C.local = Boolean(snapshot.local); C.admin = Boolean(snapshot.admin);
    if (typeof snapshot.cloud === 'boolean') C.cloud = snapshot.cloud;
    C.deviceId = snapshot.deviceId || C.deviceId;
    C.devices = snapshot.devices || C.devices; C.ready = Boolean(C.deviceId);
    if (snapshot.playback) acceptPlayback(snapshot.playback);
    paintConnection();
  }
  async function refreshInfo() {
    try { acceptSnapshot(await api('/api/connect/info')); }
    catch (err) { if (err.status === 401) revoke(); }
  }
  function revoke(message) {
    C.ready = false; C.connected = false; C.needsGesture = false; C.admin = false;
    C.deviceId = null; C.devices = []; C.playback = null; C.pairing = null;
    S.authEpoch = (S.authEpoch || 0) + 1;
    if (events) { events.close(); events = null; }
    if (AC.leaveRadio) AC.leaveRadio();
    audio.pause(); S.playing = false; S.current = null; S.queue = []; S.tracks = []; S.jobs = {};
    S.view = 'home'; S.stats = { tracks: 0, artists: 0, duration: 0, plays: 0, avgLufs: null };
    AC.paintPlayback(); AC.render(); paintConnection();
    showPairingRequired(typeof message === 'string' ? message : C.cloud ? 'Sua sessão foi encerrada. Entre novamente ou use um novo QR code.' : 'A conexão foi encerrada. Escaneie um novo QR code no computador.');
  }
  function listen() {
    if (events) events.close();
    events = new EventSource('/api/connect/events' + (C.local ? '?deviceId=' + encodeURIComponent(C.deviceId) : ''));
    var stream = events;
    events.onopen = function () { if (stream !== events) return; C.connected = true; paintConnection(); if (activeHere()) AC.notifyPlayback(true); };
    events.onerror = function () { if (stream !== events) return; C.connected = false; paintConnection(); };
    function on(name, callback) {
      events.addEventListener(name, function (message) {
        if (stream !== events) return;
        try { callback(JSON.parse(message.data)); } catch (err) { console.warn('Acervo: atualização inválida de dispositivo.'); }
      });
    }
    on('snapshot', acceptSnapshot); on('devices', acceptSnapshot); on('state', acceptPlayback);
    on('command', function (command) { commandQueue = commandQueue.then(function () { return applyCommand(command); }).catch(function (err) { AC.toast(err.message, 'error'); }); });
    on('library-changed', function (change) {
      refreshLibrary().then(function () {
        if ((change.reason === 'played' || change.reason === 'play') && S.view === 'radio' && AC.radioState && AC.radioState.mode === 'recent' && !AC.radioState.paused) AC.searchRadio();
      }).catch(function () {});
    });
    on('revoked', revoke);
  }

  AC.initConnect = function () {
    if (initialized) return initialized;
    initialized = (async function () {
      var hash = new URLSearchParams(location.hash.replace(/^#/, ''));
      var pairingCode = hash.get('pair');
      if (pairingCode) history.replaceState(null, '', location.pathname + location.search);
      try {
        var config = await api('/api/connect/config');
        C.cloud = Boolean(config.cloud); C.security = config.security || null; C.configured = true;
        var info;
        if (pairingCode) info = await api('/api/connect/claim', { code: pairingCode, name: deviceName(), kind: kind() });
        else info = await api('/api/connect/info');
        C.local = Boolean(info.local);
        if (C.local) {
          var saved = sessionStorage.getItem('acervo:device-id');
          info = await api('/api/connect/register', { deviceId: saved || undefined, name: deviceName(), kind: kind() });
          sessionStorage.setItem('acervo:device-id', info.deviceId);
        }
        acceptSnapshot(info); listen(); return true;
      } catch (err) {
        showPairingRequired(!C.configured ? 'Não foi possível consultar a conexão com seu Acervo. Confira a internet e tente novamente.' : pairingCode ? err.message : err.status === 401 ? connectionPrompt() : err.message);
        return false;
      }
    })();
    return initialized;
  };

  function showPairingRequired(message) {
    C.dialog = 'pair';
    if (!C.configured) {
      AC.openModal('<div class="modal-head"><div><h2>Conecte seu Acervo</h2><p>' + esc(message) + '</p></div></div>' +
        '<button class="btn btn-accent" data-action="connect-retry">Tentar novamente</button>', 'modal connect-modal');
      return;
    }
    AC.openModal('<div class="modal-head"><div><h2>' + (C.cloud ? 'Entre no seu Acervo' : 'Conecte seu Acervo') + '</h2><p>' + esc(message) + '</p></div></div>' +
      (C.cloud ? '<div class="connect-help">Acesse sua biblioteca pela internet em qualquer dispositivo.</div>' +
        '<form id="connect-login-form"><label for="connect-password">Senha do seu Acervo</label><input class="seed-select" type="password" id="connect-password" autocomplete="current-password" required>' +
        '<button class="btn btn-accent" type="submit">Entrar</button></form>' :
        '<div class="connect-help">Deixe o computador ligado e os dois aparelhos no mesmo Wi‑Fi. Use a câmera do celular para abrir o link do QR code.</div>') +
      '<form id="connect-claim-form"><label for="connect-code">Já tem um código de conexão?</label><input class="seed-select" id="connect-code" autocomplete="off" placeholder="Cole o código de conexão" required>' +
      '<button class="btn btn-accent" type="submit">Conectar</button></form><p id="connect-error" class="connect-status" role="status"></p>', 'modal connect-modal');
    var login = C.cloud && $('connect-login-form');
    if (login) login.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (login.dataset.busy) return;
      login.dataset.busy = '1';
      var password = $('connect-password');
      try {
        var pending = api('/api/connect/login', { password: password.value, name: deviceName(), kind: kind() });
        password.value = '';
        await finishConnection(await pending, 'Você entrou no seu Acervo.');
      } catch (err) { var error = $('connect-error'); if (error) error.textContent = err.message; }
      finally { delete login.dataset.busy; }
    });
    var form = $('connect-claim-form');
    if (form) form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (form.dataset.busy) return;
      form.dataset.busy = '1';
      try {
        var info = await api('/api/connect/claim', { code: $('connect-code').value.trim(), name: deviceName(), kind: kind() });
        await finishConnection(info, 'Dispositivos conectados.');
      } catch (err) { var error = $('connect-error'); if (error) error.textContent = err.message; }
      finally { delete form.dataset.busy; }
    });
  }

  async function finishConnection(info, message) {
    acceptSnapshot(info); listen(); AC.closeModals(); await refreshLibrary(); AC.toast(message);
  }

  function deviceList() {
    return C.devices.map(function (item) {
      var active = C.playback && item.id === C.playback.activeDeviceId;
      var here = item.id === C.deviceId;
      return '<div class="connect-device' + (active ? ' is-active' : '') + '"><span class="connect-device-icon">' + icon(item.kind === 'mobile' ? 'phone' : 'device', 25) + '</span><div class="connect-device-meta"><b>' + esc(item.name) + (here ? ' · este dispositivo' : '') + '</b><small>' + (active ? 'Saída de áudio atual' : item.online ? 'Disponível' : 'Desconectado') + '</small></div>' +
        (item.online && !active ? '<button class="btn btn-ghost btn-sm" data-action="connect-transfer" data-id="' + esc(item.id) + '">Ouvir aqui</button>' : '') +
        (canManage() && !here ? '<button class="icon-btn" data-action="connect-revoke" data-id="' + esc(item.id) + '" aria-label="Desconectar ' + esc(item.name) + '" title="Desconectar">' + icon('close', 17) + '</button>' : '') + '</div>';
    }).join('') || '<p class="tiny">Nenhum outro dispositivo conectado ainda.</p>';
  }
  function pairingHtml() {
    if (!C.pairing) return '<div class="connect-help"><p>' + (C.cloud ? 'Escaneie o QR code em outro dispositivo para conectar seu Acervo pela internet.' : 'Conecte o celular à mesma rede Wi‑Fi e escaneie o QR code.') + '</p><button class="btn btn-accent" data-action="connect-create">Gerar QR code</button></div>';
    if (Date.now() >= C.pairing.expiresAt) return '<div class="connect-help"><p>Este QR code expirou.</p><button class="btn btn-accent" data-action="connect-create">Gerar outro QR code</button></div>';
    var candidates = C.pairing.candidates || [];
    var selected = candidates[C.candidate] || C.pairing;
    if (!selected.url || !selected.qrDataUrl) return '<div class="connect-help">' + (C.cloud ? 'O endereço público do seu Acervo não está disponível. Confira a configuração do servidor.' : 'Nenhuma rede local encontrada. Conecte o computador ao Wi‑Fi ou ao cabo de rede e tente novamente.') + '</div>';
    var pinned = C.pairing.security && C.pairing.security.type === 'tls-pinned' && /^[a-f0-9]{64}$/i.test(C.pairing.security.pin || '');
    var security = pinned ? '<div class="connect-security"><strong>Conexão criptografada</strong><p>Escaneie com o leitor do APK. O QR confirma a identidade deste computador. No celular, abra Proteção para comparar o código:</p><code>' + esc(C.pairing.security.pin.toUpperCase().match(/.{1,8}/g).join(' ')) + '</code></div>' : '';
    return '<div class="connect-qr"><img src="' + esc(selected.qrDataUrl) + '" alt="QR code para conectar o celular ao Acervo" width="220" height="220"></div><p class="connect-help">' + (pinned ? 'Abra Escanear QR code no APK atualizado.' : 'Abra a câmera do celular e aponte para o QR code.') + ' Ele vale por <span id="connect-countdown"></span> e conecta um aparelho.</p>' + security +
      (candidates.length > 1 ? '<label for="connect-network">' + (C.cloud ? 'Endereço de conexão' : 'Rede do computador') + '</label><select id="connect-network" class="seed-select">' + candidates.map(function (item, index) { return '<option value="' + index + '"' + (index === C.candidate ? ' selected' : '') + '>' + esc(item.address) + '</option>'; }).join('') + '</select>' : '') +
      '<div class="connect-copy"><input id="connect-url" readonly value="' + esc(selected.url) + '" aria-label="Link para conectar o celular"><button class="btn btn-ghost btn-sm" data-action="connect-copy">Copiar link</button></div><details class="connect-help"><summary>Usar o código manualmente</summary><code>' + esc(C.pairing.code) + '</code></details>' +
      '<button class="btn btn-quiet btn-sm" data-action="connect-create">Gerar novo QR code</button>';
  }
  function paintDevices() {
    if (C.dialog !== 'devices') return;
    var list = $('connect-device-list'); if (list) list.innerHTML = deviceList();
    var heading = $('connect-current'); if (heading) heading.textContent = C.playback && C.playback.activeDeviceId ? 'O som está em ' + activeName() : 'Escolha onde você quer ouvir';
    var pairing = $('connect-pairing'); if (pairing) pairing.innerHTML = pairingHtml();
    var network = $('connect-network');
    if (network) network.addEventListener('change', function () { C.candidate = Number(network.value); paintDevices(); });
    paintCountdown();
  }
  function paintCountdown() {
    var countdown = $('connect-countdown');
    if (!countdown || !C.pairing) return;
    var seconds = Math.max(0, Math.ceil((C.pairing.expiresAt - Date.now()) / 1000));
    countdown.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    if (!seconds) paintDevices();
  }
  function paintConnection() {
    var status = $('device-status');
    if (status) {
      status.hidden = !C.ready;
      status.textContent = C.needsGesture ? 'Toque em play para continuar aqui' : !C.connected ? 'Reconectando…' : activeHere() ? (kind() === 'mobile' ? 'Som neste celular' : 'Som neste computador') : 'Controlando ' + activeName();
      status.classList.toggle('is-remote', AC.isRemotePlayback());
    }
    document.body.classList.toggle('remote-playback', AC.isRemotePlayback());
    paintDevices(); AC.paintExpandedPlayer();
  }
  AC.openDevices = function () {
    if (!C.ready) { showPairingRequired(connectionPrompt()); return; }
    C.dialog = 'devices';
    AC.openModal('<div class="modal-head"><div><h2>Seus dispositivos</h2><p id="connect-current"></p></div><button class="icon-btn" data-action="close-modal" aria-label="Fechar">' + icon('close', 20) + '</button></div>' +
      '<div class="connect-devices" id="connect-device-list"></div>' +
      '<p class="connect-help"><a class="btn btn-ghost btn-sm" href="/downloads/acervo.apk">' + icon('download', 16) + ' Baixar APK Android</a></p>' +
      (canManage() ? '<div class="connect-pair-section"><h3>Conectar outro dispositivo</h3><div id="connect-pairing"></div></div>' : '<p class="connect-help">Biblioteca, fila e controles são compartilhados entre seus dispositivos. Escolha um dispositivo para transferir o som.</p>') +
      (C.cloud ? '<button class="btn btn-quiet btn-sm" data-action="connect-logout">Sair deste dispositivo</button>' : '') +
      '<p id="connect-error" class="connect-status" role="status"></p>', 'modal connect-modal');
    paintDevices();
    if (canManage() && (!C.pairing || Date.now() >= C.pairing.expiresAt)) createPairing();
  };
  async function createPairing() {
    var slot = $('connect-pairing'); if (slot) slot.innerHTML = '<p class="connect-status">Preparando QR code…</p>';
    try { C.pairing = await api('/api/connect/pairing', {}); C.candidate = 0; paintDevices(); }
    catch (err) { var error = $('connect-error'); if (error) error.textContent = err.message; }
  }
  async function transfer(id) {
    try { await api('/api/connect/command', { type: 'transfer', args: { targetDeviceId: id } }); AC.closeModals(); }
    catch (err) { AC.toast(err.message, 'error'); }
  }
  async function copyLink() {
    var input = $('connect-url'); if (!input) return;
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(input.value);
      else { input.select(); if (!document.execCommand('copy')) throw new Error('manual'); }
      AC.toast('Link copiado.');
    } catch (err) { input.focus(); input.select(); AC.toast('Selecione e copie o link mostrado.'); }
  }

  AC.openExpandedPlayer = function () {
    if (!S.current) { AC.toast('Escolha uma música para ouvir.'); return; }
    C.dialog = 'player';
    AC.openModal('<div class="now-playing-top"><button class="icon-btn" data-action="close-modal" aria-label="Recolher player">' + icon('close', 22) + '</button><span>TOCANDO AGORA</span><button class="icon-btn" data-action="queue" aria-label="Abrir fila">' + icon('queue', 22) + '</button></div>' +
      '<div class="now-playing-art" id="expanded-art"></div><h2 class="now-playing-title" id="expanded-title"></h2><p class="now-playing-artist" id="expanded-artist"></p>' +
      '<input id="expanded-seek" class="now-playing-seek" type="range" min="0" max="1000" step="1" value="0" aria-label="Posição da música"><div class="now-playing-times"><span id="expanded-current"></span><span id="expanded-duration"></span></div>' +
      '<div class="now-playing-controls"><button class="icon-btn" data-action="shuffle" aria-label="Aleatório">' + icon('shuffle', 22) + '</button><button class="icon-btn" data-action="prev" aria-label="Anterior">' + icon('prev', 27) + '</button><button class="play-btn" id="expanded-toggle" data-action="toggle" aria-label="Pausar"></button><button class="icon-btn" data-action="next" aria-label="Próxima">' + icon('next', 27) + '</button><button class="icon-btn" data-action="repeat" aria-label="Repetir">' + icon('repeat', 22) + '</button></div>' +
      '<button class="now-playing-device" data-action="connect-devices">' + icon('device', 18) + '<span id="expanded-device"></span></button>', 'modal now-playing-modal');
    var seek = $('expanded-seek');
    seek.addEventListener('input', function () { seek.dataset.dragging = '1'; var time = $('expanded-current'); if (time) time.textContent = AC.fmtTime(Number(seek.value) / 1000 * S.current.duration); });
    seek.addEventListener('change', function () { AC.seekRatio(Number(seek.value) / 1000); delete seek.dataset.dragging; });
    AC.paintExpandedPlayer();
  };
  AC.paintExpandedPlayer = function () {
    if (C.dialog !== 'player' || !S.current) return;
    var track = S.current;
    var art = $('expanded-art');
    if (art && art.dataset.trackId !== track.id) { art.innerHTML = AC.coverHtml(track, true); art.dataset.trackId = track.id; }
    var title = $('expanded-title'); if (title) title.textContent = track.title;
    var artist = $('expanded-artist'); if (artist) artist.textContent = track.artist;
    var cur = AC.isRemotePlayback() ? AC.remotePosition() : audio.currentTime || 0;
    var seek = $('expanded-seek'); if (seek && !seek.dataset.dragging) seek.value = String(Math.round(cur / Math.max(1, track.duration) * 1000));
    var current = $('expanded-current'); if (current && (!seek || !seek.dataset.dragging)) current.textContent = AC.fmtTime(cur);
    var duration = $('expanded-duration'); if (duration) duration.textContent = AC.fmtTime(track.duration);
    var toggle = $('expanded-toggle'); if (toggle) { toggle.innerHTML = icon(S.playing ? 'pause' : 'play', 26); toggle.setAttribute('aria-label', S.playing ? 'Pausar' : 'Tocar'); }
    var output = $('expanded-device'); if (output) output.textContent = C.ready ? (activeHere() ? 'Ouvindo neste dispositivo' : 'Ouvindo em ' + activeName()) : 'Escolher dispositivo';
  };
  AC.onPlaybackBlocked = function () { C.needsGesture = true; paintConnection(); AC.toast('Toque em play neste dispositivo para continuar a música.'); };
  AC.onModalClose = function () { C.dialog = null; };
  AC.playerActions['connect-devices'] = AC.openDevices;
  AC.playerActions['connect-create'] = createPairing;
  AC.playerActions['connect-copy'] = copyLink;
  AC.playerActions['connect-retry'] = async function () {
    initialized = null;
    if (await AC.initConnect()) { AC.closeModals(); await refreshLibrary(); }
  };
  AC.playerActions['connect-logout'] = async function () {
    try { await api('/api/connect/logout', {}); revoke('Você saiu deste dispositivo. Entre novamente para acessar seu Acervo.'); }
    catch (err) { if (err.status === 401) revoke(); else AC.toast(err.message, 'error'); }
  };
  AC.playerActions['connect-transfer'] = function (el) { transfer(el.getAttribute('data-id')); };
  AC.playerActions['connect-revoke'] = function (el) {
    api('/api/connect/devices/' + encodeURIComponent(el.getAttribute('data-id')), undefined, 'DELETE').then(refreshInfo).catch(function (err) { AC.toast(err.message, 'error'); });
  };
  AC.playerActions['expand-player'] = AC.openExpandedPlayer;
  audio.addEventListener('play', function () { C.needsGesture = false; paintConnection(); });
  setInterval(function () { paintCountdown(); if (AC.isRemotePlayback() && C.playback) AC.paintPlayback(); }, 1000);
})();
