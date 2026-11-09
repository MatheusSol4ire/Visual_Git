import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLog, parseRefs } from './parseLog.ts';

// Saída do `git log -z`: campos e commits separados por NUL.
function record(fields: string[]): string {
  return fields.join('\0') + '\0';
}

const C1 = '1'.repeat(40);
const C2 = '2'.repeat(40);
const C3 = '3'.repeat(40);
const B1 = 'b'.repeat(40);

test('lê commits normais, merges e o commit inicial', () => {
  const raw =
    record([C3, `${C2} ${B1}`, 'Ana', 'ana@example.com', '2026-11-05T10:00:00-03:00', 'HEAD -> refs/heads/main', 'Merge branch feature']) +
    record([B1, C1, 'Bia', 'bia@example.com', '2026-11-04T09:00:00-03:00', 'refs/heads/feature', 'Adiciona tela']) +
    record([C1, '', 'Ana', 'ana@example.com', '2026-11-01T08:00:00-03:00', '', 'Commit inicial']);

  const commits = parseLog(raw);

  assert.equal(commits.length, 3);
  assert.deepEqual(commits[0]?.parents, [C2, B1]);
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
  const raw = record([C1, '', 'João', 'j@example.com', '2026-01-01T00:00:00Z', '', 'Corrige "aspas", vírgulas, e emoji 🎉']);
  assert.equal(parseLog(raw)[0]?.subject, 'Corrige "aspas", vírgulas, e emoji 🎉');
});

test('texto do repositório não cria campos nem commits falsos', () => {
  // Separadores antigos (\x1e, \x1f) e quebras de linha no texto ficam no próprio campo.
  const raw =
    record([C1, '', 'A\x1fB', 'a@example.com', '2026-01-01T00:00:00Z', '', 'um\x1e\x1fdois\nlinha']) +
    record([C2, C1, 'A', 'a@example.com', '2026-01-01T00:00:00Z', '', 'dois']);
  const commits = parseLog(raw);
  assert.deepEqual(commits.map((c) => c.hash), [C1, C2]);
  assert.equal(commits[0]?.authorName, 'A\x1fB');
  assert.equal(commits[0]?.subject, 'um\x1e\x1fdois\nlinha');
});

test('descarta registros com hash ou pais que não são hashes completos', () => {
  // Ex.: a verificação de assinatura (log.showSignature) misturada ao hash.
  const signature = 'Good "git" signature for teste@example.com with ED25519 key SHA256:abc\n' + C1;
  const raw =
    record([signature, '', 'A', 'a@example.com', 'd', '', 'assinado']) +
    record([C2, '--output=/tmp/x', 'A', 'a@example.com', 'd', '', 'pai estranho']) +
    record(['abc123', '', 'A', 'a@example.com', 'd', '', 'hash curto']) +
    record([C3, C2, 'A', 'a@example.com', 'd', '', 'ok']);
  assert.deepEqual(parseLog(raw).map((c) => c.subject), ['ok']);
});

test('aceita hashes SHA-256 (64 dígitos)', () => {
  const H = 'a'.repeat(64);
  assert.equal(parseLog(record([H, '', 'A', 'a@example.com', 'd', '', 'x']))[0]?.hash, H);
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
