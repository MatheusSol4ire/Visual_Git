import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keptFilter, parseBranches, pickBase, resolveFilter, type BranchList } from './branches.ts';

const H1 = '1'.repeat(40);
const H2 = '2'.repeat(40);
const H3 = '3'.repeat(40);
const line = (...fields: string[]) => fields.join('\x1f');

test('parseBranches lê locais, remotas, a atual e a padrão do servidor', () => {
  const raw = [
    line('refs/heads/main', H1, '', ' '),
    line('refs/heads/feature/login', H2, '', '*'),
    line('refs/remotes/origin/HEAD', H1, 'refs/remotes/origin/main', ' '),
    line('refs/remotes/origin/main', H1, '', ' '),
    line('refs/remotes/upstream/HEAD', H3, 'refs/remotes/upstream/dev', ' '),
    line('refs/heads/estranha', 'nao-e-hash', '', ' '),
    '',
  ].join('\n');
  const list = parseBranches(raw);
  assert.equal(list.remoteDefault, 'refs/remotes/origin/main');
  assert.deepEqual(list.branches, [
    { ref: 'refs/heads/main', name: 'main', type: 'branch', hash: H1, current: false },
    { ref: 'refs/heads/feature/login', name: 'feature/login', type: 'branch', hash: H2, current: true },
    { ref: 'refs/remotes/origin/main', name: 'origin/main', type: 'remote', hash: H1, current: false },
  ]);
});

const branch = (ref: string, hash: string, current = false) => ({
  ref,
  name: ref.replace(/^refs\/(heads|remotes)\//, ''),
  type: ref.startsWith('refs/heads/') ? ('branch' as const) : ('remote' as const),
  hash,
  current,
});

test('pickBase prefere a padrão do servidor, na cópia local', () => {
  const list: BranchList = {
    branches: [branch('refs/heads/main', H1), branch('refs/heads/develop', H2), branch('refs/remotes/origin/develop', H2)],
    remoteDefault: 'refs/remotes/origin/develop',
  };
  assert.deepEqual(pickBase(list), { name: 'develop', ref: 'refs/heads/develop', hash: H2 });
});

test('pickBase usa main, depois master, depois a do servidor, depois a atual', () => {
  assert.equal(pickBase({ branches: [branch('refs/heads/master', H1), branch('refs/heads/main', H2)], remoteDefault: null })?.name, 'main');
  assert.equal(pickBase({ branches: [branch('refs/heads/master', H1)], remoteDefault: null })?.name, 'master');
  assert.equal(pickBase({ branches: [branch('refs/remotes/origin/main', H1)], remoteDefault: null })?.name, 'origin/main');
  assert.equal(pickBase({ branches: [branch('refs/heads/x', H1), branch('refs/heads/y', H2, true)], remoteDefault: null })?.name, 'y');
  assert.equal(pickBase({ branches: [], remoteDefault: null }), null);
});

test('resolveFilter só aceita branches que existem', () => {
  const list: BranchList = { branches: [branch('refs/heads/main', H1, true), branch('refs/heads/feature', H2)], remoteDefault: null };
  assert.deepEqual(resolveFilter({ kind: 'all' }, list, 'refs/heads/main'), { filter: { kind: 'all' }, revisions: undefined });
  assert.deepEqual(resolveFilter({ kind: 'current' }, list, 'refs/heads/main'), {
    filter: { kind: 'current' },
    revisions: ['HEAD', 'refs/heads/main'],
  });
  assert.deepEqual(resolveFilter({ kind: 'branch', ref: 'refs/heads/feature' }, list, 'refs/heads/main'), {
    filter: { kind: 'branch', ref: 'refs/heads/feature' },
    revisions: ['refs/heads/feature', 'refs/heads/main'],
  });
  // A própria principal não é repetida.
  assert.deepEqual(resolveFilter({ kind: 'branch', ref: 'refs/heads/main' }, list, 'refs/heads/main').revisions, ['refs/heads/main']);
  // Branch que não existe (ou algo malicioso) volta para "todas".
  for (const bad of [{ kind: 'branch', ref: '--output=/tmp/x' }, { kind: 'branch', ref: 'refs/heads/sumiu' }, { kind: 'x' }, null, 'all']) {
    assert.deepEqual(resolveFilter(bad, list, 'refs/heads/main'), { filter: { kind: 'all' }, revisions: undefined });
  }
  // Projeto sem branches: nada a filtrar.
  assert.deepEqual(resolveFilter({ kind: 'current' }, { branches: [], remoteDefault: null }, null).filter, { kind: 'all' });
});

test('keptFilter diz se o filtro pedido foi mantido ou virou "todas"', () => {
  assert.equal(keptFilter({ kind: 'all' }, { kind: 'all' }), true);
  assert.equal(keptFilter({ kind: 'current' }, { kind: 'current' }), true);
  assert.equal(keptFilter({ kind: 'branch', ref: 'refs/heads/a' }, { kind: 'branch', ref: 'refs/heads/a' }), true);
  // A branch do filtro sumiu: resolveFilter devolve "todas".
  assert.equal(keptFilter({ kind: 'branch', ref: 'refs/heads/a' }, { kind: 'all' }), false);
  assert.equal(keptFilter({ kind: 'current' }, { kind: 'all' }), false);
  assert.equal(keptFilter(undefined, { kind: 'all' }), false);
});
