import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ancestorsOf,
  createLayoutState,
  fitRow,
  lanesFor,
  layoutCommits,
  MAIN_COLOR,
  PALETTE_SIZE,
  splitThrough,
  type GraphCommit,
  type GraphRow,
  type Segment,
} from './layout.ts';

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
  //   a      (trilho 1, espera m2)
  //   | b    (trilho 2, espera m0)
  //   m3     (main)
  //   m2     ← a chega: o trilho 1 fica livre
  //   | n    ← ponta nova: reaproveita o trilho 1, em vez de abrir o 3
  //   m1
  //   m0
  const history = [c('a', 'm2'), c('b', 'm0'), c('m3', 'm2'), c('m2', 'm1'), c('n', 'm1'), c('m1', 'm0'), c('m0')];
  const rows = layoutCommits(history, createLayoutState('m3'));
  assert.deepEqual(rows.map((r) => r.col), [1, 2, 0, 0, 1, 0, 0]);
  assert.equal(rows[4]?.width, 3);
});

test('cada ligação guarda o commit de onde saiu', () => {
  const rows = layoutCommits([c('m', 'c', 'f'), c('c', 'b'), c('f', 'b'), c('b')], createLayoutState('m'));
  // Em b chegam a ligação c→b (trilho 0) e f→b (trilho 1).
  assert.deepEqual(rows[3]?.top.map((s) => s.child), ['c', 'f']);
  // Na linha de c, o trilho 1 ainda é a ligação m→f passando.
  assert.deepEqual(rows[1]?.top.map((s) => s.child), ['m', 'm']);
});

test('ancestorsOf segue todos os pais: passa por merge e por losango', () => {
  //   m      (merge de f na main)
  //   |   //   a  f
  //   |  |
  //   b  g   ← g puxou a main (merge de b em g): losango
  //   | /|
  //   r  |
  //      h
  const commits = [c('m', 'a', 'f'), c('a', 'b'), c('f', 'g'), c('g', 'h', 'b'), c('b', 'r'), c('h', 'r'), c('r')];
  assert.deepEqual([...ancestorsOf('m', commits)].sort(), ['a', 'b', 'f', 'g', 'h', 'm', 'r']);
  // A partir da feature: inclui o que entrou pelo 2º pai (b), mas não a main depois dela (a, m).
  assert.deepEqual([...ancestorsOf('f', commits)].sort(), ['b', 'f', 'g', 'h', 'r']);
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

test('com corte de trilhos, o que passa além dele não vira ligação, e o desenho visível é o mesmo', () => {
  // 30 branches em paralelo saindo de r, com mais um commit cada (bem mais largo que o corte de 10).
  const tips = Array.from({ length: 30 }, (_, i) => c(`t${i}`, `p${i}`));
  const middles = Array.from({ length: 30 }, (_, i) => c(`p${i}`, 'r'));
  const history = [c('m', 'r', 't29'), ...tips, ...middles, c('r')];
  const full = layoutCommits(history, createLayoutState('m'));
  const cut = layoutCommits(history, createLayoutState('m', 10));

  const shown = (segment: Segment) => segment.from < 10 || segment.to < 10;
  const drawn = (row: GraphRow) => {
    const fitted = fitRow(row, 10);
    return { ...fitted, top: fitted.top.filter(shown), bottom: fitted.bottom.filter(shown), color: row.color, width: row.width };
  };
  assert.deepEqual(cut.map(drawn), full.map(drawn));
  // A largura continua contando todos os trilhos (a tela usa para decidir quantos mostrar).
  assert.deepEqual(cut.map((r) => r.width), full.map((r) => r.width));
  // Nenhuma linha guarda mais que os 10 trilhos visíveis passando (+ o que chega/sai da bolinha).
  for (const row of cut) {
    const passingFar = [...row.top, ...row.bottom].filter((s) => s.from === s.to && s.from >= 10 && s.from !== row.col);
    assert.deepEqual(passingFar, []);
  }
  assert.ok(full.some((row) => row.top.length > 20), 'sem corte, as linhas do meio guardam os 30 trilhos');
  // O merge abre o trilho do pai extra mesmo além do corte: o pai (t29) continua ligado a ele.
  const t29 = cut[history.findIndex((commit) => commit.hash === 't29')]!;
  assert.ok(t29.top.some((s) => s.to === t29.col && s.child === 'm'));
});

test('splitThrough: trilho que só atravessa a linha vira um traço só; o da bolinha continua em duas metades', () => {
  const rows = layoutCommits([c('m', 'c', 'f'), c('c', 'b'), c('f', 'b'), c('b')], createLayoutState('m'));
  const main = rows[1]!; // c: trilho 0 (chega de m e segue para b) e trilho 1 (m → f passando)
  const split = splitThrough(main.top, main.bottom, main.col);
  assert.deepEqual(moves(split.through), ['1→1']);
  assert.deepEqual(split.through.map((s) => s.child), ['m']);
  assert.deepEqual(moves(split.top), ['0→0']);
  assert.deepEqual(moves(split.bottom), ['0→0']);
  // Linha do merge: nada atravessa (a curva 0→1 sai da bolinha).
  const merge = splitThrough(rows[0]!.top, rows[0]!.bottom, rows[0]!.col);
  assert.deepEqual(merge.through, []);
  assert.deepEqual(moves(merge.bottom), ['0→0', '0→1']);
});

test('cores: com main, as outras branches giram só por 1..7; sem main, por 0..7', () => {
  // 12 pontas de branch saindo de r: passa da 8ª cor e dá a volta na paleta.
  const tips = Array.from({ length: 12 }, (_, i) => c(`t${i}`, 'r'));
  const withMain = layoutCommits([...tips, c('m', 'r'), c('r')], createLayoutState('m'));
  const branchColors = withMain.slice(0, 12).map((r) => r.color);
  assert.deepEqual(branchColors, [1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5]);
  assert.equal(withMain[12]?.color, MAIN_COLOR);
  const without = layoutCommits([...tips, c('r')], createLayoutState());
  assert.deepEqual(without.slice(0, 12).map((r) => r.color), [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3]);
  // Toda ligação usa uma cor que existe na paleta (--vg-c0 a --vg-c7).
  for (const row of [...withMain, ...without]) {
    for (const segment of [...row.top, ...row.bottom]) assert.ok(segment.color >= 0 && segment.color < PALETTE_SIZE);
  }
});

test('main puxada para dentro da feature: a ligação até a main tem a cor da main', () => {
  //   m2       (main)
  //   | f2     (merge de m1 na feature)
  //   |/|
  //   m1 f1
  //   | /
  //   m0
  const rows = layoutCommits([c('m2', 'm1'), c('f2', 'f1', 'm1'), c('m1', 'm0'), c('f1', 'm0'), c('m0')], createLayoutState('m2'));
  const merge = rows[1]!;
  assert.equal(merge.isMerge, true);
  assert.equal(merge.col, 1);
  const toMain = merge.bottom.find((s) => s.from === 1 && s.to !== 1);
  assert.equal(toMain?.color, MAIN_COLOR);
  assert.notEqual(merge.color, MAIN_COLOR);
});

test('quando a main termina (commit raiz), o trilho 0 fica livre para outra branch', () => {
  const rows = layoutCommits([c('m1', 'm0'), c('m0'), c('y', 'z'), c('z')], createLayoutState('m1'));
  assert.deepEqual(rows.map((r) => r.col), [0, 0, 0, 0]);
});

test('pai extra de um merge abre trilho próprio, mesmo que outro trilho já espere por ele', () => {
  //   f      (trilho 1, espera p)
  //   m      (merge: 1º pai q, 2º pai p) → p ganha o trilho 2, não junta com o 1
  //   q
  //   p      ← chegam três ligações
  const rows = layoutCommits([c('f', 'p'), c('m', 'q', 'p'), c('q', 'p'), c('p')], createLayoutState('m'));
  assert.deepEqual(moves(rows[1]?.bottom), ['0→0', '0→2', '1→1']);
  assert.deepEqual(moves(rows[3]?.top), ['0→0', '1→0', '2→0']);
});

test('merge de 3 pais (octopus) é merge e abre um trilho por pai extra', () => {
  const rows = layoutCommits([c('o', 'a', 'b', 'd'), c('a', 'r'), c('b', 'r'), c('d', 'r'), c('r')], createLayoutState('o'));
  assert.equal(rows[0]?.isMerge, true);
  assert.deepEqual(moves(rows[0]?.bottom), ['0→0', '0→1', '0→2']);
  assert.deepEqual(rows.slice(1).map((r) => r.isMerge), [false, false, false, false]);
});

test('trilhos vazios do fim são descartados: o estado não cresce depois que as branches terminam', () => {
  const state = createLayoutState('m');
  layoutCommits([c('f', 'b'), c('g', 'b'), c('m', 'b'), c('b', 'a')], state);
  assert.deepEqual(state.lanes, ['a']);
  assert.deepEqual(state.children, ['b']);
});

test('lanesFor: largura só das linhas pedidas, entre 1 e o corte', () => {
  const row = (width: number): GraphRow => ({ col: 0, color: 0, top: [], bottom: [], width, isMerge: false });
  const rows = [row(1), row(2), row(4), row(2), row(9), row(14)];
  assert.equal(lanesFor(rows, 0, 2, 10), 2); // o trecho largo do fim não alarga o topo
  assert.equal(lanesFor(rows, 0, 3, 10), 4);
  assert.equal(lanesFor(rows, 3, 5, 10), 9);
  assert.equal(lanesFor(rows, 0, rows.length, 10), 10); // limitado pelo corte
  assert.equal(lanesFor(rows, 4, 99, 10), 10); // fim além da lista
  assert.equal(lanesFor(rows, -5, 1, 10), 1); // começo antes da lista
  assert.equal(lanesFor([], 0, 10, 10), 1); // lista vazia: 1 trilho
  assert.equal(lanesFor(rows, 2, 2, 10), 1); // janela vazia
});
