import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstGen, parseSavedDetails, parseSavedList } from './savedState.ts';

const H = 'a'.repeat(40);

test('parseSavedList devolve o padrão para estado vazio ou estranho', () => {
  const empty = { filter: { kind: 'all' }, gen: null, selected: null, pinned: null, scrollTop: 0, count: 0 };
  assert.deepEqual(parseSavedList(undefined), empty);
  assert.deepEqual(parseSavedList('lixo'), empty);
  assert.deepEqual(
    parseSavedList({ gen: 1.5, selected: '--all', pinned: { hash: H, name: '' }, scrollTop: -10, count: Number.NaN }),
    empty,
  );
  // Destaque sem tipo de etiqueta conhecido (ex.: salvo por uma versão antiga) não volta.
  assert.equal(parseSavedList({ pinned: { hash: H, name: 'main' } }).pinned, null);
  assert.equal(parseSavedList({ pinned: { hash: H, name: 'main', type: 'pasta' } }).pinned, null);
});

test('parseSavedList lê o que a lista guardou', () => {
  const saved = {
    filter: { kind: 'branch', ref: 'refs/heads/main' },
    gen: 7,
    selected: H,
    pinned: { hash: H, name: 'origin/main', type: 'remote' },
    scrollTop: 1234.6,
    count: 600,
  };
  assert.deepEqual(parseSavedList(saved), { ...saved, scrollTop: 1234 });
});

test('firstGen continua depois do último pedido da tela antiga', () => {
  assert.equal(firstGen(parseSavedList({ gen: 41 })), 42);
  // Sem nada salvo, sorteia (para não repetir o 0 de outra tela).
  assert.equal(firstGen(parseSavedList(undefined), () => 0.5), 500_000_000);
});

test('parseSavedDetails aceita só hash de verdade', () => {
  assert.deepEqual(parseSavedDetails({ hash: H, scrollTop: 300 }), { hash: H, scrollTop: 300 });
  assert.deepEqual(parseSavedDetails({ hash: '<script>', scrollTop: 'x' }), { hash: null, scrollTop: 0 });
});
