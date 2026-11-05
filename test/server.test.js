import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import WebSocket from 'ws';
import { createGameServer } from '../server/game-server.js';

function client(url) {
  const ws = new WebSocket(url);
  const queue = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    const i = waiters.findIndex((w) => w.type === msg.type);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg); else queue.push(msg);
  });
  return {
    ws,
    open: () => new Promise((r) => ws.once('open', r)),
    send: (type, data = {}) => ws.send(JSON.stringify({ type, ...data })),
    next(type, timeout = 5000) {
      const i = queue.findIndex((m) => m.type === type);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('zaman aşımı: ' + type)), timeout);
        waiters.push({ type, resolve: (m) => { clearTimeout(t); resolve(m); } });
      });
    },
  };
}

test('arkadaş ekleme, davet, ortak bölüm ve VS maçı', async () => {
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'okkup-')), 'players.json');
  const game = createGameServer({ port: 0, host: '127.0.0.1', dataFile });
  const { port } = await game.listen();
  const url = `ws://127.0.0.1:${port}/ws`;
  try {
    const a = client(url); const b = client(url);
    await Promise.all([a.open(), b.open()]);
    a.send('hello', { name: 'Ayşe', maxLevel: 8 });
    b.send('hello', { name: 'Burak', maxLevel: 5 });
    const wa = await a.next('welcome');
    const wb = await b.next('welcome');
    assert.match(wa.id, /^[A-Z0-9]{6}$/);

    a.send('addFriend', { code: wb.id.toLowerCase() });
    const fa = await (async () => { for (;;) { const m = await a.next('friends'); if (m.friends.length) return m; } })();
    assert.equal(fa.friends[0].name, 'Burak');
    assert.equal(fa.friends[0].online, true);

    // Ortak bölüm: 8 isteniyor ama Burak en fazla 5'te → 5'e indirilir.
    a.send('invite', { to: wb.id, level: 8 });
    const inv = await b.next('invited');
    assert.equal(inv.level, 5);
    assert.equal(inv.from.name, 'Ayşe');
    b.send('respondInvite', { inviteId: inv.inviteId, accept: true });
    const [sa, sb] = await Promise.all([a.next('matchStart'), b.next('matchStart')]);
    assert.equal(sa.seed, sb.seed, 'iki oyuncu da aynı bulmacayı almalı');
    assert.equal(sa.level, sb.level);
    assert.equal(sa.opponent.name, 'Burak');

    // Geri sayım bitmeden bitirmek sayılmaz.
    a.send('finish', { matchId: sa.matchId });
    b.send('progress', { matchId: sb.matchId, remaining: 3, total: 10 });
    const op = await a.next('opponentProgress');
    assert.equal(op.remaining, 3);
    await new Promise((r) => setTimeout(r, sa.startIn + 50));
    b.send('finish', { matchId: sb.matchId });
    const [ea, eb] = await Promise.all([a.next('matchEnd'), b.next('matchEnd')]);
    assert.equal(eb.you, 'win');
    assert.equal(ea.you, 'lose');
    assert.ok(eb.timeMs >= 0);

    // Kimlik ile tekrar bağlanınca arkadaşlar korunur.
    a.ws.close();
    const a2 = client(url); await a2.open();
    a2.send('hello', { id: wa.id, token: wa.token, maxLevel: 1 });
    const wa2 = await a2.next('welcome');
    assert.equal(wa2.id, wa.id);
    assert.equal(wa2.maxLevel, 8);
    assert.equal(wa2.friends.length, 1);
    assert.equal(wa2.losses, 1);

    // Yanlış token yeni hesap açar, eskisini ele geçiremez.
    const c = client(url); await c.open();
    c.send('hello', { id: wa.id, token: 'yanlis' });
    const wc = await c.next('welcome');
    assert.notEqual(wc.id, wa.id);
    a2.ws.close(); b.ws.close(); c.ws.close();
  } finally {
    await game.close();
  }
});

test('maç sırasında bağlantısı kopan kaybeder', async () => {
  const game = createGameServer({ port: 0, host: '127.0.0.1', dataFile: null });
  const { port } = await game.listen();
  const url = `ws://127.0.0.1:${port}/ws`;
  try {
    const a = client(url); const b = client(url);
    await Promise.all([a.open(), b.open()]);
    a.send('hello', { name: 'A' }); b.send('hello', { name: 'B' });
    await a.next('welcome'); const wb = await b.next('welcome');
    a.send('addFriend', { code: wb.id });
    await b.next('toast');
    a.send('invite', { to: wb.id });
    const inv = await b.next('invited');
    assert.equal(inv.level, 1);
    b.send('respondInvite', { inviteId: inv.inviteId, accept: true });
    await a.next('matchStart');
    b.ws.close();
    const end = await a.next('matchEnd');
    assert.equal(end.you, 'win');
    assert.equal(end.reason, 'disconnect');
    a.ws.close();
  } finally {
    await game.close();
  }
});

test('oyun dosyaları ve three.js sunuluyor', async () => {
  const game = createGameServer({ port: 0, host: '127.0.0.1', dataFile: null });
  const { port } = await game.listen();
  try {
    for (const p of ['/', '/js/main.js', '/js/puzzle.js', '/vendor/three/build/three.module.js',
      '/vendor/three/examples/jsm/controls/OrbitControls.js', '/health']) {
      const r = await fetch(`http://127.0.0.1:${port}${p}`);
      assert.equal(r.status, 200, p);
    }
  } finally {
    await game.close();
  }
});
