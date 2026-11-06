// Ok Küp – arayüz ve oyun akışı.
import { generatePuzzle, levelConfig, levelSeed, PuzzleState, scoreFor, cleanBonus, BUMP_STUN_MS } from './puzzle.js';
import { GameScene } from './scene.js';
import { Net } from './net.js';
import * as storage from './storage.js';
import { sfx, unlock as unlockAudio } from './sound.js';

const $ = (s) => document.querySelector(s);
// Tek dosyalık internetsiz sürümde sunucu ve VS kapalı.
const OFFLINE = !!window.OKKUP_OFFLINE;
const HINT_PENALTY_MS = 5000;

const store = storage.load();
const persist = () => storage.save(store);
let me = { id: store.id, name: store.name, wins: 0, losses: 0 };
let friends = [];
let game = null;
let scene = null;
let pendingInvite = null; // gönderdiğimiz davet

// iOS: sayfa yakınlaştırmasını ve çift dokunma büyütmesini engelle (küp kendi yakınlaşır).
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('pointerdown', unlockAudio, { once: true });

// ---- Yardımcılar ----------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtTime(ms) {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const d = Math.floor((t % 1000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${d}`;
}

const starsHtml = (n) => [1, 2, 3].map((i) => `<span class="star ${i <= n ? 'on' : ''}">★</span>`).join('');

let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function showModal(html, actions = {}, { dismissable = false } = {}) {
  const modal = $('#modal');
  const card = $('#modal-card');
  card.innerHTML = html;
  modal.hidden = false;
  modal.onclick = (e) => { if (dismissable && e.target === modal) closeModal(); };
  card.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fn = actions[btn.dataset.action];
      if (fn) fn(card); else closeModal();
    });
  });
  return card;
}
function closeModal() { $('#modal').hidden = true; $('#modal').dataset.kind = ''; }

// ---- Ekranlar -------------------------------------------------------------
const history = [];
function show(name, { push = true } = {}) {
  const current = document.querySelector('.screen.active');
  if (current && push && current.id !== `screen-${name}`) history.push(current.id.replace('screen-', ''));
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `screen-${name}`));
  if (name === 'home') { history.length = 0; renderHome(); setTimeout(renderHomePreview, 30); }
  else homeScene?.setActive(false);
  if (name === 'friends') renderFriends();
}
function back() { show(history.pop() || 'home', { push: false }); }
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', back));

function renderHome() {
  $('#home-level').textContent = store.maxLevel;
  $('#home-stars').textContent = storage.totalStars(store);
  $('#home-score').textContent = storage.totalScore(store).toLocaleString('tr-TR');
  $('#play-sub').textContent = `Bölüm ${store.maxLevel}`;
}


function renderFriends() {
  $('#my-name').value = store.name || '';
  $('#my-code').textContent = me.id || '——————';
  $('#my-record').textContent = me.id ? `VS: ${me.wins} galibiyet · ${me.losses} mağlubiyet` : '';
  $('#friends-offline-note').hidden = net.connected;
  const list = $('#friend-list');
  if (!friends.length) {
    list.innerHTML = `<div class="empty">Henüz arkadaşın yok.<br>Kodunu paylaş ya da arkadaşının kodunu ekle!</div>`;
    return;
  }
  list.innerHTML = friends.map((f) => {
    const status = f.inMatch ? 'Maçta' : f.online ? 'Çevrimiçi' : 'Çevrimdışı';
    const cls = f.inMatch ? 'busy' : f.online ? 'online' : '';
    const can = f.online && !f.inMatch && net.connected;
    return `<div class="friend ${cls}">
      <div class="avatar">${esc(f.name.slice(0, 1).toUpperCase())}</div>
      <div class="info">
        <div class="fname">${esc(f.name)}</div>
        <div class="fsub">${status} · Bölüm ${f.maxLevel} · ${f.wins}G/${f.losses}M</div>
      </div>
      <button class="btn small vs" data-vs="${esc(f.id)}" ${can ? '' : 'disabled'}>⚔️ VS</button>
      <button class="x" data-remove="${esc(f.id)}" aria-label="Kaldır">✕</button>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-vs]').forEach((b) => b.addEventListener('click', () => openInviteDialog(b.dataset.vs)));
  list.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    const f = friends.find((x) => x.id === b.dataset.remove);
    showModal(`<h2>Arkadaşı kaldır?</h2><p>${esc(f?.name)} listenden çıkarılacak.</p>
      <div class="actions"><button class="btn vs" data-action="yes">Kaldır</button><button class="btn" data-action="no">Vazgeç</button></div>`,
    { yes: () => { net.send('removeFriend', { code: b.dataset.remove }); closeModal(); } });
  }));
}

// ---- Ana menü düğmeleri ----------------------------------------------------
$('#btn-play').addEventListener('click', () => startSolo(store.maxLevel));
$('#btn-friends').addEventListener('click', () => {
  show('friends');
  if (!store.name) askName();
});
$('#btn-howto').addEventListener('click', showHowTo);

function showHowTo() {
  showModal(`<h2>Nasıl oynanır?</h2>
    <ul class="howto">
      <li>Küpün yüzeyindeki bir <b>oka dokun</b>: ok sadece <b>ucunun gösterdiği yöne</b> kayar, gövdesi yolunu izler ve küpten çıkar.</li>
      <li>Ucunun önünde başka bir ok varsa <b>çarpar</b> ve geri döner — oklar birbirinin içinden geçemez. Çarpınca kısa süre sersemlersin!</li>
      <li>Minik dostun küpün <b>en zor noktasında okların arasına sıkışmış</b>. Önündeki dört yönden birinde kenara kadar yol açılınca koşarak kaçar ve bölüm geçilir.</li>
      <li>Oklar dostunun içinden de geçemez. Kurtarınca köşedeki <b>Sonraki bölüm</b> ile devam et ya da kalan okları da bitirip bonus ve ◆ kazan.</li>
      <li>Ne kadar hızlı bitirirsen o kadar çok <b>puan</b> ve ★ alırsın. İpucu süreye 5 sn ekler.</li>
      <li>Bir parmakla kaydırarak küpü <b>her yöne çevir</b>, iki parmakla fotoğraf gibi <b>büyüt/küçült</b> ve kaydır. Boş yere çift dokununca görünüm sıfırlanır.</li>
      ${OFFLINE ? '' : '<li>⚔️ VS: arkadaşınla <b>ikinizin de açtığı ortak bir bölümde</b>, aynı bulmacada, aynı anda başlarsınız. Karakteri ilk kurtaran kazanır!</li>'}
    </ul>
    <div class="actions"><button class="btn primary" data-action="ok">Anladım!</button></div>`, {}, { dismissable: true });
}

function askName(then) {
  showModal(`<div class="big-emoji">👋</div><h2>Adın ne?</h2><p>Arkadaşların seni bu adla görecek.</p>
    <input id="name-input" maxlength="20" placeholder="Adın" style="width:100%;font:inherit;font-size:20px;font-weight:800;padding:12px;border-radius:14px;border:2px solid #ddd8ff;text-align:center">
    <div class="actions"><button class="btn primary" data-action="ok">Tamam</button></div>`,
  { ok: (card) => {
    const v = card.querySelector('#name-input').value.trim();
    if (!v) return;
    setName(v);
    closeModal();
    then?.();
  } });
  setTimeout(() => $('#name-input')?.focus(), 50);
}

function setName(v) {
  store.name = v.slice(0, 20);
  persist();
  me.name = store.name;
  net.send('setName', { name: store.name });
  if ($('#screen-friends').classList.contains('active')) renderFriends();
}

$('#btn-save-name').addEventListener('click', () => {
  const v = $('#my-name').value.trim();
  if (v) { setName(v); toast('Adın kaydedildi.'); }
});

$('#btn-share-code').addEventListener('click', async () => {
  if (!me.id) return toast('Önce sunucuya bağlanmalısın.');
  const text = `Ok Küp'te benimle VS yap! Arkadaş kodum: ${me.id}\n${location.origin}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Ok Küp', text });
    else { await navigator.clipboard.writeText(text); toast('Kopyalandı!'); }
  } catch { /* kullanıcı vazgeçti */ }
});

$('#btn-add-friend').addEventListener('click', () => {
  const code = $('#friend-code').value.trim().toUpperCase();
  if (code.length < 6) return toast('Kod 6 karakter olmalı.');
  if (!net.send('addFriend', { code })) return toast('Sunucuya bağlı değilsin.');
  $('#friend-code').value = '';
});

// ---- VS davetleri -----------------------------------------------------------
function openInviteDialog(friendId) {
  const f = friends.find((x) => x.id === friendId);
  if (!f) return;
  const common = Math.max(1, Math.min(store.maxLevel, f.maxLevel));
  let opts = '';
  for (let lv = common; lv >= 1; lv--) opts += `<option value="${lv}">Bölüm ${lv} – ${esc(levelConfig(lv).name)}</option>`;
  showModal(`<div class="big-emoji">⚔️</div><h2>${esc(f.name)} ile VS</h2>
    <p>İkinizin de açtığı ortak bölümlerden birini seç. Aynı bulmaca ikinize de gelecek.</p>
    <select id="vs-level">${opts}</select>
    <div class="actions"><button class="btn vs" data-action="send">Davet gönder</button><button class="btn" data-action="cancel">Vazgeç</button></div>`,
  { send: (card) => {
    const level = Number(card.querySelector('#vs-level').value);
    if (!store.name) return askName(() => net.send('invite', { to: f.id, level }));
    net.send('invite', { to: f.id, level });
  } }, { dismissable: true });
}

function showWaitingInvite(msg) {
  pendingInvite = msg;
  showModal(`<div class="big-emoji">⏳</div><h2>Davet gönderildi</h2>
    <p>${esc(msg.to.name)} bekleniyor…<br>Bölüm ${msg.level} – ${esc(msg.levelName)}</p>
    <div class="actions"><button class="btn" data-action="cancel">İptal</button></div>`,
  { cancel: () => { net.send('cancelInvite', { inviteId: msg.inviteId }); pendingInvite = null; closeModal(); } });
}

function showIncomingInvite(msg) {
  sfx.pop();
  $('#modal').dataset.kind = `invite:${msg.inviteId}`;
  showModal(`<div class="big-emoji">⚔️</div><h2>Düello daveti!</h2>
    <p><b>${esc(msg.from.name)}</b> seni yarışmaya çağırıyor.</p>
    <p>Bölüm ${msg.level} – ${esc(msg.levelName)}</p>
    <div class="actions"><button class="btn primary" data-action="yes">Kabul et</button><button class="btn" data-action="no">Reddet</button></div>`,
  {
    yes: () => { net.send('respondInvite', { inviteId: msg.inviteId, accept: true }); closeModal(); },
    no: () => { net.send('respondInvite', { inviteId: msg.inviteId, accept: false }); closeModal(); },
  });
}

// ---- Oyun -----------------------------------------------------------------
function ensureScene() {
  if (!scene) scene = new GameScene($('#stage'), { onTap, arrowAt: (cell) => (game ? game.state.arrowAt(cell) : null) });
  return scene;
}

// Aynı bölümü iki kez üretmemek için küçük önbellek (ana ekran önizlemesi + oyun)
const puzzleCache = new Map();
function getPuzzle(level) {
  if (!puzzleCache.has(level)) {
    if (puzzleCache.size > 4) puzzleCache.delete(puzzleCache.keys().next().value);
    puzzleCache.set(level, generatePuzzle(level, levelSeed(level)));
  }
  return puzzleCache.get(level);
}

// Ana ekranın arkasında sıradaki bölümün küpü yavaşça döner
let homeScene = null;
let homeLevel = 0;
function renderHomePreview() {
  if (!$('#screen-home').classList.contains('active')) return;
  if (!homeScene) {
    homeScene = new GameScene($('#home-stage'), {});
    homeScene.autoSpin = true;
  }
  homeScene.setActive(true);
  if (homeLevel !== store.maxLevel) {
    homeLevel = store.maxLevel;
    homeScene.load(getPuzzle(store.maxLevel));
    homeScene.dist = homeScene.baseDistance * 1.7;
    homeScene.pan.set(0, -homeScene.baseDistance * 0.06);
  }
}

function startSolo(level) {
  const puzzle = getPuzzle(level);
  beginGame({ puzzle, mode: 'solo', level, startIn: 2400 });
}

function beginGame({ puzzle, mode, level, match = null, startIn = 3000 }) {
  closeModal();
  if (game?.timerRaf) cancelAnimationFrame(game.timerRaf);
  show('game');
  ensureScene().load(puzzle);
  game = {
    puzzle, mode, level, match,
    state: new PuzzleState(puzzle),
    running: false, ended: false, bumps: 0, hints: 0, penaltyMs: 0,
    startTime: 0, stunUntil: 0, timerRaf: 0,
  };
  $('#btn-next').hidden = true;
  $('#btn-next').classList.remove('pulse');
  $('#result-strip').hidden = true;
  $('#hud-level').textContent = `${mode === 'vs' ? 'VS · ' : ''}Bölüm ${level} · ${puzzle.name}`;
  $('#hud-timer').textContent = fmtTime(0);
  $('#btn-hint').hidden = mode === 'vs';
  $('#vs-bar').hidden = mode !== 'vs';
  if (mode === 'vs') {
    $('#vs-opp-name').textContent = match.opponent.name;
    $('#vs-me').style.width = '0%';
    $('#vs-opp').style.width = '0%';
  }
  updateHud();
  runCountdown(startIn, () => {
    if (!game || game.puzzle !== puzzle || game.ended) return;
    game.running = true;
    game.startTime = performance.now();
    tickTimer();
    if (level <= 2 && mode === 'solo') showTutorial();
    if (level === 1 && mode === 'solo') setTimeout(() => toast('Bir parmakla çevir · iki parmakla büyüt', 3200), 1800);
  });
}

function runCountdown(ms, done) {
  const el = $('#countdown');
  const startAt = performance.now() + ms;
  el.hidden = false;
  let last = null;
  const step = () => {
    const left = startAt - performance.now();
    if (left <= 0) {
      el.innerHTML = '<span>Başla!</span>';
      sfx.go();
      setTimeout(() => { el.hidden = true; }, 500);
      done();
      return;
    }
    const n = Math.ceil(left / 1000);
    if (n !== last) { last = n; el.innerHTML = `<span>${n}</span>`; sfx.tick(); }
    requestAnimationFrame(step);
  };
  step();
}

const elapsed = () => (game ? performance.now() - game.startTime + game.penaltyMs : 0);

function tickTimer() {
  if (!game || !game.running) return;
  $('#hud-timer').textContent = fmtTime(elapsed());
  const stunned = performance.now() < game.stunUntil;
  $('#stun').hidden = !stunned;
  game.timerRaf = requestAnimationFrame(tickTimer);
}

function updateHud() {
  if (!game) return;
  const { state } = game;
  const before = !state.rescued;
  $('#hud-remaining').textContent = before ? state.escapeCost : state.remaining;
  $('#hud-unit').textContent = before ? 'engel' : 'ok kaldı';
  if (game.mode === 'vs') $('#vs-me').style.width = `${100 * state.progress}%`;
}

function onTap(id) {
  if (!game || !game.running) return;
  if (performance.now() < game.stunUntil) return;
  const r = game.state.tryMove(id);
  if (r.gone) return;
  if (r.ok) {
    scene.animateRemove(id);
    sfx.whoosh();
    hideTutorial();
    if (r.rescued !== undefined) scene.rescue(r.rescued);
  } else {
    scene.animateBump(id, r.steps, r.hit);
    sfx.bump();
    game.bumps++;
    game.stunUntil = performance.now() + BUMP_STUN_MS;
  }
  updateHud();
  if (game.mode === 'vs') {
    const total = game.state.required.size;
    net.send('progress', { matchId: game.match.matchId, remaining: Math.round(total * (1 - game.state.progress)), total, bumps: game.bumps });
  }
  if (game.cleanup && game.state.allCleared) finishCleanup();
  else if (game.state.solved && !game.rescueDone) finishGame();
}

$('#btn-reset-view').addEventListener('click', () => scene?.resetView());
$('#btn-hint').addEventListener('click', () => {
  if (!game?.running || game.mode !== 'solo') return;
  const free = game.puzzle.arrows.filter((a) => game.state.isFree(a.id));
  if (!free.length) return;
  // Önce kilide giden yoldaki oklardan birini göster.
  const useful = free.filter((a) => game.state.required.has(a.id));
  const pool = useful.length ? useful : free;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  scene.hint(pick.id);
  game.hints++;
  game.penaltyMs += HINT_PENALTY_MS;
  toast('Yanıp sönen ok serbest (+5 sn)', 1600);
});

$('#btn-quit').addEventListener('click', () => {
  if (!game) return show('home');
  if (game.mode === 'vs' && !game.ended) {
    showModal(`<h2>Maçtan çık?</h2><p>Çıkarsan rakibin kazanır.</p>
      <div class="actions"><button class="btn vs" data-action="yes">Çık</button><button class="btn" data-action="no">Devam et</button></div>`,
    { yes: () => { net.send('leaveMatch'); stopGame(); closeModal(); show('friends'); } });
    return;
  }
  stopGame();
  back();
});

// ---- Öğretici el (ilk bölümler) ----------------------------------------------
let tutorial = null;
function showTutorial() {
  const g = game;
  const el = $('#tutorial');
  // Önce ucu ekranda görünen serbest bir ok seç.
  const pickTarget = () => g.puzzle.arrows.find((a) => g.state.isFree(a.id) && (g.puzzle.goal === 'clear' || g.state.required.has(a.id)) && scene.screenPosOf(a.id))
    || g.puzzle.arrows.find((a) => g.state.isFree(a.id) && scene.screenPosOf(a.id));
  let target = pickTarget();
  if (!target) return;
  el.hidden = false;
  tutorial = { el };
  const loop = () => {
    if (!tutorial || game !== g || !g.running) { hideTutorial(); return; }
    if (g.state.removed.has(target.id)) target = pickTarget();
    const p = target && scene.screenPosOf(target.id);
    if (p) {
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      el.style.opacity = '1';
    } else el.style.opacity = '0';
    tutorial.raf = requestAnimationFrame(loop);
  };
  loop();
}
function hideTutorial() {
  if (!tutorial) return;
  cancelAnimationFrame(tutorial.raf);
  tutorial.el.hidden = true;
  tutorial = null;
}

function stopGame() {
  hideTutorial();
  $('#btn-next').hidden = true;
  $('#result-strip').hidden = true;
  if (!game) return;
  game.running = false;
  game.ended = true;
  cancelAnimationFrame(game.timerRaf);
  $('#stun').hidden = true;
  $('#countdown').hidden = true;
}

function finishGame() {
  const g = game;
  const time = elapsed();
  g.running = false;
  g.rescueDone = true;
  hideTutorial();
  cancelAnimationFrame(g.timerRaf);
  $('#stun').hidden = true;
  $('#hud-timer').textContent = fmtTime(time);
  setTimeout(() => sfx.win(), 500);

  if (g.mode === 'vs') {
    g.myTime = time;
    net.send('finish', { matchId: g.match.matchId });
    setTimeout(() => {
      if (game === g && !g.ended) showModal(`<div class="big-emoji">🐥</div><h2>Kurtardın!</h2><p>Sonuç bekleniyor…</p>`);
    }, 600);
    return;
  }

  const { score, stars, par } = scoreFor(g.puzzle, time, g.bumps);
  g.score = score;
  const prev = store.best[g.level];
  const isRecord = !prev || time < prev.timeMs;
  store.best[g.level] = {
    timeMs: Math.min(time, prev?.timeMs ?? Infinity),
    stars: Math.max(stars, prev?.stars ?? 0),
    score: Math.max(score, prev?.score ?? 0),
    clean: prev?.clean || false,
  };
  const unlockedNew = g.level >= store.maxLevel;
  store.maxLevel = Math.max(store.maxLevel, g.level + 1);
  persist();
  net.send('setProgress', { maxLevel: store.maxLevel });

  // Soru sormadan devam: üstte kısa bir sonuç şeridi, köşede "Sonraki bölüm" düğmesi.
  // Oyuncu isterse kalan oklarla oynamayı sürdürür; hepsini bitirirse bonus alır.
  g.cleanup = true;
  g.running = true;
  $('#hud-timer').textContent = fmtTime(time);
  $('#btn-next').hidden = false;
  const strip = $('#result-strip');
  strip.innerHTML = `<span class="rs-title">Kurtarıldı</span>
    <span class="rs-stars">${starsHtml(stars)}</span>
    <span class="rs-meta">${fmtTime(time)} · ${score.toLocaleString('tr-TR')} puan${isRecord && prev ? ' · rekor' : ''}${unlockedNew ? ' · yeni bölüm açıldı' : ''}</span>`;
  strip.hidden = false;
  strip.classList.remove('show');
  void strip.offsetWidth;
  strip.classList.add('show');
  updateHud();
}

// Kurtardıktan sonra bütün oklar da bitti: bonus (soru yok, sadece bildirim)
function finishCleanup() {
  const g = game;
  g.running = false;
  g.ended = true;
  scene.allCleared();
  sfx.win();
  const bonus = cleanBonus(g.puzzle);
  const best = store.best[g.level] || {};
  store.best[g.level] = { ...best, clean: true, score: Math.max(best.score || 0, (g.score || 0) + bonus) };
  persist();
  const strip = $('#result-strip');
  strip.querySelector('.rs-title').textContent = 'Tam temizlik ◆';
  strip.querySelector('.rs-meta').textContent = `+${bonus.toLocaleString('tr-TR')} bonus · toplam ${((g.score || 0) + bonus).toLocaleString('tr-TR')} puan`;
  $('#btn-next').classList.add('pulse');
}

$('#btn-next').addEventListener('click', () => {
  if (game) startSolo(game.level + 1);
});

// ---- Ağ -------------------------------------------------------------------
const net = OFFLINE ? { connected: false, send: () => false, on: () => {} } : new Net();
if (OFFLINE) {
  $('#btn-friends').hidden = true;
  $('#conn-status').hidden = true;
} else {
  net.connect(() => ({ id: store.id, token: store.token, name: store.name, maxLevel: store.maxLevel }));
}

net.on('status', ({ connected }) => {
  const el = $('#conn-status');
  el.className = `conn ${connected ? 'on' : 'off'}`;
  el.querySelector('.txt').textContent = connected ? 'Çevrimiçi – VS hazır' : 'Çevrimdışı – tek oyunculu mod';
  if ($('#screen-friends').classList.contains('active')) renderFriends();
  if (!connected && game?.mode === 'vs' && !game.ended) {
    toast('Bağlantı koptu! Maç sona erdi.');
  }
});

net.on('welcome', (m) => {
  store.id = m.id;
  store.token = m.token;
  if (!store.name && m.name !== 'Oyuncu') store.name = m.name;
  persist();
  me = { id: m.id, name: m.name, wins: m.wins, losses: m.losses };
  friends = m.friends;
  if (m.maxLevel < store.maxLevel) net.send('setProgress', { maxLevel: store.maxLevel });
  if ($('#screen-friends').classList.contains('active')) renderFriends();
});

net.on('friends', (m) => {
  friends = m.friends;
  if ($('#screen-friends').classList.contains('active')) renderFriends();
});

net.on('toast', (m) => toast(m.message));
net.on('error', (m) => {
  toast(m.message);
  if (pendingInvite) { pendingInvite = null; closeModal(); }
});
net.on('kicked', (m) => toast(m.reason, 5000));

net.on('inviteSent', (m) => showWaitingInvite(m));
net.on('inviteDeclined', (m) => {
  if (pendingInvite?.inviteId === m.inviteId) { pendingInvite = null; closeModal(); }
  toast(`${m.by} daveti reddetti.`);
});
net.on('inviteCancelled', (m) => {
  if ($('#modal').dataset.kind === `invite:${m.inviteId}`) closeModal();
  toast('Davet iptal edildi.');
});
net.on('invited', (m) => {
  if (game && game.mode === 'vs' && !game.ended) {
    net.send('respondInvite', { inviteId: m.inviteId, accept: false });
    return;
  }
  showIncomingInvite(m);
});

net.on('matchStart', (m) => {
  pendingInvite = null;
  if (game && !game.ended) stopGame();
  const puzzle = generatePuzzle(levelConfig(m.level), m.seed);
  beginGame({ puzzle, mode: 'vs', level: m.level, match: m, startIn: m.startIn });
});

net.on('opponentProgress', (m) => {
  if (game?.mode !== 'vs' || game.match.matchId !== m.matchId) return;
  const pct = m.total ? (100 * (m.total - m.remaining)) / m.total : 0;
  $('#vs-opp').style.width = `${pct}%`;
});

net.on('matchEnd', (m) => {
  if (!game || game.mode !== 'vs' || game.match.matchId !== m.matchId) return;
  const g = game;
  const won = m.you === 'win';
  const progressMe = g.state.progress;
  stopGame();
  if (!won && m.reason === 'forfeit') { me.losses++; return; } // maçtan kendin çıktın
  if (won) {
    me.wins++;
  } else {
    me.losses++;
    $('#vs-opp').style.width = '100%';
    sfx.lose();
  }
  const opp = esc(g.match.opponent.name);
  let title; let text; let emoji;
  if (won && m.reason === 'finished') {
    emoji = '🏆'; title = 'Kazandın!'; text = `Karakteri ${fmtTime(m.timeMs)} sürede ilk sen kurtardın! ${opp} yetişemedi.`;
  } else if (won) {
    emoji = '🏆'; title = 'Kazandın!'; text = m.reason === 'forfeit' ? `${opp} maçtan çekildi.` : `${opp} bağlantısı koptu.`;
  } else if (m.reason === 'finished') {
    emoji = '😿'; title = 'Kaybettin'; text = `${opp} karakteri ${fmtTime(m.timeMs)} sürede kurtardı. Kilide giden yolun %${Math.round(progressMe * 100)}'ini açmıştın.`;
  } else {
    emoji = '🏳️'; title = 'Maç bitti'; text = 'Maçtan ayrıldın.';
  }
  setTimeout(() => {
    if (game !== g) return;
    showModal(`<div class="big-emoji">${emoji}</div><h2>${title}</h2><p>${text}</p>
      <p>Toplam: ${me.wins} galibiyet · ${me.losses} mağlubiyet</p>
      <div class="actions">
        <button class="btn vs" data-action="rematch">Rövanş ⚔️</button>
        <button class="btn" data-action="menu">Arkadaşlar</button>
      </div>`, {
      rematch: () => net.send('invite', { to: g.match.opponent.id, level: g.level }),
      menu: () => { closeModal(); show('friends', { push: false }); },
    });
  }, won && m.reason === 'finished' ? 900 : 200);
});

// ---- Başlangıç -----------------------------------------------------------
renderHome();
setTimeout(renderHomePreview, 60);
if (!store.name && !localStorage.getItem('okkup:howto')) {
  try { localStorage.setItem('okkup:howto', '1'); } catch { /* yok say */ }
  showHowTo();
}

// Otomatik testler ve hata ayıklama için küçük bir kanca.
window.__okkup = { get game() { return game; }, get scene() { return scene; }, tap: (id) => onTap(id) };
