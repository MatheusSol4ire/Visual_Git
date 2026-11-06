import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorIndexFor, initials, timeAgo } from './format.ts';

test('iniciais do nome', () => {
  assert.equal(initials('Ana Maria Souza'), 'AS');
  assert.equal(initials('ana'), 'AN');
  assert.equal(initials('  João  '), 'JO');
  assert.equal(initials(''), '?');
  assert.equal(initials('Élio Ávila'), 'ÉÁ');
});

test('tempo relativo em português', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  assert.equal(timeAgo('2026-11-05T11:59:50Z', now), 'agora mesmo');
  assert.equal(timeAgo('2026-11-05T10:00:00Z', now), 'há 2 horas');
  assert.equal(timeAgo('2026-11-04T12:00:00Z', now), 'ontem');
  assert.equal(timeAgo('data inválida', now), '');
});

test('a mesma pessoa sempre tem a mesma cor', () => {
  assert.equal(colorIndexFor('ana@ex.com', 8), colorIndexFor('ana@ex.com', 8));
  for (const key of ['a', 'b', 'ana@ex.com', '']) {
    const index = colorIndexFor(key, 8);
    assert.ok(index >= 0 && index < 8);
  }
});
