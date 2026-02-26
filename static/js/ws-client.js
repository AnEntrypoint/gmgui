class WsClient {
  constructor(wsManager) {
    this._ws = wsManager;
    this._pending = new Map();
    this._installed = false;
    this._install();
  }

  _install() {
    if (this._installed) return;
    this._installed = true;
    const origOnMessage = this._ws.onMessage.bind(this._ws);
    this._ws.onMessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        const passthrough = [];
        for (const msg of messages) {
          if (msg.r && this._pending.has(msg.r)) {
            const p = this._pending.get(msg.r);
            this._pending.delete(msg.r);
            clearTimeout(p.timer);
            if (msg.e) {
              p.reject(Object.assign(new Error(msg.e.m || 'RPC error'), { code: msg.e.c }));
            } else {
              p.resolve(msg.d);
            }
          } else {
            passthrough.push(msg);
          }
        }
        if (passthrough.length > 0) {
          const rebuilt = passthrough.length === 1
            ? JSON.stringify(passthrough[0])
            : JSON.stringify(passthrough);
          origOnMessage({ data: rebuilt });
        }
      } catch (_) {
        origOnMessage(event);
      }
    };
    this._ws.on('disconnected', () => this.cancelAll());
  }

  _id() {
    let id = '';
    for (let i = 0; i < 8; i++) id += ((Math.random() * 16) | 0).toString(16);
    return id;
  }

  request(method, params = {}, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const r = this._id();
      const timer = setTimeout(() => {
        this._pending.delete(r);
        reject(new Error(`RPC timeout: ${method}`));
      }, timeout);
      this._pending.set(r, { resolve, reject, timer });
      this._ws.sendMessage({ r, m: method, p: params });
    });
  }

  rpc(method, params) {
    return this.request(method, params);
  }

  cancelAll() {
    for (const [id, p] of this._pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Connection lost'));
    }
    this._pending.clear();
  }

  get pendingCount() {
    return this._pending.size;
  }
}

window.WsClient = WsClient;
