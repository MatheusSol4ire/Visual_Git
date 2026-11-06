import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutState, layoutCommits, type GraphCommit } from './layout.ts';

const c = (hash: string, ...parents: string[]): GraphCommit => ({ hash, parents });

test('histórico em linha reta usa um trilho só', () => {
  const rows = layoutCommits([c('c', 'b'), c('b', 'a'), c('a')], createLayoutState());
  assert.deepEqual(rows.map((r) => r.col), [0, 0, 0]);
  assert.deepEqual(rows.map((r) => r.width), [1, 1, 1]);
  // O mais novo não tem linha chegando por cima; o mais antigo não tem linha saindo por baixo.
  assert.deepEqual(rows[0]?.top, []);
  assert.deepEqual(rows[2]?.bottom, []);
  assert.deepEqual(rows[1]?.top, [{ from: 0, to: 0, color: 0 }]);
});

test('branch e merge: abre um trilho e depois junta de volta', () => {
  //   m      (merge de f em main)
  //   | \
  //   c  f
  //   | /
  //   b
  const rows = layoutCommits([c('m', 'c', 'f'), c('c', 'b'), c('f', 'b'), c('b')], createLayoutState());

  const [merge, main, feature, base] = rows;
  assert.equal(merge?.isMerge, true);
  assert.equal(merge?.col, 0);
  assert.deepEqual(merge?.bottom, [
    { from: 0, to: 0, color: 0 },
    { from: 0, to: 1, color: 1 },
  ]);

  assert.equal(main?.col, 0);
  assert.deepEqual(main?.bottom, [
    { from: 0, to: 0, color: 0 },
    { from: 1, to: 1, color: 1 },
  ]);

  // f fica no trilho 1 e o pai dele (b) já é esperado no trilho 0: a linha curva para lá.
  assert.equal(feature?.col, 1);
  assert.deepEqual(feature?.bottom, [
    { from: 1, to: 0, color: 0 },
    { from: 0, to: 0, color: 0 },
  ]);

  assert.equal(base?.col, 0);
  assert.equal(base?.width, 1);
});

test('duas pontas de branch abrem trilhos e cores diferentes', () => {
  const rows = layoutCommits([c('x', 'a'), c('y', 'a'), c('a')], createLayoutState());
  assert.equal(rows[0]?.col, 0);
  assert.equal(rows[1]?.col, 1);
  assert.notEqual(rows[0]?.color, rows[1]?.color);
  // "a" já é esperado no trilho 0, então a linha de y curva para lá logo abaixo de y...
  assert.deepEqual(rows[1]?.bottom, [
    { from: 1, to: 0, color: 0 },
    { from: 0, to: 0, color: 0 },
  ]);
  // ...e em "a" só chega um trilho.
  assert.deepEqual(rows[2]?.top, [{ from: 0, to: 0, color: 0 }]);
  assert.equal(rows[2]?.col, 0);
});

test('a próxima página continua o desenho de onde parou', () => {
  const all = [c('m', 'c', 'f'), c('c', 'b'), c('f', 'b'), c('b', 'a'), c('a')];
  const together = layoutCommits(all, createLayoutState());

  const state = createLayoutState();
  const paged = [...layoutCommits(all.slice(0, 2), state), ...layoutCommits(all.slice(2), state)];

  assert.deepEqual(paged, together);
});

test('trilho liberado é reaproveitado por uma branch nova', () => {
  // f termina (junta em main); depois g aparece e pode reusar o trilho 1.
  const rows = layoutCommits(
    [c('g', 'd'), c('m', 'd', 'f'), c('f', 'd'), c('d')],
    createLayoutState(),
  );
  assert.ok(rows.every((r) => r.width <= 3));
});
