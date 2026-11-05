// Bulmaca üretici ve kurallar. Hem tarayıcıda hem sunucuda/testlerde çalışır (bağımlılık yok).
//
// Kurallar:
// - Şekil (küp, dikdörtgen prizma, piramit...) birim bloklardan oluşur.
// - Her blokta bir ok vardır; ok 6 eksen yönünden birini gösterir.
// - Bir bloğa dokununca sadece okun ucunun gösterdiği yöne gidebilir.
// - Yolunda başka bir blok (ya da kafes) varsa çarpar ve geri döner: oklar birbirinin içinden geçemez.
// - Ortadaki kafeste tatlı karakter kilitlidir. Tüm oklar temizlenince kafes açılır.
//
// Üretim tersten yapılır: kafesten başlayıp blokları tek tek "geri ekleriz"; her blok
// eklendiği anda yönü dışarıya açık olacak şekilde seçilir. Böylece ters sıra her zaman
// geçerli bir çözümdür ve blok çıkarmak hiçbir yolu kapatmadığı için bulmaca asla kilitlenmez.

export const DIRS = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

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

export const key = (x, y, z) => `${x},${y},${z}`;

// ---- Şekiller -------------------------------------------------------------
// Her şekil (x,y,z, boyutlar, merkez) -> bool döndürür.
const SHAPES = {
  prism: () => true,
  cross: (x, y, z, d, c) => {
    const onX = Math.abs(y - c[1]) < 1 && Math.abs(z - c[2]) < 1;
    const onY = Math.abs(x - c[0]) < 1 && Math.abs(z - c[2]) < 1;
    const onZ = Math.abs(x - c[0]) < 1 && Math.abs(y - c[1]) < 1;
    return onX || onY || onZ;
  },
  diamond: (x, y, z, d, c) => {
    const r = Math.min(d[0], d[1], d[2]) / 2;
    return Math.abs(x - c[0]) + Math.abs(y - c[1]) + Math.abs(z - c[2]) <= r;
  },
  pyramid: (x, y, z, d, c) => {
    // y=0 tabanı tam, yukarı çıktıkça her katta kenarlardan birer sıra eksilir.
    const shrink = y;
    return x >= shrink && x < d[0] - shrink && z >= shrink && z < d[2] - shrink;
  },
  hollow: (x, y, z, d, c) => {
    // Kalın duvarlı kutu: içi boş, ortada kafes var.
    const edge = (v, n) => v === 0 || v === n - 1;
    const isCenter = x === c[0] && y === c[1] && z === c[2];
    return isCenter || edge(x, d[0]) || edge(y, d[1]) || edge(z, d[2]);
  },
  stairs: (x, y, z, d) => {
    // Basamaklı prizma: arkaya doğru yükselen merdiven.
    const h = Math.ceil(((z + 1) / d[2]) * d[1]);
    return y < h;
  },
  ring: (x, y, z, d, c) => {
    // Ortası delik çerçeve (simit). Kafes çerçevenin içinde, bir kenarda.
    const inHole = x > 0 && x < d[0] - 1 && z > 0 && z < d[2] - 1;
    return !inHole;
  },
};

export const SHAPE_NAMES = {
  prism: 'Prizma',
  cross: 'Artı',
  diamond: 'Elmas',
  pyramid: 'Piramit',
  hollow: 'Boş Kutu',
  stairs: 'Merdiven',
  ring: 'Çerçeve',
};

// ---- Bölümler -------------------------------------------------------------
// Kolaydan zora. 'difficulty' 0..1: yönlerin ne kadar "içeri" (başka blokların arkasına) bakacağı.
const HAND_LEVELS = [
  { name: 'İlk Adım', shape: 'cross', dims: [3, 3, 3], difficulty: 0.0 },
  { name: 'Mini Prizma', shape: 'prism', dims: [3, 2, 2], difficulty: 0.1 },
  { name: 'Küçük Küp', shape: 'prism', dims: [3, 3, 3], difficulty: 0.15 },
  { name: 'Elmas', shape: 'diamond', dims: [5, 5, 5], difficulty: 0.2 },
  { name: 'Uzun Kutu', shape: 'prism', dims: [3, 3, 4], difficulty: 0.25 },
  { name: 'Piramit', shape: 'pyramid', dims: [5, 3, 5], difficulty: 0.3 },
  { name: 'Orta Küp', shape: 'prism', dims: [4, 4, 4], difficulty: 0.3 },
  { name: 'İnce Duvar', shape: 'prism', dims: [5, 4, 2], difficulty: 0.35 },
  { name: 'Merdiven', shape: 'stairs', dims: [4, 4, 4], difficulty: 0.4 },
  { name: 'Dikdörtgen Prizma', shape: 'prism', dims: [3, 4, 5], difficulty: 0.45 },
  { name: 'Kule', shape: 'prism', dims: [3, 7, 3], difficulty: 0.5 },
  { name: 'Çerçeve', shape: 'ring', dims: [5, 3, 5], difficulty: 0.5 },
  { name: 'Boş Kutu', shape: 'hollow', dims: [5, 5, 5], difficulty: 0.55 },
  { name: 'Büyük Elmas', shape: 'diamond', dims: [7, 7, 7], difficulty: 0.6 },
  { name: 'Büyük Küp', shape: 'prism', dims: [5, 5, 5], difficulty: 0.6 },
  { name: 'Yüksek Piramit', shape: 'pyramid', dims: [7, 4, 7], difficulty: 0.65 },
  { name: 'Yassı Prizma', shape: 'prism', dims: [6, 3, 5], difficulty: 0.7 },
  { name: 'Dev Merdiven', shape: 'stairs', dims: [5, 5, 6], difficulty: 0.75 },
  { name: 'Uzun Kule', shape: 'prism', dims: [4, 8, 4], difficulty: 0.8 },
  { name: 'Usta Küp', shape: 'prism', dims: [6, 6, 6], difficulty: 0.85 },
];

const ENDLESS_SHAPES = ['prism', 'pyramid', 'stairs', 'diamond', 'prism', 'hollow', 'ring'];

export const HAND_LEVEL_COUNT = HAND_LEVELS.length;

export function levelConfig(level) {
  const n = Math.max(1, Math.floor(level));
  if (n <= HAND_LEVELS.length) return { level: n, ...HAND_LEVELS[n - 1] };
  // Sonsuz bölümler: boyutlar ve zorluk yavaşça artar (en fazla 7 birim, ~300 blok).
  const k = n - HAND_LEVELS.length; // 1, 2, 3...
  const rnd = mulberry32(n * 7919);
  const shape = ENDLESS_SHAPES[(k - 1) % ENDLESS_SHAPES.length];
  const base = Math.min(6, 4 + Math.floor(k / 8));
  let dims = [0, 1, 2].map(() => Math.min(7, base + Math.floor(rnd() * 2)));
  if (shape === 'diamond') dims = [7, 7, 7];
  if (shape === 'pyramid') dims[1] = Math.ceil(Math.min(dims[0], dims[2]) / 2);
  while (shape !== 'diamond' && dims[0] * dims[1] * dims[2] > 300) dims[dims.indexOf(Math.max(...dims))]--;
  return {
    level: n,
    name: `${SHAPE_NAMES[shape]} ${n}`,
    shape,
    dims,
    difficulty: Math.min(0.95, 0.85 + k * 0.005),
  };
}

export function levelSeed(level) {
  return (level * 2654435761) >>> 0;
}

// ---- Yardımcılar ----------------------------------------------------------
function inBox(x, y, z, d) {
  return x >= 0 && y >= 0 && z >= 0 && x < d[0] && y < d[1] && z < d[2];
}

// Hücreden dir yönünde kutunun dışına kadar ilerler; ilk dolu hücreyi ya da null döndürür.
// steps: engel çıkana kadar boş geçilen hücre sayısı.
export function castRay(occupied, dims, pos, dirIndex) {
  const [dx, dy, dz] = DIRS[dirIndex];
  let [x, y, z] = pos;
  let steps = 0;
  for (;;) {
    x += dx; y += dy; z += dz;
    if (!inBox(x, y, z, dims)) return { hit: null, steps };
    const k = key(x, y, z);
    if (occupied.has(k)) return { hit: occupied.get(k), steps };
    steps++;
  }
}

function rayLengthInShape(cells, dims, pos, dirIndex) {
  const [dx, dy, dz] = DIRS[dirIndex];
  let [x, y, z] = pos;
  let n = 0;
  for (;;) {
    x += dx; y += dy; z += dz;
    if (!inBox(x, y, z, dims)) return n;
    if (cells.has(key(x, y, z))) n++;
  }
}

// ---- Üretici ---------------------------------------------------------------
export function generatePuzzle(levelOrConfig, seed) {
  const cfg = typeof levelOrConfig === 'number' ? levelConfig(levelOrConfig) : levelOrConfig;
  const useSeed = seed ?? levelSeed(cfg.level ?? 1);
  for (let attempt = 0; attempt < 20; attempt++) {
    const p = tryGenerate(cfg, (useSeed + attempt * 101) >>> 0);
    if (p) return p;
  }
  throw new Error('Bulmaca üretilemedi');
}

function tryGenerate(cfg, seed) {
  const rnd = mulberry32(seed);
  const d = cfg.dims;
  const shapeFn = SHAPES[cfg.shape] || SHAPES.prism;
  const c = [Math.floor((d[0] - 1) / 2), Math.floor((d[1] - 1) / 2), Math.floor((d[2] - 1) / 2)];
  // Piramit/merdiven gibi şekillerde kafesi tabana yakın tut ki şeklin içinde kalsın.
  if (cfg.shape === 'pyramid' || cfg.shape === 'stairs') c[1] = 0;
  if (cfg.shape === 'ring') { c[0] = 0; c[2] = Math.floor((d[2] - 1) / 2); }

  const cells = new Set();
  for (let x = 0; x < d[0]; x++)
    for (let y = 0; y < d[1]; y++)
      for (let z = 0; z < d[2]; z++)
        if (shapeFn(x, y, z, d, c)) cells.add(key(x, y, z));
  cells.add(key(...c));

  const cageKey = key(...c);
  const difficulty = cfg.difficulty ?? 0.3;

  // Dıştan içe "soyma": her adımda dışarıya açık yolu olan rastgele bir hücre seçip
  // o yönü okun yönü yaparız ve hücreyi kaldırırız. Kaldırma sırası = geçerli çözüm.
  // (Kalan hücrelerden, kafesten bir eksende en uzakta olanın o yönde yolu daima açıktır,
  //  bu yüzden bu yöntem asla takılmaz.)
  const occupied = new Map();
  for (const k of cells) occupied.set(k, k === cageKey ? 'cage' : 'x');
  const pos = new Map([...cells].map((k) => [k, k.split(',').map(Number)]));
  const removalOrder = [];
  const dirOf = new Map();
  while (occupied.size > 1) {
    const free = [];
    for (const k of occupied.keys()) {
      if (k === cageKey) continue;
      const dirs = [];
      for (let dir = 0; dir < 6; dir++) {
        if (castRay(occupied, d, pos.get(k), dir).hit === null) dirs.push(dir);
      }
      if (dirs.length) free.push({ k, dirs });
    }
    if (!free.length) return null;
    const pick = free[Math.floor(rnd() * free.length)];
    let dir;
    const scored = pick.dirs.map((v) => ({ v, len: rayLengthInShape(cells, d, pos.get(pick.k), v) + rnd() * 0.5 }));
    if (rnd() < difficulty) {
      // Zor: başlangıçta önünde en çok blok olan yön (uzun bağımlılık zinciri).
      dir = scored.reduce((a, b) => (b.len > a.len ? b : a)).v;
    } else if (rnd() < 0.5 + (1 - difficulty) * 0.5) {
      // Kolay: dışarıya en kısa yol.
      dir = scored.reduce((a, b) => (b.len < a.len ? b : a)).v;
    } else {
      dir = pick.dirs[Math.floor(rnd() * pick.dirs.length)];
    }
    dirOf.set(pick.k, dir);
    removalOrder.push(pick.k);
    occupied.delete(pick.k);
  }

  // Blokları sabit (konuma göre) sırayla numarala.
  const sortedKeys = [...cells].filter((k) => k !== cageKey).sort();
  const idOf = new Map(sortedKeys.map((k, i) => [k, i]));
  const blocks = sortedKeys.map((k, i) => ({ id: i, pos: pos.get(k), dir: dirOf.get(k) }));
  const solution = removalOrder.map((k) => idOf.get(k));

  return {
    level: cfg.level ?? 0,
    name: cfg.name ?? '',
    shape: cfg.shape,
    dims: d.slice(),
    cage: c,
    seed,
    blocks,
    solution,
  };
}

// ---- Oyun durumu -----------------------------------------------------------
export class PuzzleState {
  constructor(puzzle) {
    this.puzzle = puzzle;
    this.occupied = new Map();
    this.occupied.set(key(...puzzle.cage), 'cage');
    for (const b of puzzle.blocks) this.occupied.set(key(...b.pos), b.id);
    this.removed = new Set();
  }

  get total() { return this.puzzle.blocks.length; }
  get remaining() { return this.total - this.removed.size; }
  get solved() { return this.remaining === 0; }

  // Bloğu oku yönünde göndermeyi dener. { ok:true } ya da { ok:false, hit, steps }
  tryMove(id) {
    if (this.removed.has(id)) return { ok: false, gone: true };
    const b = this.puzzle.blocks[id];
    const r = castRay(this.occupied, this.puzzle.dims, b.pos, b.dir);
    if (r.hit !== null) return { ok: false, hit: r.hit, steps: r.steps };
    this.occupied.delete(key(...b.pos));
    this.removed.add(id);
    return { ok: true };
  }

  isFree(id) {
    const b = this.puzzle.blocks[id];
    return castRay(this.occupied, this.puzzle.dims, b.pos, b.dir).hit === null;
  }
}

// ---- Puanlama --------------------------------------------------------------
export function parTimeMs(puzzle) {
  return Math.round((4 + puzzle.blocks.length * 1.1) * 1000);
}

export function scoreFor(puzzle, timeMs, bumps) {
  const par = parTimeMs(puzzle);
  const stars = timeMs <= par ? 3 : timeMs <= par * 1.75 ? 2 : 1;
  const base = puzzle.blocks.length * 40;
  const speedBonus = Math.max(0, Math.round(((par * 2 - timeMs) / 1000) * 25));
  const score = Math.max(50, base + speedBonus - bumps * 20);
  return { score, stars, par };
}

// Çarpınca oyuncu kısa süre sersemler (VS'de de herkes için aynı kural).
export const BUMP_STUN_MS = 1200;
