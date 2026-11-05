import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePuzzle, levelConfig, PuzzleState, scoreFor, HAND_LEVEL_COUNT } from '../public/js/puzzle.js';

test('aynı bölüm + tohum her zaman aynı bulmacayı üretir (VS için şart)', () => {
  const a = generatePuzzle(7, 12345);
  const b = generatePuzzle(7, 12345);
  assert.deepEqual(a, b);
  assert.notDeepEqual(generatePuzzle(7, 1).blocks, generatePuzzle(7, 2).blocks);
});

test('verilen çözüm sırası geçerli', () => {
  for (let lv = 1; lv <= HAND_LEVEL_COUNT + 15; lv++) {
    const p = generatePuzzle(lv);
    const s = new PuzzleState(p);
    for (const id of p.solution) assert.ok(s.tryMove(id).ok, `bölüm ${lv}, blok ${id}`);
    assert.ok(s.solved);
  }
});

test('bulmaca asla kilitlenmez: rastgele serbest blok seçerek hep bitirilir', () => {
  for (let lv = 1; lv <= HAND_LEVEL_COUNT + 15; lv++) {
    for (const seed of [1, 99, 2024]) {
      const p = generatePuzzle(lv, seed);
      const s = new PuzzleState(p);
      let guard = 0;
      while (!s.solved) {
        const free = p.blocks.filter((b) => !s.removed.has(b.id) && s.isFree(b.id));
        assert.ok(free.length > 0, `bölüm ${lv} tohum ${seed} kilitlendi`);
        s.tryMove(free[(guard * 7) % free.length].id);
        assert.ok(++guard < 10000);
      }
    }
  }
});

test('engelli ok çarpar ve yerinde kalır', () => {
  const p = generatePuzzle(10);
  const s = new PuzzleState(p);
  const blocked = p.blocks.find((b) => !s.isFree(b.id));
  assert.ok(blocked, 'zor bölümde engelli ok olmalı');
  const r = s.tryMove(blocked.id);
  assert.equal(r.ok, false);
  assert.equal(s.remaining, p.blocks.length);
});

test('bölümler zorlaşır ve şekiller çeşitlenir', () => {
  const sizes = [1, 5, 10, 15, 20].map((l) => generatePuzzle(l).blocks.length);
  assert.ok(sizes[0] < sizes[2] && sizes[2] < sizes[4], sizes.join(','));
  const shapes = new Set(Array.from({ length: 30 }, (_, i) => levelConfig(i + 1).shape));
  assert.ok(shapes.size >= 5);
  assert.ok(levelConfig(25).dims);
});

test('puan: hızlı bitiren daha çok puan ve yıldız alır', () => {
  const p = generatePuzzle(3);
  const fast = scoreFor(p, 5000, 0);
  const slow = scoreFor(p, 200000, 3);
  assert.ok(fast.score > slow.score);
  assert.equal(fast.stars, 3);
  assert.equal(slow.stars, 1);
});
