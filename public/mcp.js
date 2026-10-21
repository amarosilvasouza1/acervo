/* Ponte local entre o servidor MCP e a aba Web do Acervo. */
(function () {
  var host = location.hostname;
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return;
  var busy = false;
  var seen = null;

  function api(path, options) {
    return fetch(path, Object.assign({ cache: 'no-store', credentials: 'same-origin' }, options || {}));
  }

  function execute(command) {
    var AC = window.AC;
    if (!AC || !AC.state) return false;
    var state = AC.state;
    if (command.action === 'play') {
      if (!command.trackId || !AC.trackById(command.trackId)) return false;
      if (Array.isArray(command.queue) && command.queue.length) {
        state.queue = command.queue.slice();
        state.qi = Math.max(0, Math.min(state.queue.length - 1, Number(command.qi) || 0));
      }
      AC.play(command.trackId, { keepQueue: true, queueIndex: state.qi, keepRadio: true, localOnly: true });
      return true;
    }
    if (command.action === 'pause' || command.action === 'stop') {
      if (state.playing) AC.toggle();
      return true;
    }
    if (command.action === 'resume') {
      if (!state.playing) AC.toggle();
      return true;
    }
    if (command.action === 'next') { AC.next(false); return true; }
    if (command.action === 'previous') { AC.prev(); return true; }
    if (command.action === 'seek') {
      var audio = document.getElementById('audio');
      if (!audio) return false;
      audio.currentTime = Math.max(0, Math.min(Number(command.position) || 0, Number(audio.duration) || 86400));
      return true;
    }
    return true;
  }

  function report() {
    var AC = window.AC;
    if (!AC || !AC.state) return;
    var audio = document.getElementById('audio');
    var body = {
      playing: !!AC.state.playing,
      trackId: AC.state.current ? AC.state.current.id : null,
      position: audio ? Number(audio.currentTime) || 0 : 0,
      duration: audio ? Number(audio.duration) || 0 : 0,
      queue: Array.isArray(AC.state.queue) ? AC.state.queue.length : 0,
      qi: Number.isInteger(AC.state.qi) ? AC.state.qi : -1
    };
    fetch('/api/mcp/state', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch(function () {});
  }

  async function tick() {
    if (busy || !window.AC) return;
    busy = true;
    try {
      var response = await api('/api/mcp/command');
      if (response.ok) {
        var data = await response.json();
        var command = data && data.command;
        if (command && command.id !== seen && execute(command)) {
          seen = command.id;
          await api('/api/mcp/ack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: command.id })
          });
          report();
        }
      }
    } catch (_) {
      /* o host local pode estar reiniciando; tenta no próximo ciclo */
    } finally {
      busy = false;
    }
  }

  window.__acervoMcpBridge = true;
  setInterval(tick, 1200);
  setInterval(report, 2500);
  setTimeout(tick, 800);
  setTimeout(report, 1500);
})();
