import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shallowEqual } from './memo.ts';

test('shallowEqual compara cada propriedade por referência', () => {
  const lit = new Set(['a']);
  const onOpen = () => {};
  assert.equal(shallowEqual({ index: 1, lit, onOpen, selected: false }, { index: 1, lit, onOpen, selected: false }), true);
  // Objeto ou função nova com o mesmo conteúdo conta como mudança (por isso as props precisam ser estáveis).
  assert.equal(shallowEqual({ lit }, { lit: new Set(['a']) }), false);
  assert.equal(shallowEqual({ onOpen }, { onOpen: () => {} }), false);
  assert.equal(shallowEqual({ index: 1 }, { index: 2 }), false);
  assert.equal(shallowEqual({ selected: false }, { selected: true }), false);
  // Chave a mais, a menos ou trocada.
  assert.equal(shallowEqual({ a: 1 }, { a: 1, b: 2 }), false);
  assert.equal(shallowEqual({ a: 1, b: 2 }, { a: 1 }), false);
  assert.equal(shallowEqual({ a: undefined }, { b: undefined }), false);
  // NaN igual a NaN (Object.is), e `null` diferente de `undefined`.
  assert.equal(shallowEqual({ n: Number.NaN }, { n: Number.NaN }), true);
  assert.equal(shallowEqual({ x: null }, { x: undefined }), false);
});
