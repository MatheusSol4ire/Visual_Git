import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PageRequests } from './pageRequests.ts';

test('PageRequests cancela só os pedidos de listas que a tela já descartou', () => {
  const requests = new PageRequests();
  const first = requests.start(7);
  const more = requests.start(7); // "carregar mais" da mesma lista
  assert.equal(first.signal.aborted, false);
  assert.equal(more.signal.aborted, false);

  const reload = requests.start(8); // recarga ou outro filtro
  assert.equal(first.signal.aborted, true);
  assert.equal(more.signal.aborted, true);
  assert.equal(reload.signal.aborted, false);
  assert.equal(requests.size, 1);

  reload.done();
  assert.equal(requests.size, 0);
  // Um pedido que já terminou não é cancelado depois.
  requests.start(9);
  assert.equal(reload.signal.aborted, false);
});

test('PageRequests.cancelAll cancela tudo (tela fechada)', () => {
  const requests = new PageRequests();
  const a = requests.start(1);
  const b = requests.start(1);
  requests.cancelAll();
  assert.equal(a.signal.aborted, true);
  assert.equal(b.signal.aborted, true);
  assert.equal(requests.size, 0);
});
