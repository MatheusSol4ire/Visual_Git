import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isToCommitsView, isToDetailsView } from './messages.ts';

const H = 'a'.repeat(40);
const P = 'b'.repeat(40);

const commit = {
  hash: H,
  parents: [P],
  authorName: 'Ana',
  authorEmail: 'ana@example.com',
  date: '2026-01-01T10:00:00Z',
  subject: 'Primeiro',
  refs: [{ name: 'main', type: 'branch', current: true }, { name: 'v1.0', type: 'tag' }],
};

const page = {
  type: 'commits',
  repoName: 'projeto',
  head: 'main',
  commits: [commit],
  skip: 0,
  hasMore: false,
  gen: 7,
  filter: { kind: 'all' },
  overview: {
    base: { name: 'main', ref: 'refs/heads/main', hash: H },
    branches: [{ ref: 'refs/heads/main', name: 'main', type: 'branch', hash: H, current: true }],
    status: { [P]: { ahead: 1, behind: 0 } },
  },
};

const details = {
  ...commit,
  committerName: 'Ana',
  committerDate: '2026-01-01T10:00:00Z',
  body: '',
  files: [
    { path: 'a.txt', status: 'modified', additions: 1, deletions: 0 },
    { path: 'img.png', oldPath: 'old.png', status: 'renamed', additions: null, deletions: null },
  ],
  totalFiles: 2,
  comparedTo: P,
  placement: { baseName: 'main', inBase: true, branches: [{ name: 'main', type: 'branch' }], totalBranches: 1 },
};

test('lista aceita as mensagens que a extensão manda', () => {
  assert.ok(isToCommitsView(page));
  assert.ok(isToCommitsView({ ...page, overview: undefined, skip: 300, head: null, filter: { kind: 'branch', ref: 'refs/heads/x' } }));
  assert.ok(isToCommitsView({ type: 'settings', motion: 'off' }));
  assert.ok(isToCommitsView({ type: 'state', state: { kind: 'error', message: 'falhou' }, gen: 3 }));
  assert.ok(isToCommitsView({ type: 'state', state: { kind: 'parentRepo', root: '/x' } }));
  assert.ok(isToCommitsView({ type: 'state', state: { kind: 'gitMissing' } }));
  assert.ok(isToCommitsView({ type: 'changed' }));
  assert.ok(isToCommitsView({ type: 'select', hash: H }));
});

test('lista ignora mensagens fora do formato', () => {
  for (const bad of [
    null,
    'commits',
    [],
    {},
    { type: 'outra' },
    { type: 'settings', motion: 'rápido' },
    { type: 'state', state: { kind: 'error' } },
    { type: 'state', state: { kind: 'qualquer' } },
    { type: 'state', state: { kind: 'empty', repoName: 'x' }, gen: '3' },
    { type: 'select' },
    { ...page, commits: 'muitos' },
    { ...page, commits: [{ ...commit, refs: [{ name: 'x', type: 'pasta' }] }] },
    { ...page, commits: [{ ...commit, parents: [1] }] },
    { ...page, commits: [null] },
    { ...page, gen: undefined },
    { ...page, skip: -1 },
    { ...page, skip: 1.5 },
    { ...page, filter: { kind: 'branch' } },
    { ...page, overview: { ...page.overview, branches: [{ name: 'main' }] } },
    { ...page, overview: { ...page.overview, status: { [P]: { ahead: 'muito' } } } },
  ]) {
    assert.equal(isToCommitsView(bad), false, JSON.stringify(bad));
  }
});

test('detalhes aceitam as mensagens que a extensão manda', () => {
  assert.ok(isToDetailsView({ type: 'details', details }));
  assert.ok(isToDetailsView({ type: 'details', details: { ...details, comparedTo: null, placement: null, parents: [] } }));
  assert.ok(isToDetailsView({ type: 'loading', hash: H }));
  assert.ok(isToDetailsView({ type: 'error', message: 'falhou' }));
  assert.ok(isToDetailsView({ type: 'settings', motion: 'auto' }));
});

test('detalhes ignoram mensagens fora do formato', () => {
  for (const bad of [
    undefined,
    { type: 'details' },
    { type: 'details', details: { ...details, files: [{ path: 'a', status: 'sumiu', additions: 0, deletions: 0 }] } },
    { type: 'details', details: { ...details, files: [{ path: 'a', status: 'added', additions: '1', deletions: 0 }] } },
    { type: 'details', details: { ...details, totalFiles: -2 } },
    { type: 'details', details: { ...details, placement: { baseName: 'main' } } },
    { type: 'details', details: { ...details, body: undefined } },
    { type: 'loading' },
    { type: 'error', message: 42 },
    page,
  ]) {
    assert.equal(isToDetailsView(bad), false, JSON.stringify(bad));
  }
});
