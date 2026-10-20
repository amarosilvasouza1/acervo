import net from 'node:net';

const REMOTE_HOST = 'bore.pub';
const REMOTE_PORT = 7835;
const LOCAL_HOST = '127.0.0.1';
const MAX_FRAME = 256;
const MAX_CHANNELS = 32;
const MAX_QUEUED_CHANNELS = 32;
const MAX_QUEUE_WAIT = 4000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function failure(message) { return Object.assign(new Error(message), { statusCode: 503 }); }
function frame(value) { return Buffer.from(JSON.stringify(value) + '\0'); }

/** Bore control framing follows github.com/ekzhang/bore/src/shared.rs.
 * Only opaque bytes go to the fixed Acervo mTLS listener; this module never terminates TLS.
 */
export function createBoreClient({ localPort = 4311, requestedPort = 0, connectSocket = options => net.createConnection(options), onClose } = {}) {
  if (!Number.isInteger(localPort) || localPort < 1 || localPort > 65535 || !Number.isInteger(requestedPort)
      || (requestedPort !== 0 && (requestedPort < 1024 || requestedPort > 65535)) || typeof connectSocket !== 'function') {
    throw Object.assign(new Error('Configuração da conexão TCP inválida.'), { statusCode: 500 });
  }
  let generation = 0;
  let state = 'offline';
  let publicEndpoint = null;
  let remotePort = null;
  let control = null;
  let closeCurrent = null;
  let starting = null;
  const sockets = new Set();
  const channels = new Map();

  function snapshot() { return { status: state, publicEndpoint, port: remotePort }; }
  function stop() {
    closeCurrent?.(failure('A conexão pela internet foi encerrada.'), true);
  }

  function start() {
    if (state === 'online') return Promise.resolve(snapshot());
    if (starting) return starting;
    state = 'connecting'; publicEndpoint = null; remotePort = null;
    const current = ++generation;
    let resolveStart, rejectStart;
    starting = new Promise((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
    const result = starting;
    let established = false;
    let closed = false;
    let pending = Buffer.alloc(0);
    const seen = new Set(); const seenOrder = [];
    const queued = new Map();
    const timer = setTimeout(() => shutdown(failure('O intermediário não respondeu a tempo.')), 5000);

    function shutdown(error, manual = false) {
      if (closed || current !== generation) return;
      closed = true;
      clearTimeout(timer);
      closeCurrent = null; starting = null; state = 'offline'; publicEndpoint = null; remotePort = null;
      for (const queuedTimer of queued.values()) clearTimeout(queuedTimer);
      queued.clear();
      channels.clear();
      for (const socket of sockets) socket.destroy();
      sockets.clear(); control = null;
      if (!established) rejectStart(error);
      else if (!manual && typeof onClose === 'function') { try { onClose(error); } catch {} }
    }
    closeCurrent = shutdown;

    function socket(options) {
      const value = connectSocket(options);
      sockets.add(value);
      value.once('close', () => sockets.delete(value));
      value.setNoDelay(true);
      return value;
    }

    function accept(id) {
      if (channels.has(id) || queued.has(id) || seen.has(id)) return;
      seen.add(id); seenOrder.push(id);
      if (seenOrder.length > 256) seen.delete(seenOrder.shift());
      if (channels.size >= MAX_CHANNELS) {
        if (queued.size < MAX_QUEUED_CHANNELS) queued.set(id, setTimeout(() => queued.delete(id), MAX_QUEUE_WAIT));
        return;
      }
      openChannel(id);
    }

    function drain() {
      while (!closed && channels.size < MAX_CHANNELS && queued.size) {
        const [id, queuedTimer] = queued.entries().next().value;
        queued.delete(id); clearTimeout(queuedTimer);
        openChannel(id);
      }
    }

    function openChannel(id) {
      const pair = { remote: null, local: null, closed: false };
      channels.set(id, pair);
      const timeout = setTimeout(finish, 5000);
      function finish() {
        if (pair.closed) return;
        pair.closed = true; clearTimeout(timeout); channels.delete(id);
        pair.remote?.destroy(); pair.local?.destroy();
        drain();
      }
      try {
        pair.remote = socket({ host: REMOTE_HOST, port: REMOTE_PORT });
        pair.remote.once('error', finish); pair.remote.once('close', finish);
        pair.remote.once('connect', () => {
          if (closed || pair.closed) return finish();
          pair.remote.write(frame({ Accept: id }), () => {
            if (closed || pair.closed) return finish();
            try {
              pair.local = socket({ host: LOCAL_HOST, port: localPort });
              pair.local.once('error', finish); pair.local.once('close', finish);
              pair.local.once('connect', () => {
                if (closed || pair.closed) return finish();
                clearTimeout(timeout);
                pair.remote.pipe(pair.local); pair.local.pipe(pair.remote);
              });
            } catch { finish(); }
          });
        });
      } catch { finish(); }
    }

    function message(value) {
      if (closed) return;
      if (value === 'Heartbeat' && established) return;
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1) return shutdown(failure('O intermediário enviou uma resposta inválida.'));
      if (!established && Object.hasOwn(value, 'Hello') && Number.isInteger(value.Hello) && value.Hello >= 1024 && value.Hello <= 65535) {
        established = true; clearTimeout(timer); control.setTimeout(0); state = 'online'; starting = null;
        remotePort = value.Hello; publicEndpoint = 'https://' + REMOTE_HOST + ':' + remotePort;
        resolveStart(snapshot()); return;
      }
      if (established && typeof value.Connection === 'string' && UUID.test(value.Connection)) return accept(value.Connection);
      if (Object.hasOwn(value, 'Challenge')) return shutdown(failure('O intermediário exige uma credencial de acesso.'));
      return shutdown(failure('O intermediário encerrou a conexão ou enviou uma resposta inválida.'));
    }

    try {
      control = socket({ host: REMOTE_HOST, port: REMOTE_PORT });
      control.setKeepAlive(true, 5000);
      // Bore specifies a handshake deadline, but no application idle deadline.
      // A quiet established connection stays open; TCP keepalive detects a broken peer.
      control.once('error', () => shutdown(failure('Não foi possível conectar ao intermediário pela internet.')));
      control.once('close', () => shutdown(failure('O intermediário desconectou.')));
      control.once('connect', () => { if (!closed) control.write(frame({ Hello: requestedPort })); });
      control.on('data', chunk => {
        if (closed) return;
        pending = Buffer.concat([pending, chunk]);
        while (!closed) {
          const index = pending.indexOf(0);
          if (index < 0) { if (pending.length > MAX_FRAME) shutdown(failure('O intermediário enviou uma mensagem grande demais.')); return; }
          if (index > MAX_FRAME) return shutdown(failure('O intermediário enviou uma mensagem grande demais.'));
          const currentFrame = pending.subarray(0, index); pending = pending.subarray(index + 1);
          try { message(JSON.parse(currentFrame.toString('utf8'))); }
          catch { return shutdown(failure('O intermediário enviou uma mensagem inválida.')); }
        }
      });
    } catch { shutdown(failure('Não foi possível iniciar a conexão pela internet.')); }
    return result;
  }

  return { start, stop, snapshot };
}
