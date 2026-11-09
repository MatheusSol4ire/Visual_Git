import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiffTree, parseShow, splitMessage } from './parseDetails.ts';

const F = '\0';
const H = 'a'.repeat(40);
const P1 = '1'.repeat(40);
const P2 = '2'.repeat(40);

test('separa assunto e corpo da mensagem', () => {
  const raw = [H, `${P1} ${P2}`, 'Ana', 'a@example.com', '2026-01-01T00:00:00Z', 'Bia', '2026-01-02T00:00:00Z', 'tag: refs/tags/v1', 'Título\n\nCorpo linha 1\nCorpo linha 2\n'].join(F);
  const info = parseShow(raw);
  assert.equal(info?.subject, 'Título');
  assert.equal(info?.body, 'Corpo linha 1\nCorpo linha 2');
  assert.deepEqual(info?.parents, [P1, P2]);
  assert.deepEqual(info?.refs, [{ name: 'v1', type: 'tag' }]);
  assert.equal(info?.committerName, 'Bia');
});

test('título segue a regra do %s do Git: pula linhas em branco e junta o 1º parágrafo', () => {
  assert.deepEqual(splitMessage('\n\n  \nTítulo depois de linhas em branco\n\nCorpo\n'), {
    subject: 'Título depois de linhas em branco',
    body: 'Corpo',
  });
  assert.deepEqual(splitMessage('Corrige o login  \ne ajusta o cadastro\n\nDetalhes do corpo.\n\nMais.\n'), {
    subject: 'Corrige o login e ajusta o cadastro',
    body: 'Detalhes do corpo.\n\nMais.',
  });
  assert.deepEqual(splitMessage('Windows\r\n\r\nCorpo\r\n'), { subject: 'Windows', body: 'Corpo' });
  assert.deepEqual(splitMessage(''), { subject: '', body: '' });
});

test('mensagem de uma linha só tem corpo vazio', () => {
  const raw = [H, '', 'Ana', 'a@example.com', 'd', 'Ana', 'd', '', 'Só o título\n'].join(F);
  assert.equal(parseShow(raw)?.body, '');
  assert.equal(parseShow(raw)?.subject, 'Só o título');
});

test('recusa hash ou pais que não são hashes completos', () => {
  const show = (hash: string, parents: string) => [hash, parents, 'Ana', 'a@example.com', 'd', 'Ana', 'd', '', 'x'].join(F);
  assert.equal(parseShow(show('conteúdo de um arquivo', '')), undefined);
  assert.equal(parseShow(show(H, '--output=/tmp/x')), undefined);
  assert.equal(parseShow(show(H, `${P1} abc`)), undefined);
  assert.ok(parseShow(show(H, P1)));
});

test('separador antigo (\\x1f) no nome do autor não desloca os campos', () => {
  const raw = [H, '', 'Ana\x1fFalsa', 'a@example.com', '2026-01-01T00:00:00Z', 'Bia', '2026-01-02T00:00:00Z', '', 'Título'].join(F);
  const info = parseShow(raw);
  assert.equal(info?.authorName, 'Ana\x1fFalsa');
  assert.equal(info?.date, '2026-01-01T00:00:00Z');
  assert.equal(info?.subject, 'Título');
});

const Z = '0'.repeat(40);
/** Cabeçalho do `--raw` com a letra de status. */
const head = (code: string) => `:100644 100644 ${Z} ${Z} ${code}`;

test('junta status (--raw) e contagem de linhas (--numstat) da mesma saída, incluindo renomeação e binário', () => {
  const raw = [
    head('M'), 'src/app.ts',
    head('A'), 'docs/novo.md',
    head('D'), 'velho.txt',
    head('R087'), 'a/antes.ts', 'a/depois.ts',
    head('A'), 'logo.png',
    '10\t2\tsrc/app.ts', '5\t0\tdocs/novo.md', '0\t3\tvelho.txt', '1\t1\t', 'a/antes.ts', 'a/depois.ts', '-\t-\tlogo.png', '',
  ].join('\0');

  assert.deepEqual(parseDiffTree(raw), [
    { path: 'src/app.ts', status: 'modified', additions: 10, deletions: 2 },
    { path: 'docs/novo.md', status: 'added', additions: 5, deletions: 0 },
    { path: 'velho.txt', status: 'deleted', additions: 0, deletions: 3 },
    { path: 'a/depois.ts', oldPath: 'a/antes.ts', status: 'renamed', additions: 1, deletions: 1 },
    { path: 'logo.png', status: 'added', additions: null, deletions: null },
  ]);
});

test('só o --raw (sem contagem): arquivos aparecem sem os números', () => {
  assert.deepEqual(parseDiffTree([head('M'), 'a.txt', head('C100'), 'b.txt', 'c.txt', ''].join('\0')), [
    { path: 'a.txt', status: 'modified', additions: null, deletions: null },
    { path: 'c.txt', oldPath: 'b.txt', status: 'copied', additions: null, deletions: null },
  ]);
});

test('caminho com TAB ou começando com ":" não confunde a leitura', () => {
  const raw = [head('A'), 'relatório\tfinal.txt', head('A'), ':estranho', '3\t0\trelatório\tfinal.txt', '2\t0\t:estranho', ''].join('\0');
  assert.deepEqual(parseDiffTree(raw), [
    { path: 'relatório\tfinal.txt', status: 'added', additions: 3, deletions: 0 },
    { path: ':estranho', status: 'added', additions: 2, deletions: 0 },
  ]);
});

test('commit sem arquivos alterados', () => {
  assert.deepEqual(parseDiffTree(''), []);
});
