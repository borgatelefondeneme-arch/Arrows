// Ok Küp sunucusu: oyunun dosyalarını sunar, arkadaş listesini tutar ve VS maçlarını yönetir.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { levelConfig } from '../public/js/puzzle.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const COUNTDOWN_MS = 3000;
const INVITE_TTL_MS = 60_000;

function randomCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return s;
}

function cleanName(name) {
  const n = String(name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
  return n || 'Oyuncu';
}

const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

class PlayerStore {
  constructor(file) {
    this.file = file;
    this.players = new Map();
    this.saveTimer = null;
    if (file && fs.existsSync(file)) {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        for (const p of data.players || []) {
          this.players.set(p.id, { ...p, friends: new Set(p.friends || []) });
        }
      } catch (e) {
        console.error('Oyuncu verisi okunamadı, boş başlıyor:', e.message);
      }
    }
  }

  create(name, maxLevel) {
    let id;
    do id = randomCode(); while (this.players.has(id));
    const token = crypto.randomBytes(24).toString('hex');
    const p = {
      id, name: cleanName(name), tokenHash: hashToken(token),
      friends: new Set(), maxLevel: clampLevel(maxLevel), wins: 0, losses: 0,
    };
    this.players.set(id, p);
    this.save();
    return { player: p, token };
  }

  auth(id, token) {
    const p = this.players.get(String(id ?? '').toUpperCase());
    if (!p || !token) return null;
    const a = Buffer.from(p.tokenHash, 'hex');
    const b = Buffer.from(hashToken(token), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? p : null;
  }

  save() {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    if (!this.file) return;
    clearTimeout(this.saveTimer);
    const data = {
      players: [...this.players.values()].map((p) => ({ ...p, friends: [...p.friends] })),
    };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, this.file);
  }
}

function clampLevel(n) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v >= 1 ? Math.min(v, 9999) : 1;
}

export function createGameServer({ port = 3000, host, dataFile = path.join(ROOT, 'data', 'players.json') } = {}) {
  const app = express();
  const store = new PlayerStore(dataFile);
  const online = new Map(); // id -> ws
  const invites = new Map(); // inviteId -> {id, from, to, level, expires}
  const matches = new Map(); // matchId -> match

  app.disable('x-powered-by');
  app.get('/health', (_req, res) => res.json({ ok: true, online: online.size }));
  app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three'), { maxAge: '7d' }));
  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  const send = (ws, type, data = {}) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, ...data }));
  };
  const sendTo = (id, type, data) => send(online.get(id), type, data);

  const friendList = (p) => [...p.friends]
    .map((fid) => store.players.get(fid))
    .filter(Boolean)
    .map((f) => ({
      id: f.id, name: f.name, maxLevel: f.maxLevel, online: online.has(f.id),
      inMatch: !!findMatchOf(f.id), wins: f.wins, losses: f.losses,
    }))
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, 'tr'));

  const pushFriends = (id) => {
    const p = store.players.get(id);
    if (p) sendTo(id, 'friends', { friends: friendList(p) });
  };
  const pushFriendsOfFriends = (p) => { for (const fid of p.friends) pushFriends(fid); };

  function findMatchOf(id) {
    for (const m of matches.values()) if (!m.over && m.players.includes(id)) return m;
    return null;
  }

  function endMatch(m, winnerId, reason) {
    if (m.over) return;
    m.over = true;
    const loserId = m.players.find((x) => x !== winnerId);
    const w = store.players.get(winnerId);
    const l = store.players.get(loserId);
    if (w) w.wins++;
    if (l) l.losses++;
    store.save();
    const timeMs = m.finished[winnerId] ?? null;
    for (const pid of m.players) {
      sendTo(pid, 'matchEnd', {
        matchId: m.id, winner: winnerId, you: pid === winnerId ? 'win' : 'lose', reason, timeMs,
        opponentRemaining: m.progress[pid === winnerId ? loserId : winnerId] ?? null,
      });
    }
    setTimeout(() => matches.delete(m.id), 10_000).unref?.();
    for (const pid of m.players) {
      const p = store.players.get(pid);
      if (p) pushFriendsOfFriends(p);
    }
  }

  function startMatch(aId, bId, level) {
    const cfg = levelConfig(level);
    const m = {
      id: randomCode(10),
      players: [aId, bId],
      level,
      seed: crypto.randomBytes(4).readUInt32LE(0),
      startAt: Date.now() + COUNTDOWN_MS,
      progress: {},
      finished: {},
      over: false,
    };
    matches.set(m.id, m);
    for (const pid of m.players) {
      const opp = store.players.get(m.players.find((x) => x !== pid));
      sendTo(pid, 'matchStart', {
        matchId: m.id, level, levelName: cfg.name, seed: m.seed, startIn: COUNTDOWN_MS,
        opponent: { id: opp.id, name: opp.name },
      });
    }
    for (const pid of m.players) pushFriendsOfFriends(store.players.get(pid));
  }

  const handlers = {
    hello(ws, msg) {
      let p = store.auth(msg.id, msg.token);
      let token = msg.token;
      if (!p) ({ player: p, token } = store.create(msg.name, msg.maxLevel));
      else {
        if (msg.name) p.name = cleanName(msg.name);
        p.maxLevel = Math.max(p.maxLevel, clampLevel(msg.maxLevel));
        store.save();
      }
      const old = online.get(p.id);
      if (old && old !== ws) { send(old, 'kicked', { reason: 'Başka bir cihazdan bağlanıldı.' }); old.close(); }
      ws.playerId = p.id;
      online.set(p.id, ws);
      send(ws, 'welcome', {
        id: p.id, token, name: p.name, maxLevel: p.maxLevel, wins: p.wins, losses: p.losses,
        friends: friendList(p),
      });
      pushFriendsOfFriends(p);
    },

    setName(ws, msg, p) {
      p.name = cleanName(msg.name);
      store.save();
      pushFriendsOfFriends(p);
    },

    setProgress(ws, msg, p) {
      p.maxLevel = Math.max(p.maxLevel, clampLevel(msg.maxLevel));
      store.save();
      pushFriendsOfFriends(p);
    },

    addFriend(ws, msg, p) {
      const code = String(msg.code ?? '').trim().toUpperCase();
      const f = store.players.get(code);
      if (!f) return send(ws, 'error', { message: 'Bu koda sahip oyuncu bulunamadı.' });
      if (f.id === p.id) return send(ws, 'error', { message: 'Kendini arkadaş olarak ekleyemezsin 🙂' });
      p.friends.add(f.id);
      f.friends.add(p.id);
      store.save();
      pushFriends(p.id);
      pushFriends(f.id);
      sendTo(f.id, 'toast', { message: `${p.name} seni arkadaş olarak ekledi!` });
      send(ws, 'toast', { message: `${f.name} arkadaşlarına eklendi.` });
    },

    removeFriend(ws, msg, p) {
      const f = store.players.get(String(msg.code ?? '').toUpperCase());
      if (!f) return;
      p.friends.delete(f.id);
      f.friends.delete(p.id);
      store.save();
      pushFriends(p.id);
      pushFriends(f.id);
    },

    invite(ws, msg, p) {
      const f = store.players.get(String(msg.to ?? '').toUpperCase());
      if (!f || !p.friends.has(f.id)) return send(ws, 'error', { message: 'Önce bu oyuncuyu arkadaş olarak ekle.' });
      if (!online.has(f.id)) return send(ws, 'error', { message: `${f.name} şu an çevrimdışı.` });
      if (findMatchOf(f.id) || findMatchOf(p.id)) return send(ws, 'error', { message: 'Oyunculardan biri zaten bir maçta.' });
      // Ortak bölüm: ikinizin de açtığı en yüksek bölümü geçemez.
      const common = Math.min(p.maxLevel, f.maxLevel);
      const level = Math.min(clampLevel(msg.level ?? common), common);
      const inv = { id: randomCode(10), from: p.id, to: f.id, level, expires: Date.now() + INVITE_TTL_MS };
      invites.set(inv.id, inv);
      sendTo(f.id, 'invited', {
        inviteId: inv.id, from: { id: p.id, name: p.name }, level, levelName: levelConfig(level).name,
      });
      send(ws, 'inviteSent', { inviteId: inv.id, to: { id: f.id, name: f.name }, level, levelName: levelConfig(level).name });
    },

    cancelInvite(ws, msg, p) {
      const inv = invites.get(msg.inviteId);
      if (inv && inv.from === p.id) {
        invites.delete(inv.id);
        sendTo(inv.to, 'inviteCancelled', { inviteId: inv.id });
      }
    },

    respondInvite(ws, msg, p) {
      const inv = invites.get(msg.inviteId);
      if (!inv || inv.to !== p.id) return send(ws, 'error', { message: 'Davet artık geçerli değil.' });
      invites.delete(inv.id);
      if (inv.expires < Date.now()) return send(ws, 'error', { message: 'Davetin süresi doldu.' });
      if (!msg.accept) return sendTo(inv.from, 'inviteDeclined', { inviteId: inv.id, by: p.name });
      if (!online.has(inv.from)) return send(ws, 'error', { message: 'Davet eden oyuncu çevrimdışı oldu.' });
      if (findMatchOf(inv.from) || findMatchOf(p.id)) return send(ws, 'error', { message: 'Oyunculardan biri zaten bir maçta.' });
      startMatch(inv.from, inv.to, inv.level);
    },

    progress(ws, msg, p) {
      const m = matches.get(msg.matchId);
      if (!m || m.over || !m.players.includes(p.id)) return;
      const remaining = Math.max(0, Math.floor(Number(msg.remaining) || 0));
      m.progress[p.id] = remaining;
      const opp = m.players.find((x) => x !== p.id);
      sendTo(opp, 'opponentProgress', { matchId: m.id, remaining, total: Number(msg.total) || 0, bumps: Number(msg.bumps) || 0 });
    },

    finish(ws, msg, p) {
      const m = matches.get(msg.matchId);
      if (!m || m.over || !m.players.includes(p.id)) return;
      const now = Date.now();
      if (now < m.startAt) return; // geri sayım bitmeden bitirilemez
      m.finished[p.id] = now - m.startAt;
      m.progress[p.id] = 0;
      // Sunucuya ilk ulaşan bitiriş kazanır: iki oyuncu için de aynı saat kullanılır.
      endMatch(m, p.id, 'finished');
    },

    leaveMatch(ws, msg, p) {
      const m = findMatchOf(p.id);
      if (m) endMatch(m, m.players.find((x) => x !== p.id), 'forfeit');
    },

    ping(ws, msg) { send(ws, 'pong', { t: msg.t, serverNow: Date.now() }); },
  };

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.type !== 'string' || !Object.hasOwn(handlers, msg.type)) return;
      if (msg.type === 'hello' || msg.type === 'ping') return handlers[msg.type](ws, msg);
      const p = ws.playerId && store.players.get(ws.playerId);
      if (!p) return send(ws, 'error', { message: 'Önce bağlan.' });
      handlers[msg.type](ws, msg, p);
    });
    ws.on('close', () => {
      const id = ws.playerId;
      if (!id || online.get(id) !== ws) return;
      online.delete(id);
      const m = findMatchOf(id);
      if (m) endMatch(m, m.players.find((x) => x !== id), 'disconnect');
      const p = store.players.get(id);
      if (p) pushFriendsOfFriends(p);
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
    const now = Date.now();
    for (const [id, inv] of invites) if (inv.expires < now) invites.delete(id);
  }, 30_000);
  heartbeat.unref?.();

  return {
    app, server, wss, store,
    listen() {
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
    },
    async close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      store.flush();
      await new Promise((r) => server.close(r));
    },
  };
}
