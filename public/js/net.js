// Sunucuyla WebSocket bağlantısı (otomatik yeniden bağlanır).
export class Net extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.connected = false;
    this.retry = 0;
    this.helloData = null;
  }

  connect(helloData) {
    this.helloData = helloData;
    this.open();
  }

  open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws;
    try { ws = new WebSocket(`${proto}://${location.host}/ws`); } catch { return this.scheduleReconnect(); }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.connected = true;
      this.send('hello', typeof this.helloData === 'function' ? this.helloData() : this.helloData);
      this.emit('status', { connected: true });
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.emit(msg.type, msg);
    };
    ws.onclose = () => {
      const was = this.connected;
      this.connected = false;
      if (was) this.emit('status', { connected: false });
      if (this.ws === ws) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  scheduleReconnect() {
    const delay = Math.min(15000, 1000 * 2 ** this.retry++);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.open(), delay);
  }

  send(type, data = {}) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type, ...data }));
      return true;
    }
    return false;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) { this.addEventListener(type, (e) => fn(e.detail)); }
}
