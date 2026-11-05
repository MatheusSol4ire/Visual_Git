import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLog, parseRefs } from './parseLog.ts';

const F = '\x1f';
const R = '\x1e';

function record(fields: string[]): string {
  return fields.join(F) + R + '\n';
}

test('lê commits normais, merges e o commit inicial', () => {
  const raw =
    record(['c3', 'c2 b1', 'Ana', 'ana@ex.com', '2026-11-05T10:00:00-03:00', 'HEAD -> refs/heads/main', 'Merge branch feature']) +
    record(['b1', 'c1', 'Bia', 'bia@ex.com', '2026-11-04T09:00:00-03:00', 'refs/heads/feature', 'Adiciona tela']) +
    record(['c1', '', 'Ana', 'ana@ex.com', '2026-11-01T08:00:00-03:00', '', 'Commit inicial']);

  const commits = parseLog(raw);

  assert.equal(commits.length, 3);
  assert.deepEqual(commits[0]?.parents, ['c2', 'b1']);
  assert.deepEqual(commits[0]?.refs, [{ name: 'main', type: 'branch', current: true }]);
  assert.equal(commits[1]?.subject, 'Adiciona tela');
  assert.deepEqual(commits[2]?.parents, []);
  assert.deepEqual(commits[2]?.refs, []);
});

test('saída vazia vira lista vazia', () => {
  assert.deepEqual(parseLog(''), []);
  assert.deepEqual(parseLog('\n'), []);
});

test('mantém caracteres especiais e acentos no assunto', () => {
  const raw = record(['a1', '', 'João', 'j@ex.com', '2026-01-01T00:00:00Z', '', 'Corrige "aspas", vírgulas, e emoji 🎉']);
  assert.equal(parseLog(raw)[0]?.subject, 'Corrige "aspas", vírgulas, e emoji 🎉');
});

test('aceita quebras de linha do Windows entre registros', () => {
  const raw = ['a1', '', 'A', 'a@ex.com', '2026-01-01T00:00:00Z', '', 'um'].join(F) + R + '\r\n' +
    ['a0', '', 'A', 'a@ex.com', '2026-01-01T00:00:00Z', '', 'dois'].join(F) + R;
  assert.deepEqual(parseLog(raw).map((c) => c.hash), ['a1', 'a0']);
});

test('classifica branches, remotos e tags e ignora origin/HEAD e stash', () => {
  const refs = parseRefs(
    'HEAD -> refs/heads/main, refs/remotes/origin/main, refs/remotes/origin/HEAD, tag: refs/tags/v1.0, refs/heads/feature/login, refs/stash',
  );
  assert.deepEqual(refs, [
    { name: 'main', type: 'branch', current: true },
    { name: 'origin/main', type: 'remote' },
    { name: 'v1.0', type: 'tag' },
    { name: 'feature/login', type: 'branch' },
  ]);
});

test('reconhece HEAD solto (detached)', () => {
  assert.deepEqual(parseRefs('HEAD, refs/heads/x'), [
    { name: 'HEAD', type: 'head' },
    { name: 'x', type: 'branch' },
  ]);
});
