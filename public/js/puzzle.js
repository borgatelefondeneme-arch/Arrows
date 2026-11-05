// Bulmaca üretici ve kurallar. Hem tarayıcıda hem sunucuda/testlerde çalışır (bağımlılık yok).
//
// Kurallar:
// - Bir kutunun (küp, dikdörtgen prizma...) yüzeyi kareli bir ızgaradır.
// - Oklar bu yüzeyde kıvrılan çizgilerdir (köşelerden komşu yüzlere geçebilirler).
// - Bir oka dokununca ok, UCUNUN gösterdiği yöne doğru kayar; gövdesi kendi yolunu izler.
//   Ucun önündeki yol (yüzün kenarına kadar) boşsa ok kenardan uçup gider.
// - Yolda başka bir ok varsa çarpar ve geri döner: oklar birbirinin içinden geçemez.
// - Tatlı karakter yüzeyin EN ZOR noktasında okların arasına sıkışmıştır. Dört yönünden birinde
//   yüzün kenarına kadar düz yol açılınca o yönden koşarak kaçar → bölüm geçilir.
//   Karakter de engeldir: oklar onun içinden geçemez. Kurtardıktan sonra istersen kalan okları
//   da bitirip "tam temizlik" bonusu alırsın.
//
// Üretim: oklar sırayla eklenir; her yeni okun önü (eklendiği anda) boştur. Böylece ekleme
// sırasının TERSİ her zaman geçerli bir çözümdür. Bir oku çıkarmak hiçbir yolu kapatmadığı için
// bulmaca asla kilitlenmez.

export const DIRS = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];
export const axisOf = (d) => d >> 1;
export const signOf = (d) => (d % 2 === 0 ? 1 : -1);
export const opposite = (d) => d ^ 1;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Yüzey ızgarası ---------------------------------------------------------
// Kutu [0,W]x[0,H]x[0,D] aralığındadır. Hücre = { f: yüz (DIRS indeksi), c: [x,y,z] merkez }.
export const cellKey = (cell) => `${cell.f}|${cell.c[0] * 2}|${cell.c[1] * 2}|${cell.c[2] * 2}`;

export function tangentDirs(f) {
  const a = axisOf(f);
  return [0, 1, 2, 3, 4, 5].filter((d) => axisOf(d) !== a);
}

export function allCells(dims) {
  const out = [];
  for (let f = 0; f < 6; f++) {
    const a = axisOf(f);
    const [b, c] = [0, 1, 2].filter((x) => x !== a);
    for (let i = 0; i < dims[b]; i++) {
      for (let j = 0; j < dims[c]; j++) {
        const p = [0, 0, 0];
        p[a] = signOf(f) > 0 ? dims[a] : 0;
        p[b] = i + 0.5;
        p[c] = j + 0.5;
        out.push({ f, c: p });
      }
    }
  }
  return out;
}

// Yüzeyde t yönünde bir hücre ilerle. Kenardan taşarsa komşu yüze geçer.
// Döner: { cell, t (yeni hareket yönü), edge (geçilen kenar noktası ya da null) }
export function step(dims, cell, t) {
  const k = axisOf(t);
  const s = signOf(t);
  const c = cell.c.slice();
  c[k] += s;
  if (c[k] > 0 && c[k] < dims[k]) return { cell: { f: cell.f, c }, t, edge: null };
  const e = cell.c.slice();
  e[k] += s * 0.5;
  const c2 = e.slice();
  const a = axisOf(cell.f);
  c2[a] -= signOf(cell.f) * 0.5;
  return { cell: { f: t, c: c2 }, t: opposite(cell.f), edge: e };
}

// Hücrenin önünde, aynı yüzde, kenara kadar olan hücreler.
export function rayCells(dims, cell, t) {
  const out = [];
  const k = axisOf(t);
  const s = signOf(t);
  const c = cell.c.slice();
  for (;;) {
    c[k] += s;
    if (!(c[k] > 0 && c[k] < dims[k])) return out;
    out.push({ f: cell.f, c: c.slice() });
  }
}

export const headOf = (arrow) => arrow.cells[arrow.cells.length - 1];

// ---- Bölümler ---------------------------------------------------------------
// goal: 'rescue' (kilit okunu çıkar, karakteri kurtar) | 'clear' (tüm okları temizle)
const HAND_LEVELS = [
  { name: 'İlk Adım', dims: [8, 8, 8], difficulty: 0.45, maxLen: 10 },
  { name: 'Isınma', dims: [9, 9, 9], difficulty: 0.5, maxLen: 12 },
  { name: 'Uzun Kutu', dims: [8, 11, 8], difficulty: 0.55, maxLen: 12 },
  { name: 'Düğüm', dims: [10, 10, 10], difficulty: 0.6, maxLen: 14 },
  { name: 'Tuğla', dims: [12, 8, 10], difficulty: 0.62, maxLen: 14 },
  { name: 'Sarmal', dims: [11, 11, 11], difficulty: 0.66, maxLen: 16 },
  { name: 'Labirent', dims: [12, 12, 12], difficulty: 0.7, maxLen: 16 },
  { name: 'Kule', dims: [10, 15, 10], difficulty: 0.72, maxLen: 18 },
  { name: 'Yassı Prizma', dims: [15, 8, 14], difficulty: 0.75, maxLen: 18 },
  { name: 'Ağ', dims: [13, 13, 13], difficulty: 0.78, maxLen: 18 },
  { name: 'Dolambaç', dims: [14, 14, 14], difficulty: 0.8, maxLen: 20 },
  { name: 'Gökdelen', dims: [10, 18, 10], difficulty: 0.82, maxLen: 20 },
  { name: 'Büyük Küp', dims: [15, 15, 15], difficulty: 0.84, maxLen: 20 },
  { name: 'Dev Tuğla', dims: [17, 11, 15], difficulty: 0.86, maxLen: 22 },
  { name: 'Dev Küp', dims: [16, 16, 16], difficulty: 0.88, maxLen: 22 },
  { name: 'Kalın Duvar', dims: [18, 12, 16], difficulty: 0.9, maxLen: 24 },
  { name: 'Uzun Gökdelen', dims: [12, 20, 12], difficulty: 0.9, maxLen: 24 },
  { name: 'Usta Küp', dims: [17, 17, 17], difficulty: 0.92, maxLen: 24 },
  { name: 'Dev Prizma', dims: [20, 14, 16], difficulty: 0.94, maxLen: 26 },
  { name: 'Efsane Küp', dims: [18, 18, 18], difficulty: 0.95, maxLen: 26 },
].map((l) => ({ goal: 'rescue', ...l }));
export const HAND_LEVEL_COUNT = HAND_LEVELS.length;

export function levelConfig(level) {
  const n = Math.max(1, Math.floor(level));
  if (n <= HAND_LEVELS.length) return { level: n, ...HAND_LEVELS[n - 1] };
  // Sonsuz bölümler: 15-20 birimlik kutular, en zor ayarlar
  const k = n - HAND_LEVELS.length;
  const rnd = mulberry32(n * 7919);
  const dims = [0, 1, 2].map(() => 15 + Math.floor(rnd() * 6));
  const isCube = dims[0] === dims[1] && dims[1] === dims[2];
  return {
    level: n,
    name: `${isCube ? 'Küp' : 'Prizma'} ${n}`,
    dims,
    goal: 'rescue',
    difficulty: 0.95,
    maxLen: 26 + Math.min(6, Math.floor(k / 5)),
  };
}

export function levelSeed(level) {
  return (level * 2654435761) >>> 0;
}

// ---- Üretici ----------------------------------------------------------------
export function generatePuzzle(levelOrConfig, seed) {
  const cfg = typeof levelOrConfig === 'number' ? levelConfig(levelOrConfig) : levelOrConfig;
  const useSeed = seed ?? levelSeed(cfg.level ?? 1);
  let best = null;
  // Büyük kutularda üretim pahalı: deneme sayısı boyuta göre (her cihazda aynı sonuç için sabit).
  const cellCount = 2 * (cfg.dims[0] * cfg.dims[1] + cfg.dims[1] * cfg.dims[2] + cfg.dims[0] * cfg.dims[2]);
  const maxAttempts = cellCount > 1200 ? 6 : cellCount > 600 ? 8 : 12;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const p = tryGenerate(cfg, (useSeed + attempt * 101) >>> 0);
    if (!p) continue;
    if (!best || p.quality > best.quality) best = p;
    // Zorluğa göre kaçış yolunun en az kaç ok gerektirmesi gerektiği
    const target = Math.min(30, 1 + p.arrows.length * (0.05 + (cfg.difficulty ?? 0.4) * 0.12));
    const enoughDepth = cfg.goal === 'clear' || p.required.length >= target;
    if (p.fill > 0.85 && enoughDepth) break;
  }
  if (!best) throw new Error('Bulmaca üretilemedi');
  delete best.quality;
  delete best.fill;
  return best;
}

function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function tryGenerate(cfg, seed) {
  const rnd = mulberry32(seed);
  const dims = cfg.dims;
  const difficulty = cfg.difficulty ?? 0.4;
  const maxLen = cfg.maxLen ?? 6;
  const cells = allCells(dims);
  const occupied = new Map(); // key -> ok indeksi
  const arrows = [];

  const tryArrow = (head, minLen) => {
    const tdirs = shuffle(tangentDirs(head.f), rnd);
    const rayLen = (d) => rayCells(dims, head, d).length;
    if (rnd() < difficulty) tdirs.sort((a, b) => rayLen(b) - rayLen(a)); // zor: önü uzun yön
    else if (rnd() < 0.6) tdirs.sort((a, b) => rayLen(a) - rayLen(b)); // kolay: kenara yakın yön
    for (const t of tdirs) {
      const ray = rayCells(dims, head, t);
      if (ray.some((c) => occupied.has(cellKey(c)))) continue;
      // Ucun hemen arkasındaki hücre aynı yüzde olmalı (ok düz bir çizgiyle ucuna gelir).
      const first = step(dims, head, opposite(t));
      if (first.edge) continue;
      const rayKeys = new Set(ray.map(cellKey));
      const used = new Set([cellKey(head)]);
      const free = (c) => { const k = cellKey(c); return !occupied.has(k) && !rayKeys.has(k) && !used.has(k); };
      if (!free(first.cell)) continue;
      const path = [head, first.cell];
      used.add(cellKey(first.cell));
      let cur = first.cell;
      let m = first.t; // kuyruğa doğru yürüme yönü
      const target = 2 + Math.floor(rnd() * (maxLen - 1));
      while (path.length < target) {
        const turns = shuffle(tangentDirs(cur.f).filter((d) => axisOf(d) !== axisOf(m)), rnd);
        const order = rnd() < 0.55 ? [m, ...turns] : [...turns, m];
        let moved = false;
        for (const d of order) {
          const nx = step(dims, cur, d);
          if (!free(nx.cell)) continue;
          path.push(nx.cell);
          used.add(cellKey(nx.cell));
          cur = nx.cell;
          m = nx.t;
          moved = true;
          break;
        }
        if (!moved) break;
      }
      if (path.length < minLen) continue;
      const id = arrows.length;
      arrows.push({ id, cells: path.reverse(), dir: t });
      for (const c of path) occupied.set(cellKey(c), id);
      return true;
    }
    return false;
  };

  for (const minLen of [3, 2]) {
    for (let pass = 0; pass < 3; pass++) {
      let progress = false;
      for (const cell of shuffle(cells.slice(), rnd)) {
        if (occupied.has(cellKey(cell))) continue;
        if (tryArrow(cell, minLen)) progress = true;
      }
      if (!progress) break;
    }
  }
  if (arrows.length < 2) return null;

  const fill = occupied.size / cells.length;
  const base = closures(dims, arrows, occupied);
  let character = null;
  let list = arrows;
  let required;

  if (cfg.goal === 'rescue') {
    // Karakter okların arasına sıkışmıştır. Herhangi bir yöne (yüzün kenarına kadar) düz yolu
    // açılınca koşarak kaçar. Onu EN ZOR noktaya koyarız: en kolay kaçış yolunu açmak için bile
    // en çok okun çıkması gereken hücre. O hücredeki ok kaldırılır, karakter onun yerine oturur.
    // Karakter de bir engeldir: önünden geçmek isteyen oklar ona çarpar.
    const crossing = new Map(); // hücre -> o hücreden geçen ışınlara sahip oklar
    for (const a of arrows) {
      for (const c of rayCells(dims, headOf(a), a.dir)) {
        const k = cellKey(c);
        if (!crossing.has(k)) crossing.set(k, []);
        crossing.get(k).push(a.id);
      }
    }
    const candidates = [];
    for (const X of arrows) {
      for (const c of X.cells) {
        const ck = cellKey(c);
        const blockedByChar = new Set(crossing.get(ck) || []);
        let cost = Infinity;
        for (const d of tangentDirs(c.f)) {
          const need = new Set();
          for (const rc of rayCells(dims, c, d)) {
            const o = occupied.get(cellKey(rc));
            if (o === undefined || o === X.id) continue;
            need.add(o);
            for (const x of base[o]) need.add(x);
          }
          need.delete(X.id);
          if ([...need].some((id) => blockedByChar.has(id))) continue; // bu yol karakter yüzünden açılamaz
          cost = Math.min(cost, need.size);
        }
        if (cost === Infinity || cost === 0) continue;
        candidates.push({ X, c, score: cost - X.cells.length * 0.1 + rnd() * 0.2 });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    for (const cand of candidates.slice(0, 25)) {
      const r = finalizeRescue(dims, arrows, cand.X, cand.c);
      if (r) { ({ list, character, required } = r); break; }
    }
    if (!character) return null;
  } else {
    required = arrows.map((a) => a.id);
  }

  // Çözüm: ekleme sırasının tersi (sadece gerekli oklar).
  const req = new Set(required);
  const solution = list.map((a) => a.id).reverse().filter((id) => req.has(id));

  return {
    level: cfg.level ?? 0,
    name: cfg.name ?? '',
    goal: cfg.goal ?? 'rescue',
    dims: dims.slice(),
    seed,
    arrows: list,
    character,
    required: required.sort((a, b) => a - b),
    solution,
    fill,
    quality: fill + (cfg.goal === 'rescue' ? required.length : 0),
  };
}

// Seçilen hücre için kesin hesap: X'i kaldır, okları yeniden numarala, kaçış yollarını bul.
function finalizeRescue(dims, arrows, X, cell) {
  const list = arrows.filter((a) => a !== X).map((a, i) => ({ ...a, id: i }));
  const occ = new Map();
  for (const a of list) for (const c of a.cells) occ.set(cellKey(c), a.id);
  const cl = closures(dims, list, occ, cellKey(cell));
  const escapes = [];
  for (const d of tangentDirs(cell.f)) {
    const need = new Set();
    let ok = true;
    for (const rc of rayCells(dims, cell, d)) {
      const o = occ.get(cellKey(rc));
      if (o === undefined) continue;
      if (cl[o] === null) { ok = false; break; }
      need.add(o);
      for (const x of cl[o]) need.add(x);
    }
    if (ok) escapes.push({ dir: d, required: [...need].sort((a, b) => a - b) });
  }
  if (!escapes.length || escapes.some((e) => e.required.length === 0)) return null;
  escapes.sort((a, b) => a.required.length - b.required.length);
  return { list, character: { cell, escapes, cost: escapes[0].required.length }, required: escapes[0].required.slice() };
}

// Her ok için: onu serbest bırakmak için önce çıkması gereken tüm oklar (geçişli).
// Engeller hep daha sonra eklenmiş oklardır, bu yüzden sondan başa tek geçiş yeter.
// blockKey verilirse o hücre kalıcı engeldir (karakter): yolu oradan geçen ya da böyle bir oka
// bağlı olan oklar için sonuç null olur (karakter kaçmadan çıkamazlar).
function closures(dims, list, occupied, blockKey = null) {
  const out = new Array(list.length);
  for (let i = list.length - 1; i >= 0; i--) {
    let s = new Set();
    for (const c of rayCells(dims, headOf(list[i]), list[i].dir)) {
      const k = cellKey(c);
      if (k === blockKey) { s = null; break; }
      const o = occupied.get(k);
      if (o === undefined) continue;
      if (out[o] === null) { s = null; break; }
      s.add(o);
      for (const x of out[o]) s.add(x);
    }
    out[i] = s;
  }
  return out;
}

// Bir hücrenin yüzey üzerindeki 8 komşusu (kenar/köşelerden komşu yüzlere taşabilir).
export function neighbors8(dims, cell) {
  const out = new Map();
  for (const d of tangentDirs(cell.f)) {
    const s1 = step(dims, cell, d);
    out.set(cellKey(s1.cell), s1.cell);
    for (const e of tangentDirs(cell.f)) {
      if (axisOf(e) === axisOf(d) || axisOf(e) === axisOf(s1.cell.f)) continue;
      const s2 = step(dims, s1.cell, e);
      out.set(cellKey(s2.cell), s2.cell);
    }
  }
  out.delete(cellKey(cell));
  return [...out.values()];
}

// ---- Oyun durumu --------------------------------------------------------------
export class PuzzleState {
  constructor(puzzle) {
    this.puzzle = puzzle;
    this.occupied = new Map();
    for (const a of puzzle.arrows) for (const c of a.cells) this.occupied.set(cellKey(c), a.id);
    this.removed = new Set();
    this.required = new Set(puzzle.required);
    this.charKey = puzzle.character ? cellKey(puzzle.character.cell) : null;
    this.rescued = !puzzle.character;
    this.escapeDir = null;
  }

  get total() { return this.puzzle.arrows.length; }
  get remaining() { return this.total - this.removed.size; }
  get allCleared() { return this.removed.size === this.total; }
  // Bölüm geçildi mi? (karakter kaçtı)
  get solved() { return this.rescued; }

  // Kaçış için en kısa yolda hâlâ çıkması gereken ok sayısı
  get escapeCost() {
    if (this.rescued) return 0;
    let best = Infinity;
    for (const e of this.puzzle.character.escapes) {
      let n = 0;
      for (const id of e.required) if (!this.removed.has(id)) n++;
      best = Math.min(best, n);
    }
    return best === Infinity ? 0 : best;
  }

  // 0..1 ilerleme (VS çubuğu için)
  get progress() {
    if (this.rescued) return 1;
    const c0 = this.puzzle.character.cost || 1;
    return Math.max(0, Math.min(0.99, 1 - this.escapeCost / c0));
  }

  // Oku ucunun yönünde göndermeyi dener.
  // { ok:true, rescued?: yön } ya da { ok:false, hit: okId | 'character', steps }
  tryMove(id) {
    if (this.removed.has(id)) return { ok: false, gone: true };
    const a = this.puzzle.arrows[id];
    const ray = rayCells(this.puzzle.dims, headOf(a), a.dir);
    for (let i = 0; i < ray.length; i++) {
      const k = cellKey(ray[i]);
      if (!this.rescued && k === this.charKey) return { ok: false, hit: 'character', steps: i };
      const o = this.occupied.get(k);
      if (o !== undefined) return { ok: false, hit: o, steps: i };
    }
    for (const c of a.cells) this.occupied.delete(cellKey(c));
    this.removed.add(id);
    const res = { ok: true };
    if (!this.rescued) {
      const d = this.openEscape();
      if (d !== null) {
        this.rescued = true;
        this.escapeDir = d;
        res.rescued = d;
      }
    }
    return res;
  }

  // Karakterin önünde kenara kadar açık bir yön var mı?
  openEscape() {
    const cell = this.puzzle.character.cell;
    for (const d of tangentDirs(cell.f)) {
      if (rayCells(this.puzzle.dims, cell, d).every((c) => !this.occupied.has(cellKey(c)))) return d;
    }
    return null;
  }

  isFree(id) {
    const a = this.puzzle.arrows[id];
    if (this.removed.has(id)) return false;
    return rayCells(this.puzzle.dims, headOf(a), a.dir).every((c) => {
      const k = cellKey(c);
      return !this.occupied.has(k) && (this.rescued || k !== this.charKey);
    });
  }

  arrowAt(cell) {
    const o = this.occupied.get(cellKey(cell));
    return o === undefined ? null : o;
  }
}

// ---- Puanlama -----------------------------------------------------------------
export function parTimeMs(puzzle) {
  return Math.round((4 + puzzle.required.length * 1.6) * 1000);
}

// Kurtardıktan sonra kalan tüm okları da bitirene bonus
export function cleanBonus(puzzle) {
  return puzzle.arrows.length * 15;
}

export function scoreFor(puzzle, timeMs, bumps) {
  const par = parTimeMs(puzzle);
  const stars = timeMs <= par ? 3 : timeMs <= par * 1.75 ? 2 : 1;
  const base = puzzle.required.length * 60;
  const speedBonus = Math.max(0, Math.round(((par * 2 - timeMs) / 1000) * 25));
  const score = Math.max(50, base + speedBonus - bumps * 20);
  return { score, stars, par };
}

// Çarpınca oyuncu kısa süre sersemler (VS'de de herkes için aynı kural).
export const BUMP_STUN_MS = 1000;
