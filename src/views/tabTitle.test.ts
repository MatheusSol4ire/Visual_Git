import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detailsTabTitle } from './tabTitle.ts';

const hash = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';

test('detailsTabTitle usa o assunto do commit', () => {
  assert.equal(detailsTabTitle('Corrige o login', hash), 'Corrige o login');
  assert.equal(detailsTabTitle('  Corrige\to   login ', hash), 'Corrige o login');
});

test('detailsTabTitle: assunto vazio mostra o código curto', () => {
  assert.equal(detailsTabTitle('', hash), 'Commit 1a2b3c4');
  assert.equal(detailsTabTitle('   ', hash), 'Commit 1a2b3c4');
});

test('detailsTabTitle corta assunto longo sem partir emoji', () => {
  const long = 'Atualiza as dependências do projeto e corrige os testes que quebraram';
  const title = detailsTabTitle(long, hash);
  assert.equal(Array.from(title).length <= 40, true);
  assert.ok(title.endsWith('…'));
  assert.ok(long.startsWith(title.slice(0, -1)));
  const emoji = `${'a'.repeat(38)}🎉🎉🎉`;
  assert.equal(detailsTabTitle(emoji, hash), `${'a'.repeat(38)}🎉…`);
});
