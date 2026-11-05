import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePuzzle, levelConfig, PuzzleState, scoreFor, HAND_LEVEL_COUNT,
  allCells, cellKey, step, rayCells, headOf, axisOf, opposite,
} from '../public/js/puzzle.js';

const LEVELS = Array.from({ length: HAND_LEVEL_COUNT + 12 }, (_, i) => i + 1);

test('yüzeyde yürümek: 4 adımda aynı yüzde ya da kenarlardan dolaşarak geri dönülür', () => {
  const dims = [3, 4, 5];
  for (const cell of allCells(dims)) {
    for (const d of [0, 1, 2, 3, 4, 5].filter((x) => axisOf(x) !== axisOf(cell.f))) {
      // Bir adım git, ters yöne bir adım dön → başladığın hücre.
      const a = step(dims, cell, d);
      const back = step(dims, a.cell, opposite(a.t));
      assert.equal(cellKey(back.cell), cellKey(cell));
    }
  }
  assert.equal(allCells(dims).length, 2 * (3 * 4 + 4 * 5 + 3 * 5));
});

test('aynı bölüm + tohum her zaman aynı bulmacayı üretir (VS için şart)', () => {
  assert.deepEqual(generatePuzzle(7, 12345), generatePuzzle(7, 12345));
  assert.notDeepEqual(generatePuzzle(7, 1).arrows, generatePuzzle(7, 2).arrows);
});

test('oklar geçerli: hücreler komşu, çakışma yok, uç düz geliyor, önünde kendi gövdesi yok', () => {
  for (const lv of LEVELS) {
    const p = generatePuzzle(lv);
    const seen = new Set();
    for (const a of p.arrows) {
      assert.ok(a.cells.length >= 2);
      for (const c of a.cells) {
        assert.ok(!seen.has(cellKey(c)), `bölüm ${lv}: hücre iki okta`);
        seen.add(cellKey(c));
      }
      for (let i = 0; i + 1 < a.cells.length; i++) {
        const ok = [0, 1, 2, 3, 4, 5].some((d) => axisOf(d) !== axisOf(a.cells[i].f)
          && cellKey(step(p.dims, a.cells[i], d).cell) === cellKey(a.cells[i + 1]));
        assert.ok(ok, `bölüm ${lv}: ok ${a.id} kopuk`);
      }
      const h = headOf(a);
      const behind = step(p.dims, h, opposite(a.dir));
      assert.equal(behind.edge, null);
      assert.equal(cellKey(behind.cell), cellKey(a.cells[a.cells.length - 2]));
      const own = new Set(a.cells.map(cellKey));
      assert.ok(rayCells(p.dims, h, a.dir).every((c) => !own.has(cellKey(c))));
    }
  }
});

test('verilen çözüm karakteri kurtarır, sonra kalan bütün oklar da bitirilebilir', () => {
  for (const lv of LEVELS) {
    const p = generatePuzzle(lv);
    const s = new PuzzleState(p);
    for (const id of p.solution) assert.ok(s.tryMove(id).ok, `bölüm ${lv}, ok ${id}`);
    assert.ok(s.solved, `bölüm ${lv}: karakter kaçmalı`);
    let guard = 0;
    while (!s.allCleared) {
      const free = p.arrows.filter((a) => s.isFree(a.id));
      assert.ok(free.length, `bölüm ${lv}: kurtardıktan sonra kilitlendi`);
      s.tryMove(free[0].id);
      assert.ok(++guard < 10000);
    }
  }
});

test('bulmaca asla kilitlenmez: rastgele serbest ok seçerek karakter hep kurtarılır', () => {
  for (const lv of LEVELS) {
    for (const seed of [1, 99, 2024]) {
      const p = generatePuzzle(lv, seed);
      const s = new PuzzleState(p);
      let guard = 0;
      while (!s.solved) {
        const free = p.arrows.filter((a) => s.isFree(a.id));
        assert.ok(free.length > 0, `bölüm ${lv} tohum ${seed} kilitlendi`);
        s.tryMove(free[(guard * 7) % free.length].id);
        assert.ok(++guard < 10000);
      }
    }
  }
});

test('karakter okların arasına sıkışmış: hücresi boş, başta kaçamıyor, okları durduruyor', () => {
  let stoppedOne = false;
  for (const lv of LEVELS) {
    const p = generatePuzzle(lv);
    const s = new PuzzleState(p);
    assert.equal(s.arrowAt(p.character.cell), null);
    assert.equal(s.openEscape(), null, `bölüm ${lv}: başta yol açık olmamalı`);
    assert.ok(p.character.cost >= 1);
    // Önü boş ama yolu karakterden geçen bir ok varsa ona çarpar
    for (const a of p.arrows) {
      if (!s.isFree(a.id) && rayCells(p.dims, headOf(a), a.dir).some((c) => cellKey(c) === cellKey(p.character.cell))) {
        const r = new PuzzleState(p).tryMove(a.id);
        if (r.hit === 'character') { stoppedOne = true; break; }
      }
    }
    if (lv >= 7) {
      // Sadece başta serbest olan okları çıkarmak yetmemeli
      for (const a of p.arrows.filter((x) => s.isFree(x.id))) s.tryMove(a.id);
      assert.ok(!s.solved, `bölüm ${lv}: çok kolay`);
    }
  }
  assert.ok(stoppedOne, 'karakter en az bir bölümde bir oku durdurmalı');
});

test('engelli ok çarpar ve yerinde kalır', () => {
  const p = generatePuzzle(10);
  const s = new PuzzleState(p);
  const blocked = p.arrows.find((a) => !s.isFree(a.id));
  const r = s.tryMove(blocked.id);
  assert.equal(r.ok, false);
  assert.ok(r.steps >= 0);
  assert.equal(s.remaining, p.arrows.length);
});

test('bölümler büyür ve zorlaşır, küp dışında prizmalar da var', () => {
  const req = [2, 7, 13, 20].map((l) => generatePuzzle(l).character.cost);
  assert.ok(req[3] >= 8, req.join(','));
  assert.ok(req[0] < req[3], req.join(','));
  const nonCube = LEVELS.map(levelConfig).filter((c) => new Set(c.dims).size > 1);
  assert.ok(nonCube.length >= 5);
});

test('puan: hızlı bitiren daha çok puan ve yıldız alır', () => {
  const p = generatePuzzle(3);
  const fast = scoreFor(p, 3000, 0);
  const slow = scoreFor(p, 400000, 3);
  assert.ok(fast.score > slow.score);
  assert.equal(fast.stars, 3);
  assert.equal(slow.stars, 1);
});
