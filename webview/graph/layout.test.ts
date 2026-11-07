import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ancestorsOf, createLayoutState, fitRow, layoutCommits, MAIN_COLOR, type GraphCommit, type Segment } from './layout.ts';

const c = (hash: string, ...parents: string[]): GraphCommit => ({ hash, parents });
/** Só "de → para", para os testes ficarem fáceis de ler. */
const moves = (segments: Segment[] | undefined) => (segments ?? []).map((s) => `${s.from}→${s.to}`);

test('histórico em linha reta usa um trilho só', () => {
  const rows = layoutCommits([c('c', 'b'), c('b', 'a'), c('a')], createLayoutState());
  assert.deepEqual(rows.map((r) => r.col), [0, 0, 0]);
  assert.deepEqual(rows.map((r) => r.width), [1, 1, 1]);
  // O mais novo não tem linha chegando por cima; o mais antigo não tem linha saindo por baixo.
  assert.deepEqual(rows[0]?.top, []);
  assert.deepEqual(rows[2]?.bottom, []);
  assert.deepEqual(rows[1]?.top, [{ from: 0, to: 0, color: 0, child: 'c' }]);
});

test('branch e merge: abre um trilho e depois junta de volta', () => {
  //   m      (merge de f em main)
  //   | \
  //   c  f
  //   | /
  //   b
  const rows = layoutCommits([c('m', 'c', 'f'), c('c', 'b'), c('f', 'b'), c('b')], createLayoutState('m'));
  const [merge, main, feature, base] = rows;

  assert.equal(merge?.isMerge, true);
  assert.equal(merge?.col, 0);
  assert.deepEqual(moves(merge?.bottom), ['0→0', '0→1']);
  assert.equal(main?.col, 0);
  assert.deepEqual(moves(main?.bottom), ['0→0', '1→1']);

  // f segue no trilho 1 até o pai (b), em vez de pular para o trilho da main logo abaixo dele.
  assert.equal(feature?.col, 1);
  assert.deepEqual(moves(feature?.bottom), ['1→1', '0→0']);

  // Em b, as duas ligações se encontram.
  assert.equal(base?.col, 0);
  assert.deepEqual(moves(base?.top), ['0→0', '1→0']);
  assert.equal(base?.width, 2);
});

test('a main fica sempre no trilho 0, mesmo quando outra branch é mais nova', () => {
  //   f   (feature, mais nova)
  //   | m (main)
  //   |/
  //   b
  const rows = layoutCommits([c('f', 'b'), c('m', 'b'), c('b')], createLayoutState('m'));
  assert.deepEqual(rows.map((r) => r.col), [1, 0, 0]);
  assert.equal(rows[1]?.color, MAIN_COLOR);
  assert.equal(rows[2]?.color, MAIN_COLOR);
  assert.notEqual(rows[0]?.color, MAIN_COLOR, 'a cor da main é só dela');
  // Antes de a main aparecer, o trilho 0 fica vazio (guardado).
  assert.deepEqual(rows[0]?.top, []);
  assert.deepEqual(moves(rows[0]?.bottom), ['1→1']);
});

test('a ponta da main que é pai de outra branch puxa a linha para o trilho 0', () => {
  //   f   (feature criada a partir da ponta da main)
  //   m   (main)
  const rows = layoutCommits([c('f', 'm'), c('m')], createLayoutState('m'));
  assert.deepEqual(rows.map((r) => r.col), [1, 0]);
  assert.deepEqual(moves(rows[1]?.top), ['1→0']);
});

test('sem branch principal, a primeira ponta usa o trilho 0', () => {
  const rows = layoutCommits([c('x', 'a'), c('y', 'a'), c('a')], createLayoutState());
  assert.deepEqual(rows.map((r) => r.col), [0, 1, 0]);
  assert.notEqual(rows[0]?.color, rows[1]?.color);
  assert.deepEqual(moves(rows[2]?.top), ['0→0', '1→0']);
});

test('a próxima página continua o desenho de onde parou', () => {
  const all = [c('f', 'b'), c('m', 'c', 'g'), c('c', 'b'), c('g', 'b'), c('b', 'a'), c('a')];
  const together = layoutCommits(all, createLayoutState('m'));

  const state = createLayoutState('m');
  const paged = [...layoutCommits(all.slice(0, 2), state), ...layoutCommits(all.slice(2), state)];

  assert.deepEqual(paged, together);
});

test('trilho liberado é reaproveitado por uma branch nova', () => {
  const rows = layoutCommits([c('g', 'd'), c('m', 'd', 'f'), c('f', 'd'), c('d')], createLayoutState('m'));
  assert.ok(rows.every((r) => r.width <= 3));
});

test('cada ligação guarda o commit de onde saiu', () => {
  const rows = layoutCommits([c('m', 'c', 'f'), c('c', 'b'), c('f', 'b'), c('b')], createLayoutState('m'));
  // Em b chegam a ligação c→b (trilho 0) e f→b (trilho 1).
  assert.deepEqual(rows[3]?.top.map((s) => s.child), ['c', 'f']);
  // Na linha de c, o trilho 1 ainda é a ligação m→f passando.
  assert.deepEqual(rows[1]?.top.map((s) => s.child), ['m', 'm']);
});

test('ancestorsOf acha só o histórico da branch escolhida', () => {
  const commits = [c('f2', 'f1'), c('m2', 'm1'), c('f1', 'm1'), c('m1', 'r'), c('r')];
  assert.deepEqual([...ancestorsOf('f2', commits)].sort(), ['f1', 'f2', 'm1', 'r']);
  assert.deepEqual([...ancestorsOf('m2', commits)].sort(), ['m1', 'm2', 'r']);
  // Commit que não foi carregado: conjunto vazio.
  assert.equal(ancestorsOf('zzz', commits).size, 0);
});

test('fitRow: commit além do corte de trilhos fica com a bolinha na borda', () => {
  // 12 branches em paralelo saindo de r; a última (t11 → u) passa do corte de 10 trilhos.
  const tips = Array.from({ length: 11 }, (_, i) => c(`t${i}`, 'r'));
  const rows = layoutCommits([...tips, c('t11', 'u'), c('u', 'r'), c('r')], createLayoutState());
  const [t11, u, r] = rows.slice(11);
  assert.equal(t11?.col, 11);
  assert.equal(u?.col, 11);

  // Dentro do corte: nada muda.
  const first = fitRow(rows[0]!, 10);
  assert.deepEqual(first, { col: 0, top: rows[0]!.top, bottom: rows[0]!.bottom, overflow: false });
  assert.equal(fitRow(r!, 10).overflow, false);

  // Ponta além do corte: bolinha no último trilho visível, e a ligação para o pai sai pela borda.
  const tip = fitRow(t11!, 10);
  assert.equal(tip.overflow, true);
  assert.equal(tip.col, 9);
  assert.deepEqual(moves(tip.top), moves(t11!.top)); // só trilhos passando, não mudam
  assert.ok(moves(tip.bottom).includes('9→11'));
  assert.ok(moves(tip.bottom).includes('9→9')); // o trilho 9 de verdade continua passando

  // Commit no meio do trilho cortado: a linha de cima chega na bolinha da borda.
  const middle = fitRow(u!, 10);
  assert.equal(middle.col, 9);
  assert.ok(moves(middle.top).includes('11→9'));
  assert.ok(moves(middle.bottom).includes('9→11'));
  assert.ok(!moves(middle.top).includes('11→11'));
});
