import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Commit, CommitFilter, RepoOverview } from '../../src/shared/protocol.ts';
import { aheadBadge, currentBranchSummary, currentOptionLabel, filterFromValue, filterValue, parseSavedFilter } from './branchText.ts';

const MAIN = 'a'.repeat(40);
const FEAT = 'b'.repeat(40);

const overview: RepoOverview = {
  base: { name: 'main', ref: 'refs/heads/main', hash: MAIN },
  branches: [
    { ref: 'refs/heads/main', name: 'main', type: 'branch', hash: MAIN, current: false },
    { ref: 'refs/heads/feature', name: 'feature', type: 'branch', hash: FEAT, current: true },
  ],
  status: { [FEAT]: { ahead: 3, behind: 1 } },
};

const commit = (hash: string, refs: Commit['refs']): Commit => ({
  hash,
  parents: [],
  authorName: 'A',
  authorEmail: 'a@example.com',
  date: '2026-01-01T00:00:00Z',
  subject: 's',
  refs,
});

test('o valor do filtro vai e volta sem perder nada', () => {
  const filters: CommitFilter[] = [{ kind: 'all' }, { kind: 'current' }, { kind: 'branch', ref: 'refs/heads/a:b' }];
  for (const filter of filters) assert.deepEqual(filterFromValue(filterValue(filter)), filter);
});

test('filtro salvo inválido vira "todas"', () => {
  assert.deepEqual(parseSavedFilter(undefined), { kind: 'all' });
  assert.deepEqual(parseSavedFilter({ filter: { kind: 'branch' } }), { kind: 'all' });
  assert.deepEqual(parseSavedFilter({ filter: { kind: 'branch', ref: 'refs/heads/x' } }), { kind: 'branch', ref: 'refs/heads/x' });
});

test('etiqueta "fora da main" só na ponta de branch com commits a mais', () => {
  assert.deepEqual(aheadBadge(commit(FEAT, [{ name: 'feature', type: 'branch' }]), overview), {
    text: '3 fora da main',
    title: '3 commits desta branch ainda não estão na main',
  });
  assert.equal(aheadBadge(commit(MAIN, [{ name: 'main', type: 'branch' }]), overview), null);
  assert.equal(aheadBadge(commit(FEAT, [{ name: 'v1', type: 'tag' }]), overview), null);
  assert.equal(aheadBadge(commit(FEAT, [{ name: 'feature', type: 'branch' }]), undefined), null);
});

test('resumo da branch atual em linguagem simples', () => {
  assert.deepEqual(currentBranchSummary(overview), {
    ahead: 'Sua branch tem 3 commits que ainda não estão na main.',
    behind: 'A main tem 1 commit novo que sua branch ainda não tem.',
  });
  const onMain = { ...overview, branches: overview.branches.map((b) => ({ ...b, current: b.ref === 'refs/heads/main' })) };
  assert.deepEqual(currentBranchSummary(onMain), { ahead: null, behind: null });
});

test('rótulo da opção "minha branch"', () => {
  assert.equal(currentOptionLabel('feature', 'main'), 'Minha branch (feature) e a main');
  assert.equal(currentOptionLabel('main', 'main'), 'Só a minha branch (main)');
  assert.equal(currentOptionLabel(null, 'main'), 'O commit atual e a main');
});
