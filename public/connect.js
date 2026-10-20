(function () {
  'use strict';
  var AC = window.AC;
  var S = AC.state;
  var audio = document.getElementById('audio');
  var esc = AC.esc;
  var icon = AC.icon;
  var C = AC.connect = {
    ready: false, connected: false, local: false, admin: false, cloud: false, configured: false, security: null, deviceId: null, devices: [], playback: null,
    receivedAt: 0, applying: false, dialog: null, pairing: null, pairingExpired: false, candidate: 0, needsGesture: false
  };
  var events = null;
  var initialized = null;
  // The invitation survives a transport retry in this document, never in browser storage.
  var pendingInvitation = null;
  var lastPublished = 0;
  var sending = false;
  var pendingPublish = false;
  var seenCommands = new Set();
  var refreshingLibrary = null;
  var commandQueue = Promise.resolve();
  var restoring = Promise.resolve();
  var creatingPairing = null;
  var endpointBusy = false;
  var endpointDraft = null;
  var endpointSignature = null;
  var relayBusy = false;
  var relayMessage = '';
  var relayActionUrl = null;
  var pairingGeneration = 0;
  function $(id) { return document.getElementById(id); }
  function confirmNativeConnection() {
    if (!C.ready || typeof window.__acervoConnectionReady !== 'function') return;
    try { window.__acervoConnectionReady(); } catch (ignored) { }
  }
  function kind() { return /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '') ? 'mobile' : 'desktop'; }
  function deviceName() { return kind() === 'mobile' ? 'Meu celular' : 'Meu computador'; }
  function device(id) { return C.devices.find(function (item) { return item.id === id; }); }
  function activeName() { var active = C.playback && device(C.playback.activeDeviceId); return active ? active.name : 'um dispositivo'; }
  function activeHere() { return C.ready && C.playback && C.playback.activeDeviceId === C.deviceId; }
  function canManage() { return C.local || C.admin; }
  function mutualSecurity() { return !C.cloud && Boolean(C.security && (C.security.type === 'mtls-pinned' || C.security.mutual === true)); }
  function phonePaired() { return mutualSecurity() && Boolean(C.security.pairedDeviceId || validPin(C.security.phonePin)); }
  function validPin(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value); }
  function pinText(value) { return validPin(value) ? value.toUpperCase().match(/.{1,8}/g).join(' ') : ''; }
  function internetCandidate(candidate) {
    if (C.cloud) return true;
    if (!C.security || !C.security.publicEndpoint || !candidate || !candidate.url) return false;
    try { return new URL(candidate.url).origin === new URL(C.security.publicEndpoint).origin; }
    catch (error) { return false; }
  }
  function connectionPrompt() { return C.cloud ? 'Entre com a senha do seu Acervo ou use um código criado em um dispositivo já conectado.' : mutualSecurity() ? 'No computador, abra Dispositivos. Use o leitor de QR code do APK atualizado para vincular este celular.' : 'No computador, abra Dispositivos e escaneie o QR code com a câmera do celular.'; }

  async function api(path, body, method) {
    var headers = { 'Content-Type': 'application/json' };
    if (C.local && C.deviceId) headers['X-Acervo-Device'] = C.deviceId;
    var response = await fetch(path, { method: method || (body === undefined ? 'GET' : 'POST'), headers: headers,
      credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) { var err = new Error(data.error || 'Não foi possível conectar agora.'); err.status = response.status; err.actionUrl = data.actionUrl; throw err; }
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
        if (args.trackId) AC.play(args.trackId, { localOnly: true, keepQueue: Number.isInteger(args.qi), queueIndex: args.qi });
        else if (!S.playing) AC.toggle();
      } else if (command.type === 'pause') { audio.pause(); S.playing = false; }
      else if (command.type === 'toggle') AC.toggle();
      else if (command.type === 'next') AC.next(false);
      else if (command.type === 'previous') AC.prev();
      else if (command.type === 'seek' && S.current) AC.seekRatio(args.position / S.current.duration);
      else if (command.type === 'volume') AC.setVolume(args.volume);
      else if (command.type === 'shuffle') { S.shuffle = args.shuffle; }
      else if (command.type === 'repeat') { S.repeat = args.repeat; }
      else if (command.type === 'queue') {
        if (S.current && args.queue[args.qi] !== S.current.id) return;
        AC.setPlaybackQueue(args.queue, args.qi);
      }
      AC.paintPlayback();
    } finally { C.applying = false; AC.notifyPlayback(true); }
  }

  function acceptSnapshot(snapshot) {
    var previousPhone = C.security && C.security.pairedDeviceId;
    var previousPhonePin = C.security && C.security.phonePin;
    var previousEndpoint = C.security && C.security.publicEndpoint;
    var previousIds = new Set(C.devices.map(function (item) { return item.id; }));
    if (C.pairing && (snapshot.devices || []).some(function (item) { return !item.local && !previousIds.has(item.id); })) C.pairing = null;
    C.local = Boolean(snapshot.local); C.admin = Boolean(snapshot.admin);
    if (typeof snapshot.cloud === 'boolean') C.cloud = snapshot.cloud;
    if (snapshot.security && typeof snapshot.security === 'object') C.security = Object.assign({}, C.security || {}, snapshot.security);
    if (snapshot.security && Object.prototype.hasOwnProperty.call(snapshot.security, 'publicEndpoint') && previousEndpoint !== C.security.publicEndpoint) { pairingGeneration++; C.pairing = null; }
    if (snapshot.security && (previousPhone !== C.security.pairedDeviceId || previousPhonePin !== C.security.phonePin)) { pairingGeneration++; C.pairing = null; }
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
    pairingGeneration++;
    pendingInvitation = null;
    C.ready = false; C.connected = false; C.needsGesture = false; C.admin = false;
    C.deviceId = null; C.devices = []; C.playback = null; C.pairing = null;
    if (C.security) C.security = Object.assign({}, C.security, { phonePin: null, pairedDeviceId: null });
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
    if (window.__ACERVO_PHONE__ === true) return Promise.resolve(true);
    if (initialized) return initialized;
    initialized = (async function () {
      var hash = new URLSearchParams(location.hash.replace(/^#/, ''));
      var pairingCode = hash.get('pair');
      if (pairingCode) {
        pendingInvitation = { code: pairingCode, expiresAt: Date.now() + 5 * 60 * 1000, recover: false };
        history.replaceState(null, '', location.pathname + location.search);
      }
      if (pendingInvitation && Date.now() >= pendingInvitation.expiresAt) pendingInvitation = null;
      var invitation = pendingInvitation;
      C.configured = false;
      try {
        var config = await api('/api/connect/config');
        C.cloud = Boolean(config.cloud); C.security = config.security || null; C.configured = true;
        var info;
        if (invitation && invitation.recover) {
          // A lost response may hide a completed claim. Reuse that authenticated identity first.
          try { info = await api('/api/connect/info'); }
          catch (error) { if (error.status !== 401) throw error; }
        }
        if (invitation && !info) {
          invitation.recover = true;
          try { info = await api('/api/connect/claim', { code: invitation.code, name: deviceName(), kind: kind() }); }
          catch (error) {
            if (error.status && error.status < 500 && error.status !== 429) pendingInvitation = null;
            throw error;
          }
        } else if (!info) info = await api('/api/connect/info');
        pendingInvitation = null;
        C.local = Boolean(info.local);
        if (C.local) {
          var saved = sessionStorage.getItem('acervo:device-id');
          info = await api('/api/connect/register', { deviceId: saved || undefined, name: deviceName(), kind: kind() });
          sessionStorage.setItem('acervo:device-id', info.deviceId);
        }
        acceptSnapshot(info); listen(); confirmNativeConnection(); return true;
      } catch (err) {
        var nativeDetail = err && /^AC-(DNS|TEMPO|REDE|CHAVE|TLS|CONEXAO): /.test(err.message || '') ? err.message : null;
        showPairingRequired(!C.configured ? nativeDetail || 'Não foi possível consultar a conexão com seu Acervo. Confira a internet e tente novamente.' : invitation ? err.message : err.status === 401 ? connectionPrompt() : err.message);
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
        '<div class="connect-help">' + (mutualSecurity() ? 'Deixe o computador ligado. O vínculo usa as identidades criptográficas do PC e deste celular; abra Escanear QR code dentro do APK atualizado. Um navegador comum não apresenta a identidade do aplicativo.' : 'Deixe o computador ligado e os dois aparelhos no mesmo Wi‑Fi. Use a câmera do celular para abrir o link do QR code.') + '</div>') +
      (!mutualSecurity() ? '<form id="connect-claim-form"><label for="connect-code">Já tem um código de conexão?</label><input class="seed-select" id="connect-code" autocomplete="off" placeholder="Cole o código de conexão" required>' +
      '<button class="btn btn-accent" type="submit">Conectar</button></form>' : '') +
      (pendingInvitation ? '<button class="btn btn-accent" data-action="connect-retry">Tentar novamente</button>' : '') +
      '<p id="connect-error" class="connect-status" role="status"></p>', 'modal connect-modal');
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
    pendingInvitation = null;
    acceptSnapshot(info); listen(); confirmNativeConnection(); AC.closeModals(); await refreshLibrary(); AC.toast(message);
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
    if (phonePaired() && !C.pairing) return '<div class="connect-help"><p>Este PC já está vinculado a um celular. Para vincular outro, remova o celular autorizado na lista acima e gere um novo QR code.</p><p>O vínculo atual permanece protegido; outro convite não troca o aparelho automaticamente.</p>' + (C.pairingExpired ? '<p>O convite anterior expirou.</p>' : '') + '<button class="btn btn-ghost" data-action="connect-refresh-address">Atualizar endereço no celular vinculado</button></div>';
    if (!C.pairing) return '<div class="connect-help"><p>' + (C.pairingExpired ? 'Este QR code expirou. Gere outro convite para conectar.' : C.cloud ? 'Escaneie o QR code em outro dispositivo para conectar seu Acervo pela internet.' : mutualSecurity() ? 'Vincule um único celular pelo leitor de QR code do APK atualizado.' : 'Conecte o celular à mesma rede Wi‑Fi e escaneie o QR code.') + '</p><button class="btn btn-accent" data-action="connect-create">Gerar QR code</button></div>';
    if (Date.now() >= C.pairing.expiresAt) return '<div class="connect-help"><p>Este QR code expirou.</p><button class="btn btn-accent" data-action="connect-create">Gerar outro QR code</button></div>';
    var candidates = C.pairing.candidates || [];
    var selected = candidates[C.candidate] || C.pairing;
    if (!selected.url || !selected.qrDataUrl) return '<div class="connect-help">' + (C.cloud ? 'O endereço público do seu Acervo não está disponível. Confira a configuração do servidor.' : 'Nenhuma rede local encontrada. Conecte o computador ao Wi‑Fi ou ao cabo de rede e tente novamente.') + '</div>';
    var pinned = C.pairing.security && ['tls-pinned', 'mtls-pinned'].includes(C.pairing.security.type) && validPin(C.pairing.security.pin);
    var mutual = mutualSecurity() || Boolean(C.pairing.security && C.pairing.security.type === 'mtls-pinned');
    var verifiedInternet = internetCandidate(selected) && C.security && C.security.internetRelay && C.security.internetRelay.state === 'online' && C.security.internetRelay.verified === true;
    var security = pinned && !mutual ? '<div class="connect-security"><strong>Conexão criptografada</strong><p>Escaneie com o leitor do APK. O QR confirma a identidade deste computador. No celular, abra Proteção para comparar o código:</p><code>' + esc(pinText(C.pairing.security.pin)) + '</code></div>' : '';
    return '<p class="connect-help"><strong>' + (verifiedInternet ? 'Internet · conexão verificada' : internetCandidate(selected) ? 'Internet · acesso externo não verificado' : 'Rede local') + '</strong><br>' + (verifiedInternet ? 'Escaneie no APK para usar outra rede. Mantenha o computador ligado.' : internetCandidate(selected) ? 'Use outra rede somente se este endereço já alcançar o PC pela internet.' : 'Este endereço precisa estar acessível pela mesma rede do computador.') + '</p>' + (phonePaired() ? '<p class="connect-help">Este convite atualiza o endereço somente no celular já vinculado. Outro aparelho não pode substituir a identidade autorizada.</p>' : '') + '<div class="connect-qr"><img src="' + esc(selected.qrDataUrl) + '" alt="QR code para conectar o celular ao Acervo" width="220" height="220"></div><p class="connect-help">' + (pinned ? 'Abra Escanear QR code no APK atualizado.' : 'Abra a câmera do celular e aponte para o QR code.') + ' Ele vale por <span id="connect-countdown"></span> e conecta um aparelho.</p>' + security +
      (mutual ? '<p class="connect-help">O QR contém um convite de uso único e a identidade pública do PC. As chaves privadas ficam em cada aparelho. Mantenha o convite privado até concluir o vínculo.</p>' : '') +
      (candidates.length > 1 ? '<label for="connect-network">Endereço de conexão</label><select id="connect-network" class="seed-select">' + candidates.map(function (item, index) { return '<option value="' + index + '"' + (index === C.candidate ? ' selected' : '') + '>' + (internetCandidate(item) ? 'Internet · ' : 'Rede local · ') + esc(item.address) + '</option>'; }).join('') + '</select>' : '') +
      '<div class="connect-copy"><input id="connect-url" readonly value="' + esc(selected.url) + '" aria-label="Link para conectar o celular"><button class="btn btn-ghost btn-sm" data-action="connect-copy">Copiar link</button></div>' + (!mutual ? '<details class="connect-help"><summary>Usar o código manualmente</summary><code>' + esc(C.pairing.code) + '</code></details>' : '') +
      '<button class="btn btn-quiet btn-sm" data-action="' + (phonePaired() ? 'connect-refresh-address' : 'connect-create') + '">Gerar novo QR code</button>';
  }
  function verificationHtml() {
    if (!mutualSecurity()) return '';
    var security = C.security || {};
    var pcPin = security.pcPin || (C.pairing && C.pairing.security && C.pairing.security.pin);
    return '<div class="connect-security"><strong>Verificação dos aparelhos</strong><p>Somente um celular pode acessar este PC pelo vínculo criptográfico. Compare estes códigos com os exibidos em Proteção no APK.</p>' +
      (validPin(pcPin) ? '<p>Identidade do PC</p><code>' + esc(pinText(pcPin)) + '</code>' : '') +
      (validPin(security.phonePin) ? '<p>Identidade do celular autorizado</p><code>' + esc(pinText(security.phonePin)) + '</code>' : '<p>Nenhum celular autorizado ainda.</p>') + '</div>';
  }
  function endpointEditable() {
    var security = C.security || {};
    if (security.publicEndpointEditable === false) return false;
    if (security.internetRelay && ['online', 'configured'].includes(security.internetRelay.state)) return false;
    return C.local && mutualSecurity() && security.publicEndpointSource !== 'environment'
      && !(security.publicEndpoint && security.publicEndpointSource === undefined);
  }
  function relayHtml() {
    var security = C.security || {};
    if (!C.local || !security.internetRelaySupported) return '';
    var relay = security.internetRelay || {};
    var online = relay.state === 'online' && relay.verified === true;
    var configured = relay.state === 'configured' || relay.state === 'online';
    return '<div class="connect-help"><p><strong>' + (online ? 'Conexão pela internet verificada' : configured ? 'Encaminhamento configurado · verificar conexão' : 'Ative o acesso deste PC pela internet') + '</strong></p><p>' +
      (online ? 'Este endereço já foi conferido com a identidade criptográfica do PC. Gere o QR code para o celular usar outra rede.' : 'O PC pode usar um encaminhamento para ser alcançado de outra rede. Os dados continuam criptografados até o Acervo deste computador.') +
      '</p><p>O computador precisa permanecer ligado e conectado. O celular usa apenas o APK, sem instalar Tailscale.</p><div class="connect-actions"><button class="btn btn-accent btn-sm" data-action="connect-internet-enable"' + (relayBusy ? ' disabled' : '') + '>' + (relayBusy ? 'Preparando conexão…' : online ? 'Verificar conexão pela internet' : configured ? 'Verificar e ativar conexão' : 'Ativar conexão pela internet') + '</button>' +
      (configured ? '<button class="btn btn-quiet btn-sm" data-action="connect-internet-disable"' + (relayBusy ? ' disabled' : '') + '>Desativar encaminhamento</button>' : '') + '</div><p id="connect-relay-status" class="connect-status" role="status">' + esc(relayMessage) + '</p>' +
      (relayActionUrl ? '<p><a href="' + esc(relayActionUrl) + '" target="_blank" rel="noopener noreferrer">Autorizar encaminhamento no provedor</a></p>' : '') + '</div>';
  }
  function paintInternet() {
    var root = $('connect-internet');
    if (!root || !C.local || !mutualSecurity()) return;
    var security = C.security || {};
    var endpoint = security.publicEndpoint || '';
    var signature = JSON.stringify([endpoint, security.publicEndpointSource, endpointEditable(), security.internetRelaySupported, security.internetRelay, relayBusy, relayMessage, relayActionUrl]);
    if (signature === endpointSignature) return;
    endpointSignature = signature;
    var relayManaged = security.internetRelay && ['online', 'configured'].includes(security.internetRelay.state);
    root.innerHTML = '<h3>Conectar pela internet</h3>' + relayHtml() + '<div class="connect-help"><p><strong>' + (endpoint ? security.internetRelay && security.internetRelay.state === 'online' && security.internetRelay.verified === true ? 'Endereço de internet verificado' : 'Endereço configurado · acesso externo não verificado' : 'Sem endereço de internet configurado') + '</strong></p>' +
      (endpoint ? '<p>Endereço pela internet: ' + esc(endpoint) + '</p>' : '<p>Os QR codes atuais usam a rede local. Para outra rede, configure um endereço HTTPS público que alcance este PC.</p>') +
      '<p>O PC precisa permanecer ligado e o TLS deve chegar diretamente ao Acervo. Salvar o endereço não abre portas, não configura o roteador e não remove restrições de NAT ou CGNAT.</p></div>' +
      (endpointEditable() ? '<details class="connect-help"><summary>Configurar um endereço público manualmente</summary><form id="connect-endpoint-form"><label for="connect-endpoint">Endereço HTTPS público deste PC</label><input class="seed-select" id="connect-endpoint" type="url" inputmode="url" autocomplete="url" maxlength="2048" placeholder="https://seu-endereco.exemplo:4311" value="' + esc(endpointDraft === null ? endpoint : endpointDraft) + '" required><p class="connect-help">Use somente o endereço e a porta, sem caminhos, usuário ou código de conexão.</p><div class="connect-actions"><button class="btn btn-accent btn-sm" id="connect-endpoint-save" type="submit">Salvar endereço</button>' + (endpoint ? '<button class="btn btn-quiet btn-sm" data-action="connect-remove-endpoint" type="button">Remover endereço</button>' : '') + '</div></form></details>' : '<p class="connect-help">' + (relayManaged ? 'Este endereço é gerenciado pelo encaminhamento. Desative-o antes de configurar um endereço manual.' : 'Este endereço é definido na configuração do servidor. Altere ACERVO_PUBLIC_ENDPOINT e reinicie o Acervo para atualizá-lo.') + '</p>') +
      '<p id="connect-endpoint-status" class="connect-status" role="status"></p>';
    var input = $('connect-endpoint');
    if (input) input.addEventListener('input', function () { endpointDraft = input.value; });
    var form = $('connect-endpoint-form');
    if (form) form.addEventListener('submit', function (event) { event.preventDefault(); saveEndpoint(false); });
  }
  async function saveEndpoint(remove) {
    if (!endpointEditable() || endpointBusy || relayBusy) return;
    var input = $('connect-endpoint');
    var value = remove ? null : String(input && input.value || '').trim();
    var status = $('connect-endpoint-status');
    if (!remove) {
      try {
        var parsed = new URL(value);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error();
      } catch (error) { if (status) status.textContent = 'Use um endereço HTTPS válido, sem caminho, usuário, consulta ou fragmento.'; return; }
    }
    endpointBusy = true;
    var authEpoch = S.authEpoch;
    var ownerId = C.deviceId;
    var button = $('connect-endpoint-save'); if (button) button.disabled = true;
    if (status) status.textContent = 'Salvando endereço…';
    try {
      var snapshot = await api('/api/connect/endpoint', { publicEndpoint: value });
      if (authEpoch !== S.authEpoch || !C.ready || !C.local || ownerId !== C.deviceId) return;
      pairingGeneration++; C.pairing = null; C.pairingExpired = false; endpointDraft = null; endpointSignature = null;
      acceptSnapshot(snapshot);
      status = $('connect-endpoint-status');
      if (status) status.textContent = remove ? 'Endereço removido. Gere um QR code da rede local quando precisar.' : 'Endereço salvo. Gere um novo QR code e selecione Internet. O acesso externo ainda precisa ser verificado pela outra rede.';
    } catch (error) { status = $('connect-endpoint-status'); if (status) status.textContent = error.message; }
    finally { endpointBusy = false; button = $('connect-endpoint-save'); if (button) button.disabled = false; }
  }
  async function manageInternet(enable) {
    if (!C.ready || !C.local || !mutualSecurity() || !C.security.internetRelaySupported || relayBusy || endpointBusy) return;
    relayBusy = true; relayMessage = enable ? 'Preparando o encaminhamento e verificando a identidade do PC pela internet…' : 'Desativando o encaminhamento…'; relayActionUrl = null;
    var epoch = S.authEpoch; var ownerId = C.deviceId;
    paintInternet();
    try {
      var result = await api('/api/connect/internet/' + (enable ? 'enable' : 'disable'), {});
      if (epoch !== S.authEpoch || !C.ready || !C.local || ownerId !== C.deviceId) return;
      pairingGeneration++; C.pairing = null; C.pairingExpired = false; endpointDraft = null;
      if (result.snapshot) acceptSnapshot(result.snapshot);
      if (result.relay) C.security.internetRelay = result.relay;
      relayMessage = enable ? result.relay && result.relay.state === 'online' && result.relay.verified === true
        ? 'Conexão pela internet verificada. Gere um novo QR code para conectar o celular por outra rede.'
        : 'Encaminhamento configurado. A conexão externa ainda precisa ser verificada.'
        : 'Encaminhamento desativado. O acesso pela rede local continua disponível.';
    } catch (error) {
      relayMessage = error.message;
      try { var action = new URL(error.actionUrl); if (action.protocol === 'https:' && !action.username && !action.password) relayActionUrl = action.href; } catch (invalid) {}
    } finally { relayBusy = false; endpointSignature = null; paintDevices(); }
  }
  function paintDevices() {
    if (C.dialog !== 'devices') return;
    var list = $('connect-device-list'); if (list) list.innerHTML = deviceList();
    var heading = $('connect-current'); if (heading) heading.textContent = C.playback && C.playback.activeDeviceId ? 'O som está em ' + activeName() : 'Escolha onde você quer ouvir';
    var pairing = $('connect-pairing'); if (pairing) pairing.innerHTML = pairingHtml();
    var verification = $('connect-verification'); if (verification) verification.innerHTML = verificationHtml();
    paintInternet();
    var network = $('connect-network');
    if (network) network.addEventListener('change', function () { C.candidate = Number(network.value); paintDevices(); });
    paintCountdown();
  }
  function paintCountdown() {
    var countdown = $('connect-countdown');
    if (!countdown || !C.pairing) return;
    var seconds = Math.max(0, Math.ceil((C.pairing.expiresAt - Date.now()) / 1000));
    countdown.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    if (!seconds) { C.pairing = null; C.pairingExpired = true; paintDevices(); }
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
    if (window.__ACERVO_PHONE__ === true && window.__acervoOpenConnections) { window.__acervoOpenConnections(); return; }
    if (!C.ready) { showPairingRequired(connectionPrompt()); return; }
    C.dialog = 'devices';
    endpointSignature = null;
    AC.openModal('<div class="modal-head"><div><h2>Seus dispositivos</h2><p id="connect-current"></p></div><button class="icon-btn" data-action="close-modal" aria-label="Fechar">' + icon('close', 20) + '</button></div>' +
      '<div class="connect-devices" id="connect-device-list"></div>' +
      '<div id="connect-verification"></div>' +
      (C.local && mutualSecurity() ? '<section id="connect-internet" class="connect-pair-section"></section>' : '') +
      '<p class="connect-help"><a class="btn btn-ghost btn-sm" href="/downloads/acervo.apk">' + icon('download', 16) + ' Baixar APK Android</a></p>' +
      (canManage() ? '<div class="connect-pair-section"><h3>' + (mutualSecurity() ? 'Vincular seu celular' : 'Conectar outro dispositivo') + '</h3><div id="connect-pairing"></div></div>' : '<p class="connect-help">Biblioteca, fila e controles são compartilhados entre seus dispositivos. Escolha um dispositivo para transferir o som.</p>') +
      (C.cloud ? '<button class="btn btn-quiet btn-sm" data-action="connect-logout">Sair deste dispositivo</button>' : '') +
      '<p id="connect-error" class="connect-status" role="status"></p>', 'modal connect-modal');
    paintDevices();
    if (canManage() && !phonePaired() && (!C.pairing || Date.now() >= C.pairing.expiresAt)) createPairing();
  };
  function createPairing(allowPaired) {
    if (!canManage() || (phonePaired() && allowPaired !== true)) { paintDevices(); return Promise.resolve(); }
    if (creatingPairing) return creatingPairing;
    var generation = pairingGeneration;
    var pairedId = C.security && C.security.pairedDeviceId;
    creatingPairing = (async function () {
      var slot = $('connect-pairing'); if (slot) slot.innerHTML = '<p class="connect-status">Preparando QR code…</p>';
      try {
        var pairing = await api('/api/connect/pairing', {});
        if (generation === pairingGeneration && C.ready && canManage()
            && (!phonePaired() || (allowPaired === true && pairedId === C.security.pairedDeviceId))) {
          C.pairing = pairing; C.pairingExpired = false; C.candidate = 0;
        }
        paintDevices();
      } catch (err) { var error = $('connect-error'); if (error) error.textContent = err.message; }
      finally { creatingPairing = null; }
    })();
    return creatingPairing;
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

  function expandedDuration() {
    var decoded = Number(audio.duration);
    return !AC.isRemotePlayback() && isFinite(decoded) && decoded > 0 ? decoded : (Number(S.current && S.current.duration) || 0);
  }
  AC.openExpandedPlayer = function () {
    if (!S.current) { AC.toast('Escolha uma música para ouvir.'); return; }
    C.dialog = 'player';
    AC.openModal('<div class="now-playing-ambient" aria-hidden="true"></div>' +
      '<div class="now-playing-top"><button class="icon-btn" data-action="close-modal" aria-label="Recolher player">' + icon('close', 22) + '</button><span>TOCANDO AGORA</span><button class="icon-btn" data-action="queue" aria-label="Abrir fila">' + icon('queue', 22) + '</button></div>' +
      '<div class="now-playing-scroll"><div class="now-playing-main"><div class="now-playing-art" id="expanded-art"></div>' +
      '<p class="now-playing-kicker" id="expanded-kicker">Sua biblioteca</p>' +
      '<h2 class="now-playing-title" id="expanded-title"></h2><p class="now-playing-artist" id="expanded-artist"></p>' +
      '<div class="now-playing-actions"><button class="now-playing-chip" data-action="queue">' + icon('queue', 15) + ' Fila</button><button class="now-playing-chip" id="expanded-artist-chip" data-action="open-artist">' + icon('wave', 15) + ' Artista</button></div>' +
      '<input id="expanded-seek" class="now-playing-seek" type="range" min="0" max="1000" step="1" value="0" aria-label="Posição da música"><div class="now-playing-times"><span id="expanded-current"></span><span id="expanded-duration"></span></div>' +
      '<div class="now-playing-controls"><button class="icon-btn" data-action="shuffle" aria-label="Aleatório">' + icon('shuffle', 22) + '</button><button class="icon-btn" data-action="prev" aria-label="Anterior">' + icon('prev', 27) + '</button><button class="play-btn" id="expanded-toggle" data-action="toggle" aria-label="Pausar"></button><button class="icon-btn" data-action="next" aria-label="Próxima">' + icon('next', 27) + '</button><button class="icon-btn" data-action="repeat" aria-label="Repetir">' + icon('repeat', 22) + '</button></div>' +
      '<button class="now-playing-device" data-action="connect-devices">' + icon('device', 18) + '<span id="expanded-device"></span></button></div>' +
      '<aside class="now-playing-details"><section class="now-playing-artist-card" id="expanded-artist-card"><span class="eyebrow">Sobre o artista</span><p>Carregando o perfil…</p></section>' +
      '<section class="now-playing-next"><div class="section-head"><h3>A seguir</h3><button class="link" data-action="queue">Ver fila</button></div><div id="expanded-next"></div></section>' +
      '<button class="now-playing-radio-card" id="expanded-radio" data-action="start-radio"><span>' + icon('radio', 24) + '</span><strong>Continue descobrindo</strong><small>Inicie uma rádio a partir desta música</small>' + icon('arrow', 16) + '</button></aside></div>', 'modal now-playing-modal');
    var seek = $('expanded-seek');
    seek.addEventListener('input', function () { seek.dataset.dragging = '1'; var time = $('expanded-current'); if (time) time.textContent = AC.fmtTime(Number(seek.value) / 1000 * expandedDuration()); });
    seek.addEventListener('change', function () { AC.seekRatio(Number(seek.value) / 1000); delete seek.dataset.dragging; });
    AC.paintExpandedPlayer();
  };
  AC.paintExpandedPlayer = function () {
    if (C.dialog !== 'player' || !S.current) return;
    var track = S.current;
    var modal = document.querySelector('.now-playing-modal');
    var cover = track.hasCover ? '/api/cover/' + encodeURIComponent(track.id) : (track.thumbnail || '');
    if (modal) {
      if (cover) modal.style.setProperty('--np-cover', 'url("' + String(cover).replace(/"/g, '%22') + '")');
      else modal.style.removeProperty('--np-cover');
    }
    var art = $('expanded-art');
    if (art && art.dataset.trackId !== track.id) {
      var artCover = track.hasCover ? '/api/cover/' + encodeURIComponent(track.id) : (track.thumbnail || '');
      art.innerHTML = artCover ? AC.coverHtml(track, true) : '<span class="now-playing-fallback">' + AC.icon('wave', 56) + '<strong>' + esc(track.title) + '</strong><small>' + esc(track.artist) + '</small></span>';
      art.dataset.trackId = track.id;
    }
    var title = $('expanded-title'); if (title) title.textContent = track.title;
    var artist = $('expanded-artist'); if (artist) artist.textContent = track.artist;
    var kicker = $('expanded-kicker'); if (kicker) kicker.textContent = track.album || 'Sua biblioteca';
    var artistChip = $('expanded-artist-chip'); if (artistChip) artistChip.setAttribute('data-artist', track.artist || '');
    var radio = $('expanded-radio'); if (radio) radio.setAttribute('data-id', track.id);
    var shuffle = document.querySelector('.now-playing-controls [data-action="shuffle"]'); if (shuffle) { shuffle.classList.toggle('is-on', S.shuffle); shuffle.setAttribute('aria-pressed', String(S.shuffle)); }
    var repeat = document.querySelector('.now-playing-controls [data-action="repeat"]'); if (repeat) { repeat.classList.toggle('is-on', S.repeat !== 'off'); repeat.setAttribute('aria-label', S.repeat === 'one' ? 'Repetindo esta música' : S.repeat === 'all' ? 'Repetindo a fila' : 'Repetir'); }
    var nextRoot = $('expanded-next');
    var nextIds = (S.queue || []).slice((S.qi || 0) + 1).filter(function (id) { return !!AC.trackById(id); }).slice(0, 3);
    var nextSignature = JSON.stringify(nextIds);
    if (nextRoot && nextRoot.dataset.signature !== nextSignature) {
      nextRoot.dataset.signature = nextSignature;
      nextRoot.innerHTML = nextIds.map(function (id) {
        var item = AC.trackById(id);
        return '<button class="np-next-track" data-action="play-track" data-id="' + esc(id) + '"><span class="np-next-cover">' + AC.coverHtml(item) + '</span><span><strong>' + esc(item.title) + '</strong><small>' + esc(item.artist) + '</small></span>' + icon('play', 15) + '</button>';
      }).join('') || '<p class="tiny">Você chegou ao fim da fila. Escolha outra música ou inicie uma rádio.</p>';
    }
    var artistCard = $('expanded-artist-card');
    var artistSignature = (S.authEpoch || 0) + ':' + track.artist;
    if (artistCard && artistCard.dataset.artist !== artistSignature) {
      artistCard.dataset.artist = artistSignature;
      artistCard.innerHTML = '<span class="eyebrow">Sobre o artista</span><h3>' + esc(track.artist) + '</h3><p>Seu próximo encontro com a música.</p>';
      if (AC.artistSummary) AC.artistSummary(track.artist).then(function (data) {
        if (!data || C.dialog !== 'player' || !S.current || S.current.artist !== track.artist || artistCard.dataset.artist !== artistSignature) return;
        var picture = data.picture || (track.hasCover ? '/api/cover/' + encodeURIComponent(track.id) : '');
        if (!/^\/api\/cover\/[A-Za-z0-9_-]+$/.test(picture)) {
          try { var url = new URL(picture); if (url.protocol !== 'https:' || url.username || url.password) picture = ''; } catch (ignored) { picture = ''; }
        }
        artistCard.innerHTML = (picture ? '<img class="np-artist-photo" src="' + esc(picture) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') +
          '<div class="np-artist-copy"><span class="eyebrow">Sobre o artista</span><h3>' + esc(data.name || track.artist) + '</h3><p>' + esc(data.biography || ((data.localTracks || []).length + ' músicas deste artista no seu acervo. Explore os destaques e os álbuns disponíveis.')) + '</p>' +
          '<button class="btn btn-ghost btn-sm" data-action="open-artist" data-artist="' + esc(track.artist) + '">Abrir perfil</button></div>';
      }).catch(function () {
        if (artistCard.dataset.artist === artistSignature) artistCard.innerHTML = '<div class="np-artist-copy"><span class="eyebrow">Sobre o artista</span><h3>' + esc(track.artist) + '</h3><p>O perfil está indisponível agora.</p><button class="btn btn-ghost btn-sm" data-action="open-artist" data-artist="' + esc(track.artist) + '">Ver músicas do artista</button></div>';
      });
    }
    var cur = AC.isRemotePlayback() ? AC.remotePosition() : audio.currentTime || 0;
    var total = expandedDuration();
    var seek = $('expanded-seek'); if (seek && !seek.dataset.dragging) seek.value = String(Math.round(Math.max(0, Math.min(1, cur / Math.max(1, total))) * 1000));
    var current = $('expanded-current'); if (current && (!seek || !seek.dataset.dragging)) current.textContent = AC.fmtTime(cur);
    var duration = $('expanded-duration'); if (duration) duration.textContent = AC.fmtTime(total);
    var toggle = $('expanded-toggle'); if (toggle) { toggle.innerHTML = icon(S.playing ? 'pause' : 'play', 26); toggle.setAttribute('aria-label', S.playing ? 'Pausar' : 'Tocar'); }
    var output = $('expanded-device'); if (output) output.textContent = window.__ACERVO_PHONE__ === true ? 'Ouvindo neste celular' : C.ready ? (activeHere() ? 'Ouvindo neste dispositivo' : 'Ouvindo em ' + activeName()) : 'Escolher dispositivo';
  };
  AC.onPlaybackBlocked = function () { C.needsGesture = true; paintConnection(); AC.toast('Toque em play neste dispositivo para continuar a música.'); };
  AC.onModalClose = function () { C.dialog = null; };
  AC.playerActions['connect-devices'] = AC.openDevices;
  AC.playerActions['connect-create'] = createPairing;
  AC.playerActions['connect-refresh-address'] = function () { return createPairing(true); };
  AC.playerActions['connect-remove-endpoint'] = function () { return saveEndpoint(true); };
  AC.playerActions['connect-internet-enable'] = function () { return manageInternet(true); };
  AC.playerActions['connect-internet-disable'] = function () { return manageInternet(false); };
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
