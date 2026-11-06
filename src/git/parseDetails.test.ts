import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFileChanges, parseShow } from './parseDetails.ts';

const F = '\x1f';

test('separa assunto e corpo da mensagem', () => {
  const raw = ['abc', 'p1 p2', 'Ana', 'a@ex.com', '2026-01-01T00:00:00Z', 'Bia', '2026-01-02T00:00:00Z', 'tag: refs/tags/v1', 'Título\n\nCorpo linha 1\nCorpo linha 2\n'].join(F);
  const info = parseShow(raw);
  assert.equal(info?.subject, 'Título');
  assert.equal(info?.body, 'Corpo linha 1\nCorpo linha 2');
  assert.deepEqual(info?.parents, ['p1', 'p2']);
  assert.deepEqual(info?.refs, [{ name: 'v1', type: 'tag' }]);
  assert.equal(info?.committerName, 'Bia');
});

test('mensagem de uma linha só tem corpo vazio', () => {
  const raw = ['abc', '', 'Ana', 'a@ex.com', 'd', 'Ana', 'd', '', 'Só o título\n'].join(F);
  assert.equal(parseShow(raw)?.body, '');
  assert.equal(parseShow(raw)?.subject, 'Só o título');
});

test('junta status e contagem de linhas, incluindo renomeação e binário', () => {
  const nameStatus = ['M', 'src/app.ts', 'A', 'docs/novo.md', 'D', 'velho.txt', 'R087', 'a/antes.ts', 'a/depois.ts', 'A', 'logo.png', ''].join('\0');
  const numstat = ['10\t2\tsrc/app.ts', '5\t0\tdocs/novo.md', '0\t3\tvelho.txt', '1\t1\t', 'a/antes.ts', 'a/depois.ts', '-\t-\tlogo.png', ''].join('\0');

  assert.deepEqual(parseFileChanges(nameStatus, numstat), [
    { path: 'src/app.ts', status: 'modified', additions: 10, deletions: 2 },
    { path: 'docs/novo.md', status: 'added', additions: 5, deletions: 0 },
    { path: 'velho.txt', status: 'deleted', additions: 0, deletions: 3 },
    { path: 'a/depois.ts', oldPath: 'a/antes.ts', status: 'renamed', additions: 1, deletions: 1 },
    { path: 'logo.png', status: 'added', additions: null, deletions: null },
  ]);
});

test('commit sem arquivos alterados', () => {
  assert.deepEqual(parseFileChanges('', ''), []);
});
