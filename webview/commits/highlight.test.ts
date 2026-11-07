import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Commit, Ref } from '../../src/shared/protocol.ts';
import { followPinned, keepPreview, litCommits, sameRef, type Highlight } from './highlight.ts';

const hash = (n: number) => String(n).padStart(40, '0');

function commit(n: number, parents: number[], refs: Ref[] = []): Commit {
  return {
    hash: hash(n),
    parents: parents.map(hash),
    authorName: 'Ana',
    authorEmail: 'ana@example.com',
    date: '2026-01-01T10:00:00Z',
    subject: `commit ${n}`,
    refs,
  };
}

test('sameRef compara nome e tipo', () => {
  assert.ok(sameRef({ name: '1.0', type: 'tag' }, { name: '1.0', type: 'tag' }));
  assert.equal(sameRef({ name: '1.0', type: 'tag' }, { name: '1.0', type: 'branch' }), false);
  assert.equal(sameRef({ name: 'main', type: 'branch' }, { name: 'dev', type: 'branch' }), false);
});

test('followPinned segue a etiqueta do mesmo tipo, não outra com o mesmo nome', () => {
  // Branch local "origin/feature" (mais nova) convivendo com a remota "origin/feature" (mais antiga).
  const commits = [
    commit(3, [2], [{ name: 'origin/feature', type: 'branch' }]),
    commit(2, [1], [{ name: 'origin/feature', type: 'remote' }]),
    commit(1, []),
  ];
  const remote: Highlight = { hash: hash(2), name: 'origin/feature', type: 'remote' };
  assert.equal(followPinned(remote, commits), remote);

  // A remota andou para o commit 3: o destaque vai junto.
  const moved = [commit(3, [2], [{ name: 'origin/feature', type: 'remote' }]), commit(2, [1]), commit(1, [])];
  assert.deepEqual(followPinned(remote, moved), { ...remote, hash: hash(3) });

  // A etiqueta sumiu: sem destaque.
  assert.equal(followPinned(remote, [commit(1, [])]), null);
  assert.equal(followPinned(null, commits), null);
});

test('keepPreview larga a prévia quando a etiqueta sai do commit', () => {
  const preview: Highlight = { hash: hash(1), name: 'main', type: 'branch' };
  assert.equal(keepPreview(preview, [commit(1, [], [{ name: 'main', type: 'branch' }])]), preview);
  // Commit novo: a etiqueta "main" foi para o commit 2.
  assert.equal(keepPreview(preview, [commit(2, [1], [{ name: 'main', type: 'branch' }]), commit(1, [])]), null);
  // Amend/reset: o commit nem está mais na lista.
  assert.equal(keepPreview(preview, [commit(3, [], [{ name: 'main', type: 'branch' }])]), null);
});

test('litCommits: commit fora da lista é o mesmo que sem destaque', () => {
  const commits = [commit(3, [2]), commit(2, [1]), commit(1, []), commit(9, [])];
  assert.deepEqual(litCommits({ hash: hash(2), name: 'x', type: 'branch' }, commits), new Set([hash(2), hash(1)]));
  assert.equal(litCommits({ hash: hash(7), name: 'x', type: 'branch' }, commits), null);
  assert.equal(litCommits(null, commits), null);
});
