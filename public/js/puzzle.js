// Bulmaca üretici ve kurallar. Hem tarayıcıda hem sunucuda/testlerde çalışır (bağımlılık yok).
//
// Kurallar:
// - Bir kutunun (küp, dikdörtgen prizma...) yüzeyi kareli bir ızgaradır.
// - Oklar bu yüzeyde kıvrılan çizgilerdir (köşelerden komşu yüzlere geçebilirler).
// - Bir oka dokununca ok, UCUNUN gösterdiği yöne doğru kayar; gövdesi kendi yolunu izler.
//   Ucun önündeki yol (yüzün kenarına kadar) boşsa ok kenardan uçup gider.
// - Yolda başka bir ok varsa çarpar ve geri döner: oklar birbirinin içinden geçemez.
// - 'rescue' bölümlerinde tatlı karakter yüzeyin EN ZOR noktasında, okların arasında kafestedir.
//   Etrafındaki 8 hücreyi kaplayan oklar temizlenince kurtulur.
//   'clear' bölümlerinde tüm oklar temizlenince kafes açılır.
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
  { name: 'İlk Adım', dims: [2, 2, 2], goal: 'clear', difficulty: 0.0, maxLen: 3 },
  { name: 'Minik Dost', dims: [3, 3, 3], goal: 'rescue', difficulty: 0.2, maxLen: 4 },
  { name: 'Küçük Küp', dims: [4, 4, 4], goal: 'clear', difficulty: 0.2, maxLen: 4 },
  { name: 'Kilitli Kafes', dims: [4, 4, 4], goal: 'rescue', difficulty: 0.35, maxLen: 5 },
  { name: 'Uzun Kutu', dims: [3, 5, 3], goal: 'rescue', difficulty: 0.4, maxLen: 5 },
  { name: 'Orta Küp', dims: [5, 5, 5], goal: 'clear', difficulty: 0.4, maxLen: 6 },
  { name: 'Düğüm', dims: [5, 5, 5], goal: 'rescue', difficulty: 0.5, maxLen: 6 },
  { name: 'Dikdörtgen Prizma', dims: [4, 6, 4], goal: 'rescue', difficulty: 0.5, maxLen: 6 },
  { name: 'Yassı Prizma', dims: [6, 3, 6], goal: 'rescue', difficulty: 0.55, maxLen: 7 },
  { name: 'Büyük Temizlik', dims: [6, 6, 6], goal: 'clear', difficulty: 0.55, maxLen: 7 },
  { name: 'Labirent', dims: [6, 6, 6], goal: 'rescue', difficulty: 0.6, maxLen: 8 },
  { name: 'Kule', dims: [4, 8, 4], goal: 'rescue', difficulty: 0.6, maxLen: 8 },
  { name: 'Büyük Küp', dims: [7, 7, 7], goal: 'rescue', difficulty: 0.65, maxLen: 9 },
  { name: 'Tuğla', dims: [8, 4, 6], goal: 'rescue', difficulty: 0.7, maxLen: 9 },
  { name: 'Dev Temizlik', dims: [7, 7, 7], goal: 'clear', difficulty: 0.7, maxLen: 9 },
  { name: 'Dev Küp', dims: [8, 8, 8], goal: 'rescue', difficulty: 0.75, maxLen: 10 },
  { name: 'Gökdelen', dims: [5, 10, 5], goal: 'rescue', difficulty: 0.8, maxLen: 10 },
  { name: 'Usta Küp', dims: [9, 9, 9], goal: 'rescue', difficulty: 0.85, maxLen: 11 },
  { name: 'Dev Prizma', dims: [10, 6, 8], goal: 'rescue', difficulty: 0.9, maxLen: 12 },
  { name: 'Efsane Küp', dims: [10, 10, 10], goal: 'rescue', difficulty: 0.9, maxLen: 12 },
];
export const HAND_LEVEL_COUNT = HAND_LEVELS.length;

export function levelConfig(level) {
  const n = Math.max(1, Math.floor(level));
  if (n <= HAND_LEVELS.length) return { level: n, ...HAND_LEVELS[n - 1] };
  // Sonsuz bölümler
  const k = n - HAND_LEVELS.length;
  const rnd = mulberry32(n * 7919);
  const goal = k % 4 === 0 ? 'clear' : 'rescue';
  const base = Math.min(10, 6 + Math.floor(k / 5));
  const dims = [0, 1, 2].map(() => base - 1 + Math.floor(rnd() * 4));
  if (goal === 'clear') for (let i = 0; i < 3; i++) dims[i] = Math.min(dims[i], 8);
  const isCube = dims[0] === dims[1] && dims[1] === dims[2];
  return {
    level: n,
    name: `${isCube ? 'Küp' : 'Prizma'} ${n}`,
    dims,
    goal,
    difficulty: Math.min(0.95, 0.9 + k * 0.003),
    maxLen: 12,
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
  for (let attempt = 0; attempt < 6; attempt++) {
    const p = tryGenerate(cfg, (useSeed + attempt * 101) >>> 0);
    if (!p) continue;
    if (!best || p.quality > best.quality) best = p;
    const enoughDepth = cfg.goal === 'clear' || p.required.length >= Math.min(p.arrows.length, 3 + p.arrows.length * 0.2);
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
  let trap = [];
  let character = null;
  let list = arrows;
  let required;

  if (cfg.goal === 'rescue') {
    // Karakteri EN ZOR noktaya koy: etrafını saran okları çıkarmak için önce en çok okun
    // temizlenmesi gereken hücre. O hücredeki ok kaldırılır, karakter onun yerine oturur.
    let best = null;
    for (const X of arrows) {
      for (const c of X.cells) {
        const ringArrows = new Set();
        for (const n of neighbors8(dims, c)) {
          const o = occupied.get(cellKey(n));
          if (o !== undefined && o !== X.id) ringArrows.add(o);
        }
        if (ringArrows.size < 3) continue;
        const need = new Set();
        for (const r of ringArrows) { need.add(r); for (const x of base[r]) need.add(x); }
        need.delete(X.id);
        const score = need.size + ringArrows.size * 0.3 - X.cells.length * 0.2 + rnd() * 0.1;
        if (!best || score > best.score) best = { score, X, c };
      }
    }
    if (!best) return null;
    // X'i çıkar ve okları yeniden numarala (ekleme sırası korunur → çözülebilirlik bozulmaz).
    list = arrows.filter((a) => a !== best.X).map((a, i) => ({ ...a, id: i }));
    const occ = new Map();
    for (const a of list) for (const c of a.cells) occ.set(cellKey(c), a.id);
    const cl = closures(dims, list, occ);
    const ring = neighbors8(dims, best.c);
    const t = new Set();
    for (const n of ring) { const o = occ.get(cellKey(n)); if (o !== undefined) t.add(o); }
    trap = [...t].sort((a, b) => a - b);
    const req = new Set();
    for (const r of trap) { req.add(r); for (const x of cl[r]) req.add(x); }
    required = [...req];
    character = { cell: best.c, ring };
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
    trap,
    required: required.sort((a, b) => a - b),
    solution,
    fill,
    quality: fill + (cfg.goal === 'rescue' ? required.length / list.length : 0),
  };
}

// Her ok için: onu serbest bırakmak için önce çıkması gereken tüm oklar (geçişli).
// Engeller hep daha sonra eklenmiş oklardır, bu yüzden sondan başa tek geçiş yeter.
function closures(dims, list, occupied) {
  const out = new Array(list.length);
  for (let i = list.length - 1; i >= 0; i--) {
    const s = new Set();
    for (const c of rayCells(dims, headOf(list[i]), list[i].dir)) {
      const o = occupied.get(cellKey(c));
      if (o === undefined) continue;
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
    this.trap = new Set(puzzle.trap || []);
  }

  get total() { return this.puzzle.arrows.length; }
  get remaining() { return this.total - this.removed.size; }
  get solved() {
    return this.puzzle.goal === 'rescue' ? this.trapLeft === 0 : this.removed.size === this.total;
  }

  // Karakterin etrafında kalan (onu hapseden) ok sayısı
  get trapLeft() {
    let n = 0;
    for (const id of this.trap) if (!this.removed.has(id)) n++;
    return n;
  }

  // 0..1 ilerleme (VS çubuğu için): gerekli oklardan kaçı çıktı
  get progress() {
    let n = 0;
    for (const id of this.required) if (this.removed.has(id)) n++;
    return n / this.required.size;
  }

  // Oku ucunun yönünde göndermeyi dener. { ok:true, exit } ya da { ok:false, hit, steps }
  tryMove(id) {
    if (this.removed.has(id)) return { ok: false, gone: true };
    const a = this.puzzle.arrows[id];
    const ray = rayCells(this.puzzle.dims, headOf(a), a.dir);
    for (let i = 0; i < ray.length; i++) {
      const o = this.occupied.get(cellKey(ray[i]));
      if (o !== undefined) return { ok: false, hit: o, steps: i };
    }
    for (const c of a.cells) this.occupied.delete(cellKey(c));
    this.removed.add(id);
    return { ok: true, exit: ray.length };
  }

  isFree(id) {
    const a = this.puzzle.arrows[id];
    return !this.removed.has(id) && rayCells(this.puzzle.dims, headOf(a), a.dir).every((c) => !this.occupied.has(cellKey(c)));
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
