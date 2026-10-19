(function () {
  'use strict';
  var bridge = window.AcervoSecure;
  var key = '__ACERVO_DOCUMENT_NONCE__';
  if (!bridge || typeof window.fetch !== 'function' || window.top !== window) return;
  var original = window.fetch.bind(window), pending = new Map(), next = 1;
  function abortError() { return new DOMException('Operação cancelada.', 'AbortError'); }
  function bytes(base64) {
    var raw = atob(base64), result = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) result[i] = raw.charCodeAt(i);
    return result;
  }
  function encode(buffer) {
    var data = new Uint8Array(buffer), parts = [];
    for (var i = 0; i < data.length; i += 8192) parts.push(String.fromCharCode.apply(null, data.subarray(i, i + 8192)));
    return btoa(parts.join(''));
  }
  function finish(id) {
    var item = pending.get(id);
    if (item) { item.signal.removeEventListener('abort', item.abort); pending.delete(id); }
    return item;
  }
  window.__acervoSecureReceive = function (event) {
    if (!event || event.key !== key) return;
    var item = pending.get(event.id);
    if (!item) return;
    if (event.type === 'headers') {
      try {
        var stream = null;
        if (item.method !== 'HEAD' && event.status !== 204 && event.status !== 205 && event.status !== 304) {
          stream = new ReadableStream({
            start: function (controller) { item.controller = controller; },
            cancel: function () { finish(event.id); bridge.cancel(key, event.id); }
          });
        }
        var response = new Response(stream, { status: event.status, statusText: event.statusText || '', headers: event.headers });
        Object.defineProperty(response, 'url', { value: item.url });
        item.resolved = true;
        item.resolve(response);
      } catch (error) { finish(event.id); bridge.cancel(key, event.id); item.reject(error); }
    } else if (event.type === 'chunk') {
      try { if (item.controller) item.controller.enqueue(bytes(event.data)); }
      catch (error) { finish(event.id); bridge.cancel(key, event.id); }
    } else if (event.type === 'end') {
      finish(event.id);
      if (item.controller) item.controller.close();
    } else if (event.type === 'error') {
      finish(event.id);
      var failure = new TypeError(event.message || 'A conexão segura foi interrompida.');
      if (item.controller) item.controller.error(failure);
      if (!item.resolved) item.reject(failure);
    }
  };
  window.fetch = function (input, options) {
    var request;
    try { request = new Request(input, options); }
    catch (error) { return Promise.reject(error); }
    if (new URL(request.url).origin !== location.origin) return original(input, options);
    if (request.signal.aborted) return Promise.reject(abortError());
    return request.arrayBuffer().then(function (body) {
      if (body.byteLength > 1048576) throw new TypeError('Pedido maior que o limite de 1 MB.');
      if (request.signal.aborted) throw abortError();
      return new Promise(function (resolve, reject) {
        var id = next++;
        if (next > 2147483647) next = 1;
        var item = { resolve: resolve, reject: reject, signal: request.signal, method: request.method, url: request.url, resolved: false };
        item.abort = function () {
          if (!finish(id)) return;
          bridge.cancel(key, id);
          var failure = abortError();
          if (item.controller) item.controller.error(failure);
          if (!item.resolved) reject(failure);
        };
        pending.set(id, item);
        request.signal.addEventListener('abort', item.abort, { once: true });
        var headers = {};
        request.headers.forEach(function (value, name) { headers[name] = value; });
        try { bridge.request(key, id, request.method, request.url, JSON.stringify(headers), body.byteLength ? encode(body) : '', request.credentials !== 'omit'); }
        catch (error) { finish(id); reject(error); }
      });
    });
  };
  window.addEventListener('pagehide', function () {
    pending.forEach(function (item) { item.abort(); });
  });
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) location.reload();
  });
}());
